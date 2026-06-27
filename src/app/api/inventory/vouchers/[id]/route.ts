import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { calcLineTotals, calcVoucherTotals } from "@/modules/inventory/lib/stock";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import { reapplyTradingVoucherInPlace } from "@/modules/accountancy/lib/reapplyTradingVoucher";
import { auditSnapshot } from "@/modules/accountancy/lib/voucherLifecycle";
import type { PostVoucherInput } from "@/modules/accountancy/lib/postInvVoucher";
import * as Sentry from "@sentry/nextjs";
import { handleApiError } from "@/shared/lib/api";
import { Prisma } from "@/generated/prisma/client";
import { buildPartyJson, readPartyName, readPartyPhone, readPartyAddress } from "@/shared/lib/accountancy/partySnapshot";
import { readSettlement, buildSettlementJson } from "@/shared/lib/accountancy/settlement";

type Params = { params: Promise<{ id: string }> };

// GET /api/inventory/vouchers/[id]
export async function GET(_req: Request, { params }: Params) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const voucherRow = await prisma.invVoucher.findUnique({
        where: { id: Number(id) },
        include: {
            createdBy: { select: { name: true } },
            branch:    { select: { id: true, name: true } },
            // refVoucher powers parent-link surfaces — "Replaces <old ref>"
            // for a SALE_RETURN against a SALE, or "Linked to PO-…" on a GRN.
            refVoucher: { select: { id: true, reference: true, type: true } },
        },
    });
    if (!voucherRow) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Phase 5 5C: goods lines + stock ledger hang off the spine — load + attach.
    const voucher = {
        ...voucherRow,
        lines: await prisma.voucherInventoryLine.findMany({
            where:   { universalVoucherId: voucherRow.universalVoucherId ?? -1 },
            include: { product: { select: { id: true, sku: true, name: true, unit: { select: { code: true, label: true } } } } },
        }),
        stockEntries: await prisma.invStockLedger.findMany({
            where:   { universalVoucherId: voucherRow.universalVoucherId ?? -1 },
            include: { product: { select: { id: true, sku: true, name: true } } },
        }),
    };

    // G4b: tender + charge input comes from settlementJson now. Re-shape it into
    // the `tenders` / `charges` arrays (with account id/name/code) the edit form
    // already consumes, so the form's edit-mode hydration is unchanged.
    const settlement = readSettlement(voucher.settlementJson);
    const acctIds = [...new Set([...settlement.tenders, ...settlement.charges].map((r) => r.accountId))];
    const acctById = new Map(
        (acctIds.length === 0 ? [] : await prisma.account.findMany({ where: { id: { in: acctIds } }, select: { id: true, name: true, code: true } }))
            .map((a) => [a.id, a]),
    );
    const withAccount = <T extends { accountId: number }>(r: T) => ({ ...r, account: acctById.get(r.accountId) ?? null });

    // Derive party display fields from the frozen snapshot so the detail page +
    // form edit-load keep reading partyName / partyPhone / partyAddress.
    return NextResponse.json({
        ...voucher,
        tenders:      settlement.tenders.map(withAccount),
        charges:      settlement.charges.map(withAccount),
        partyName:    readPartyName(voucher.partyJson),
        partyPhone:   readPartyPhone(voucher.partyJson),
        partyAddress: readPartyAddress(voucher.partyJson),
    });
}

// PATCH /api/inventory/vouchers/[id]
//
// Two modes, decided by the source's status:
//
//   • DRAFT  — straightforward field/lines update. No stock or GL was ever
//              moved, so no reversal needed.
//
//   • POSTED — Tally-style in-place edit. The voucher REFERENCE is preserved
//              (it's the same row); behind the scenes the transaction:
//                1. reverses the original stock ledger entries + cached
//                   InvProduct.stock,
//                2. posts a reversal JE for the linked Journal Entry and
//                   marks the original JE as CANCELLED (audit trail kept),
//                3. replaces the voucher header + line items with the new
//                   values,
//                4. re-runs stock posting + GL posting from scratch on the
//                   updated lines, linking the voucher to the new JE.
//              Stock and GL end up reflecting the new values; the JE list
//              shows the original / reversal / replacement chain.
//
//   • CANCELLED / DELETED — 409, since the voucher isn't a valid edit target.
//
// Same /[id], same ref number, same row.
export async function PATCH(req: Request, { params }: Params) {
    const { response, user } = await requireAuth();
    if (response) return response;

    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const existing = await prisma.invVoucher.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Phase 5 5C: capture old line product ids (goods hang off the spine) for the
    // after-commit pricing recompute — the lines themselves are rewritten below.
    const existingLineProductIds = (await prisma.voucherInventoryLine.findMany({
        where: { universalVoucherId: existing.universalVoucherId ?? -1 }, select: { productId: true },
    })).map((l) => l.productId);
    if (existing.deletedAt) return NextResponse.json({ error: "Voucher is deleted" }, { status: 409 });
    if (existing.status === "CANCELLED") {
        return NextResponse.json({ error: "Voucher is cancelled — use Duplicate to create a fresh copy." }, { status: 409 });
    }

    const body = await req.json();
    const {
        date,
        description,
        partyName,
        partyType,
        partyId,
        partyPhone,
        partyAddress,
        creditPeriodDays,
        refNumber,
        refDate,
        refVoucherId,
        bomId,
        destinationBranchId,
        branchId: bodyBranchId,
        showPrices,
        shippingAmt,
        roundOff,
        discountPct,
        discountAmt,
        lines,
        charges,
        tenders,
    } = body as {
        date?:             string;
        description?:      string;
        partyName?:        string;
        partyType?:        string;
        partyId?:          number;
        partyPhone?:       string;
        partyAddress?:     string;
        creditPeriodDays?: number | null;
        refNumber?:        string;
        refDate?:          string;
        /// Parent voucher (e.g. PO for a GRN); null clears the link.
        refVoucherId?:     number | null;
        /// MANUFACTURING_JOURNAL only — optional FK to InvBom.
        bomId?:            number | null;
        /// BRANCH_TRANSFER only — destination branch.
        destinationBranchId?: string | null;
        /// Source branch (read-only for posted edits; only DRAFT allows change).
        branchId?:         string;
        /// Challan-only: persist print-price visibility.
        showPrices?:       boolean;
        shippingAmt?:      number;
        roundOff?:         number;
        discountPct?:      number;
        discountAmt?:      number;
        lines?: {
            productId:    number;
            description?: string;
            quantity:     number;
            freeQty?:     number;
            rate?:        number;
            /// MRP in paise — stored on the line; used to update InvProduct.mrpPaise on post.
            mrpPaise?:    number;
            discountPct?: number;
            discountAmt?: number;
            taxRate?:     number;
            direction?:   "CONSUME" | "PRODUCE";
        }[];
        charges?: {
            accountId:    number;
            description?: string;
            amount:       number;
        }[];
        tenders?: {
            accountId: number;
            amount:    number;
            method?:   "CASH" | "BANK_TRANSFER" | "CARD" | "CHEQUE" | "MOBILE_PAYMENT" | "OTHER";
            reference?: string;
        }[];
    };

    const isPhysicalStock = existing.type === "PHYSICAL_STOCK";
    const isManufacturingJournal = existing.type === "MANUFACTURING_JOURNAL";
    const isBranchTransfer = existing.type === "BRANCH_TRANSFER";

    // Recompute totals if lines provided.
    let totals: { subtotal: number; taxAmount: number; totalAmount: number } | undefined;
    let computedLines: ({
        productId: number; description?: string; quantity: number; freeQty?: number; rate: number;
        mrpPaise?: number; discountPct?: number; discountAmt: number; taxRate?: number; taxAmount: number; amount: number;
        direction?: "CONSUME" | "PRODUCE";
    })[] | undefined;

    if (lines?.length) {
        computedLines = lines.map((l) => {
            const rate = l.rate ?? 0;
            if (isPhysicalStock || isBranchTransfer) {
                return { ...l, rate: 0, discountAmt: 0, taxAmount: 0, amount: 0 };
            }
            if (isManufacturingJournal) {
                return { ...l, rate, discountAmt: 0, taxAmount: 0, amount: l.quantity * rate };
            }
            const { discountAmt: lineDiscountAmt, taxAmount, amount } = calcLineTotals({
                quantity:    l.quantity,
                rate,
                discountPct: l.discountPct ?? 0,
                discountAmt: l.discountAmt ?? 0,
                taxRate:     l.taxRate    ?? 0,
            });
            return { ...l, rate, discountAmt: lineDiscountAmt, taxAmount, amount };
        });
        const chargesNet = (charges ?? []).reduce((s, c) => s + Number(c.amount), 0);
        totals = calcVoucherTotals(
            computedLines,
            shippingAmt ?? Number(existing.shippingAmt),
            discountAmt ?? (existing.discountAmt != null ? Number(existing.discountAmt) : 0),
            roundOff    ?? Number(existing.roundOff),
            chargesNet,
        );
    }

    const wasPosted = existing.status === "POSTED";
    const userId = user!.id;

    // POSTED edits on PHYSICAL_STOCK / MANUFACTURING_JOURNAL aren't supported
    // yet — Phase-1 reversal + Phase-3 re-post code paths below only cover
    // trading vouchers. Direct the user to cancel + create a new draft.
    if (wasPosted && (isPhysicalStock || isManufacturingJournal || isBranchTransfer)) {
        const niceLabel = isPhysicalStock ? "Physical Stock"
            : isManufacturingJournal ? "Manufacturing Journal"
            : "Branch Transfer";
        return NextResponse.json(
            { error: `Cannot edit a posted ${niceLabel} voucher. Cancel it and create a new one instead.` },
            { status: 409 },
        );
    }

    try {
        const updated = await prisma.$transaction(async (tx) => {
            // POSTED edits run reverse + apply + re-post in one tx. Each phase
            // walks every line + posts a JE, so the default 5s ceiling is
            // tight. 30s gives plenty of headroom on slow dev machines.
            // ────────────────────────────────────────────────────────────
            // PHASE 1 — Reverse the existing posting (POSTED only)
            // ────────────────────────────────────────────────────────────
            if (wasPosted) {
                // Phase 4 ②: snapshot the pre-edit state to AuditLog, then reapply
                // IN PLACE in Phase 3 (rewrite the SAME JE + replace stock rows +
                // recompute caches). No reversal JE, no counter stock entries — the
                // voucher and its journalEntryId are preserved, so receipts
                // allocated against the JE stay linked.
                const origJe = existing.universalVoucherId
                    ? await tx.universalVoucher.findUnique({ where: { id: existing.universalVoucherId }, include: { lines: true } })
                    : null;
                const oldSnapRow = await tx.invVoucher.findUnique({ where: { id } });
                const oldSnap = oldSnapRow ? {
                    ...oldSnapRow,
                    lines: await tx.voucherInventoryLine.findMany({ where: { universalVoucherId: existing.universalVoucherId ?? -1 } }),
                } : null;
                await tx.auditLog.create({
                    data: auditSnapshot({
                        entityType:  "INV_VOUCHER",
                        subtype:     existing.type,
                        originalId:  existing.id,
                        originalRef: existing.reference,
                        reason:      `Edit (in-place) of ${existing.reference}`,
                        snapshot:    { ...oldSnap, journalEntry: origJe },
                        actorId:     userId,
                    }),
                });
            }

            // ────────────────────────────────────────────────────────────
            // PHASE 2 — Apply the user's edits (header + lines)
            // ────────────────────────────────────────────────────────────
            if (computedLines) {
                await tx.voucherInventoryLine.deleteMany({ where: { universalVoucherId: existing.universalVoucherId ?? -1 } });
            }
            // G4b: tender + charge input lives in settlementJson now. A PATCH may
            // touch either section independently (undefined = leave as-is), so
            // merge the provided arrays over the existing settlement and rewrite
            // the column below. An empty array clears that section.
            const existingSettlement = readSettlement(existing.settlementJson);
            const settlementChanged = charges !== undefined || tenders !== undefined;
            const newSettlementJson = settlementChanged
                ? buildSettlementJson(
                    tenders !== undefined ? tenders : existingSettlement.tenders,
                    charges !== undefined ? charges : existingSettlement.charges,
                )
                : undefined;
            // Resolve the canonical ledger account from the (possibly updated)
            // party identity so accountId tracks the routing pair.
            let patchAccountId: number | null = null;
            if (partyId != null && partyType === "customer") {
                patchAccountId = (await tx.account.findUnique({ where: { personId: partyId }, select: { id: true } }))?.id ?? null;
            } else if (partyId != null && partyType === "company") {
                patchAccountId = (await tx.account.findUnique({ where: { companyId: partyId }, select: { id: true } }))?.id ?? null;
            }
            // Status stays POSTED for posted edits; the re-post below sets a
            // fresh journalEntryId. For draft edits the row is unchanged.
            await tx.invVoucher.update({
                where: { id },
                data: {
                    ...(date        ? { date: new Date(date) } : {}),
                    ...(description ? { description: description.trim() } : {}),
                    // Party display fields move together as one frozen snapshot.
                    ...(partyName !== undefined || partyPhone !== undefined || partyAddress !== undefined
                        ? { partyJson: buildPartyJson({ name: partyName, phone: partyPhone, address: partyAddress }) ?? Prisma.DbNull }
                        : {}),
                    ...(partyType        !== undefined ? { partyType:        partyType        || null } : {}),
                    ...(partyId          !== undefined ? { partyId:          partyId          || null } : {}),
                    // Keep the canonical FK in step with the routing pair.
                    ...(partyId !== undefined ? { accountId: patchAccountId } : {}),
                    ...(creditPeriodDays  !== undefined ? { creditPeriodDays:  creditPeriodDays ?? null } : {}),
                    ...(refNumber        !== undefined ? { refNumber:        refNumber        || null } : {}),
                    ...(refDate          !== undefined ? { refDate:          refDate ? new Date(refDate) : null } : {}),
                    ...(refVoucherId     !== undefined ? { refVoucherId:     refVoucherId ?? null } : {}),
                    ...(bomId            !== undefined ? { bomId:            bomId ?? null } : {}),
                    ...(bodyBranchId     !== undefined && !wasPosted ? { branchId:  bodyBranchId } : {}),
                    ...(destinationBranchId !== undefined ? { destinationBranchId: destinationBranchId ?? null } : {}),
                    ...(showPrices       !== undefined ? { showPrices }                              : {}),
                    ...(shippingAmt      !== undefined ? { shippingAmt }     : {}),
                    ...(roundOff         !== undefined ? { roundOff }        : {}),
                    ...(discountPct      !== undefined ? { discountPct }     : {}),
                    ...(discountAmt      !== undefined ? { discountAmt }     : {}),
                    ...(totals ? totals : {}),
                    ...(newSettlementJson !== undefined ? { settlementJson: newSettlementJson } : {}),
                },
            });
            // Phase 5 5C: rewrite the goods lines on the spine (deleted above).
            if (computedLines) {
                await tx.voucherInventoryLine.createMany({
                    data: computedLines.map((l) => ({
                        universalVoucherId: existing.universalVoucherId!,
                        productId:   l.productId,
                        description: l.description || null,
                        direction:   isManufacturingJournal ? l.direction ?? null : null,
                        quantity:    l.quantity,
                        freeQty:     l.freeQty ?? null,
                        rate:        l.rate,
                        mrpPaise:    l.mrpPaise ?? null,
                        discountPct: l.discountPct ?? 0,
                        discountAmt: l.discountAmt,
                        taxRate:     l.taxRate    ?? 0,
                        taxAmount:   l.taxAmount,
                        amount:      l.amount,
                    })),
                });
            }

            // ────────────────────────────────────────────────────────────
            // PHASE 3 — Reapply IN PLACE (POSTED only)
            // ────────────────────────────────────────────────────────────
            if (wasPosted) {
                const freshRow = await tx.invVoucher.findUnique({ where: { id } });
                if (!freshRow) throw new Error("Voucher disappeared mid-transaction");
                // Phase 5 5C: goods lines hang off the spine.
                const fresh = {
                    ...freshRow,
                    lines: await tx.voucherInventoryLine.findMany({
                        where:   { universalVoucherId: freshRow.universalVoucherId ?? -1 },
                        include: { product: { select: { id: true, mrpPaise: true, stock: true } } },
                    }),
                };

                // Tenders + charges (settlementJson) flow into saleToSpec — one GL
                // leg per row. Rewrite the SAME JE in place + replace stock rows +
                // recompute the caches from truth (no reversal, no re-minted JE —
                // journalEntryId is preserved so receipts allocated against it stay linked).
                const freshSettlement = readSettlement(fresh.settlementJson);
                await reapplyTradingVoucherInPlace(tx, {
                    voucher:        { ...fresh, tenders: freshSettlement.tenders, charges: freshSettlement.charges } as unknown as PostVoucherInput["voucher"],
                    branchId:       fresh.branchId,
                    lines:          fresh.lines,
                    journalEntryId: existing.universalVoucherId,
                });
                // G4d: reapply resyncs the spine (delete + re-mirror → new spine id);
                // refresh the direct link so InvVoucher.universalVoucherId stays valid.
                const newSpine = existing.universalVoucherId != null
                    ? await tx.universalVoucher.findUnique({ where: { sourceJournalEntryId: existing.universalVoucherId }, select: { id: true } })
                    : null;
                await tx.invVoucher.update({ where: { id }, data: { postedAt: new Date(), universalVoucherId: newSpine?.id ?? null } });
                // Phase 5 5C: link the rewritten stock rows (+ any new goods lines) to the spine.
            }

            const updatedRow = await tx.invVoucher.findUnique({
                where: { id },
                include: { createdBy: { select: { name: true } } },
            });
            // Phase 5 5C: goods lines hang off the spine.
            return updatedRow ? {
                ...updatedRow,
                lines: await tx.voucherInventoryLine.findMany({
                    where:   { universalVoucherId: updatedRow.universalVoucherId ?? -1 },
                    include: { product: { select: { id: true, sku: true, name: true } } },
                }),
            } : null;
        }, { timeout: 30_000, maxWait: 10_000 });

        // After-commit pricing recompute — union of old lines (just reversed)
        // and new lines (just posted). Both sets can affect cost basis.
        const touchedProductIds = new Set<number>();
        for (const pid of existingLineProductIds) touchedProductIds.add(pid);
        for (const l of computedLines ?? []) touchedProductIds.add(l.productId);
        await recomputePricesForProducts([...touchedProductIds]).catch((err: unknown) => {
            Sentry.captureException(err, { tags: { source: "price-recompute", voucherId: String(id) } });
            console.error("[price-recompute] failed for voucher", id, err);
        });

        return NextResponse.json(updated);
    } catch (e) {
        return handleApiError(e, "Failed to update voucher");
    }
}

// DELETE /api/inventory/vouchers/[id]  — only allowed on DRAFT
export async function DELETE(_req: Request, { params }: Params) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const existing = await prisma.invVoucher.findUnique({ where: { id: Number(id) } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.status !== "DRAFT") {
        return NextResponse.json({ error: "Only DRAFT vouchers can be deleted via this route. Use /cancel or /delete for lifecycle." }, { status: 409 });
    }
    await prisma.voucherInventoryLine.deleteMany({ where: { universalVoucherId: existing.universalVoucherId ?? -1 } });
    await prisma.invVoucher.delete({ where: { id: Number(id) } });
    return NextResponse.json({ ok: true });
}
