import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { calcLineTotals, calcVoucherTotals } from "@/modules/inventory/lib/stock";
import { round2 } from "@/shared/lib/format";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import { reapplyTradingVoucherInPlace } from "@/modules/accountancy/lib/reapplyTradingVoucher";
import { auditSnapshot } from "@/modules/accountancy/lib/voucherLifecycle";
import type { PostVoucherInput } from "@/modules/accountancy/lib/postInvVoucher";
import * as Sentry from "@sentry/nextjs";
import { handleApiError } from "@/shared/lib/api";
import { GlBuildError, tenderCoverageComplaint } from "@/modules/accountancy/lib/postInvVoucher";
import { Prisma } from "@/generated/prisma/client";
import { buildPartyJson, readPartyName, readPartyPhone, readPartyAddress } from "@/shared/lib/accountancy/partySnapshot";
import { readSettlement, buildSettlementJson } from "@/shared/lib/accountancy/settlement";

type Params = { params: Promise<{ id: string }> };

// GET /api/inventory/vouchers/[id]
export async function GET(_req: Request, { params }: Params) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const voucherRow = await prisma.voucherDetail.findUnique({
        where: { id: Number(id) },
        include: {
            // 5D-2 creator + 5D-6 ref + 5D-11 type + 5D-12 branch + 5D-4 party ledger + lifecycle live on the spine.
            // 5D-5/5D-10: date + description + narration + postedAt live on the spine too —
            // without them the edit form read `v.date === undefined` and silently
            // fell back to TODAY on every old voucher (same for the narration box).
            universalVoucher: { select: { createdById: true, voucherNo: true, type: true, date: true, description: true, narration: true, postedAt: true, branchId: true, partyAccountId: true, status: true, deletedAt: true, cancelledAt: true, branch: { select: { id: true, name: true } } } },
            // refVoucher powers parent-link surfaces — "Replaces <old ref>"
            // for a SALE_RETURN against a SALE, or "Linked to PO-…" on a GRN.
            refVoucher: { select: { id: true, universalVoucher: { select: { voucherNo: true, type: true } } } },   // 5D-11 type on spine
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

    // 5D-2: resolve the creator's name from the spine's createdById.
    const creator = voucher.universalVoucher?.createdById != null
        ? await prisma.user.findUnique({ where: { id: voucher.universalVoucher.createdById }, select: { name: true } })
        : null;

    // Derive party display fields from the frozen snapshot so the detail page +
    // form edit-load keep reading partyName / partyPhone / partyAddress.
    return NextResponse.json({
        ...voucher,
        // 5D-6/5D-11/5D-12: the user-facing number + type + branch come from the spine now.
        type:         voucher.universalVoucher?.type,
        // 5D-10/5D-5: the document's own date + narration text. Surfaced here so
        // edit-load and the detail page show what was SAVED, not today's date.
        date:         voucher.universalVoucher?.date ?? null,
        description:  voucher.universalVoucher?.description ?? "",
        narration:    voucher.universalVoucher?.narration ?? null,
        postedAt:     voucher.universalVoucher?.postedAt ?? null,
        branchId:     voucher.universalVoucher?.branchId ?? null,
        // Lifecycle also lives on the spine now — VoucherDetail itself carries
        // none of these, so without surfacing them here the edit form's
        // `v.status`/`v.deletedAt`/`v.cancelledAt` reads always came back
        // undefined (posted-vs-draft never detected; CANCELLED never caught).
        status:       voucher.universalVoucher?.status ?? null,
        deletedAt:    voucher.universalVoucher?.deletedAt ?? null,
        cancelledAt:  voucher.universalVoucher?.cancelledAt ?? null,
        // 5D-4: the canonical party ledger lives on the spine — surface it as
        // `accountId` so edit-mode hydration (POS screen, forms) can load the customer.
        accountId:    voucher.universalVoucher?.partyAccountId ?? null,
        branch:       voucher.universalVoucher?.branch ?? null,
        reference:    voucher.universalVoucher?.voucherNo ?? "",
        refVoucher:   voucher.refVoucher ? { id: voucher.refVoucher.id, type: voucher.refVoucher.universalVoucher?.type, reference: voucher.refVoucher.universalVoucher?.voucherNo ?? "" } : null,
        createdBy:    creator,
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

    const existing = await prisma.voucherDetail.findUnique({ where: { id }, include: { universalVoucher: { select: { voucherNo: true, status: true, deletedAt: true, type: true } } } });   // 5D-6/5D-8/5D-11
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Phase 5 5C: capture old line product ids (goods hang off the spine) for the
    // after-commit pricing recompute — the lines themselves are rewritten below.
    const existingLineProductIds = (await prisma.voucherInventoryLine.findMany({
        where: { universalVoucherId: existing.universalVoucherId ?? -1 }, select: { productId: true },
    })).map((l) => l.productId);
    if (existing.universalVoucher?.deletedAt) return NextResponse.json({ error: "Voucher is deleted" }, { status: 409 });
    if (existing.universalVoucher?.status === "CANCELLED") {
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
            /// MRP/barcode snapshots in paise, preserved across edits so the
            /// customer-facing ladder still shows the original tag/struck MRP.
            mrpPaise?: number | null;
            savedSalePricePaise?: number | null;
            discountPct?: number;
            discountAmt?: number;
            taxRate?:     number;
            direction?:   "CONSUME" | "PRODUCE";
        }[];
        charges?: {
            accountId:    number;
            description?: string;
            amount:       number;
            /// GST on a tax-bearing charge (POS-service row) — preserved through
            /// the edit round-trip so the re-post keeps its tax legs.
            taxAmount?:   number;
        }[];
        tenders?: {
            accountId: number;
            amount:    number;
            method?:   "CASH" | "BANK_TRANSFER" | "CARD" | "CHEQUE" | "MOBILE_PAYMENT" | "OTHER";
            reference?: string;
        }[];
    };

    const isPhysicalStock = existing.universalVoucher?.type === "PHYSICAL_STOCK";
    const isManufacturingJournal = existing.universalVoucher?.type === "MANUFACTURING_JOURNAL";
    const isBranchTransfer = existing.universalVoucher?.type === "BRANCH_TRANSFER";

    // Preserve the sale's original MRP/barcode snapshots across an edit even if
    // the client omits them on a partial save. This keeps the ladder/receipt
    // display consistent after the voucher is rewritten.
    const existingLineSnapshot = lines?.length
        ? await prisma.voucherInventoryLine.findMany({
            where: { universalVoucherId: existing.universalVoucherId ?? -1 },
            select: { productId: true, mrpPaise: true, savedSalePricePaise: true },
        })
        : [];
    const existingLineByProduct = new Map(existingLineSnapshot.map((l) => [l.productId, l]));
    const productIds = [...new Set((lines ?? []).map((l) => l.productId))];
    const productMeta = productIds.length > 0
        ? await prisma.invProduct.findMany({
            where: { id: { in: productIds } },
            select: { id: true, mrpPaise: true, savedSalePricePaise: true },
        })
        : [];
    const productMetaById = new Map(productMeta.map((p) => [p.id, p]));

    // Recompute totals if lines provided.
    let totals: { subtotal: number; taxAmount: number; totalAmount: number } | undefined;
    let computedLines: ({
        productId: number; description?: string; quantity: number; freeQty?: number; rate: number;
        mrpPaise?: number | null; savedSalePricePaise?: number | null; discountPct?: number; discountAmt: number; taxRate?: number; taxAmount: number; amount: number;
        direction?: "CONSUME" | "PRODUCE";
    })[] | undefined;
    // Tax-INCLUSIVE bill discount actually applied (clamped to the bill) — what
    // gets stored. Stays 0 when this PATCH doesn't touch the lines.
    let billDiscIncl = 0;

    if (lines?.length) {
        computedLines = lines.map((l) => {
            const rate = l.rate ?? 0;
            const oldLine = existingLineByProduct.get(l.productId);
            const productLine = productMetaById.get(l.productId);
            const mrpPaise = l.mrpPaise ?? oldLine?.mrpPaise ?? productLine?.mrpPaise ?? null;
            const savedSalePricePaise = l.savedSalePricePaise ?? oldLine?.savedSalePricePaise ?? productLine?.savedSalePricePaise ?? null;
            if (isPhysicalStock || isBranchTransfer) {
                return { ...l, rate: 0, mrpPaise, savedSalePricePaise, discountAmt: 0, taxAmount: 0, amount: 0 };
            }
            if (isManufacturingJournal) {
                return { ...l, rate, mrpPaise, savedSalePricePaise, discountAmt: 0, taxAmount: 0, amount: l.quantity * rate };
            }
            const { discountAmt: lineDiscountAmt, taxAmount, amount } = calcLineTotals({
                quantity:    l.quantity,
                rate,
                discountPct: l.discountPct ?? 0,
                discountAmt: l.discountAmt ?? 0,
                taxRate:     l.taxRate    ?? 0,
            });
            return { ...l, rate, mrpPaise, savedSalePricePaise, discountAmt: lineDiscountAmt, taxAmount, amount };
        });
        // Tax-bearing charges (POS services) count at GROSS — net + their GST —
        // mirroring /api/pos/sale, so totalAmount still balances the re-posted JE.
        const chargesNet = (charges ?? []).reduce((s, c) => s + Number(c.amount) + Number(c.taxAmount ?? 0), 0);
        // ── Bill-level discount → subtracted AFTER tax ──────────────────────
        // Same treatment as POST /api/inventory/vouchers (see the note there):
        // a LINE discount reduces the taxable value, the HEADER discount comes
        // off the tax-inclusive bottom line. Clamped so an over-typed discount
        // can't drive totalAmount negative.
        const lineSubtotal = computedLines.reduce((s, l) => s + l.amount, 0);
        const requested    = discountAmt ?? (existing.discountAmt != null ? Number(existing.discountAmt) : 0);
        billDiscIncl = round2(Math.min(Math.max(0, requested), lineSubtotal));
        totals = calcVoucherTotals(
            computedLines,
            shippingAmt ?? Number(existing.shippingAmt),
            billDiscIncl,
            roundOff    ?? Number(existing.roundOff),
            chargesNet,
        );
    }

    // The payment rows must still add up AFTER the edit. This PATCH may change
    // the lines (and so the total) while saying nothing about tenders, in which
    // case the existing ones stand — and a voucher whose goods moved but whose
    // money did not is exactly the state that used to be saved in silence. Same
    // rule as POST, same function, checked before anything is written.
    const effectiveTotal = totals?.totalAmount ?? Number(existing.totalAmount);
    const effectiveTenders = tenders !== undefined
        ? tenders
        : readSettlement(existing.settlementJson).tenders;
    const tenderComplaint = tenderCoverageComplaint(effectiveTenders, effectiveTotal);
    if (tenderComplaint) return NextResponse.json({ error: tenderComplaint }, { status: 400 });

    const wasPosted = existing.universalVoucher?.status === "POSTED";   // 5D-8
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
                const oldSnapRow = await tx.voucherDetail.findUnique({ where: { id } });
                const oldSnap = oldSnapRow ? {
                    ...oldSnapRow,
                    lines: await tx.voucherInventoryLine.findMany({ where: { universalVoucherId: existing.universalVoucherId ?? -1 } }),
                } : null;
                await tx.auditLog.create({
                    data: auditSnapshot({
                        entityType:  "INV_VOUCHER",
                        subtype:     existing.universalVoucher?.type ?? null,
                        originalId:  existing.id,
                        originalRef: existing.universalVoucher?.voucherNo ?? "",
                        reason:      `Edit (in-place) of ${existing.universalVoucher?.voucherNo ?? ""}`,
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
            await tx.voucherDetail.update({
                where: { id },
                data: {
                    // 5D-5/5D-10: description + date live on the spine (updated below).
                    // Party display fields move together as one frozen snapshot.
                    ...(partyName !== undefined || partyPhone !== undefined || partyAddress !== undefined
                        ? { partyJson: buildPartyJson({ name: partyName, phone: partyPhone, address: partyAddress }) ?? Prisma.DbNull }
                        : {}),
                    ...(partyType        !== undefined ? { partyType:        partyType        || null } : {}),
                    ...(partyId          !== undefined ? { partyId:          partyId          || null } : {}),
                    // 5D-4: the canonical party ledger (partyAccountId) lives on the spine (updated below).
                    ...(creditPeriodDays  !== undefined ? { creditPeriodDays:  creditPeriodDays ?? null } : {}),
                    ...(refNumber        !== undefined ? { refNumber:        refNumber        || null } : {}),
                    ...(refDate          !== undefined ? { refDate:          refDate ? new Date(refDate) : null } : {}),
                    ...(refVoucherId     !== undefined ? { refVoucherId:     refVoucherId ?? null } : {}),
                    ...(bomId            !== undefined ? { bomId:            bomId ?? null } : {}),
                    // 5D-12: primary branch lives on the spine (updated below).
                    ...(destinationBranchId !== undefined ? { destinationBranchId: destinationBranchId ?? null } : {}),
                    ...(showPrices       !== undefined ? { showPrices }                              : {}),
                    ...(shippingAmt      !== undefined ? { shippingAmt }     : {}),
                    ...(roundOff         !== undefined ? { roundOff }        : {}),
                    ...(discountPct      !== undefined ? { discountPct }     : {}),
                    // Clamped to the bill when the lines were recomputed, so an
                    // over-discount can't drive totalAmount negative.
                    ...(discountAmt      !== undefined
                        ? { discountAmt: computedLines ? (billDiscIncl > 0 ? billDiscIncl : null) : discountAmt }
                        : {}),
                    ...(totals ? totals : {}),
                    ...(newSettlementJson !== undefined ? { settlementJson: newSettlementJson } : {}),
                },
            });
            // 5D-4/5D-5/5D-10/5D-12: date + description + party ledger + branch live on the spine.
            if (existing.universalVoucherId != null) {
                const spinePatch: Prisma.UniversalVoucherUncheckedUpdateInput = {
                    ...(date        ? { date: new Date(date) } : {}),
                    ...(description ? { description: description.trim() } : {}),
                    ...(partyId !== undefined ? { partyAccountId: patchAccountId } : {}),
                    ...(bodyBranchId !== undefined && !wasPosted ? { branchId: bodyBranchId } : {}),
                };
                if (Object.keys(spinePatch).length > 0) {
                    await tx.universalVoucher.update({ where: { id: existing.universalVoucherId }, data: spinePatch });
                }
            }
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
                        savedSalePricePaise: l.savedSalePricePaise ?? null,
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
                const freshRow = await tx.voucherDetail.findUnique({ where: { id }, include: { universalVoucher: { select: { date: true, type: true, branchId: true } } } });   // 5D-10 date + 5D-11 type + 5D-12 branch
                if (!freshRow) throw new Error("Voucher disappeared mid-transaction");
                // Phase 5 5C: goods lines hang off the spine. 5D-10/11/12: date + type +
                // branch from the spine drive saleToSpec (GL/stock mapping) + the ledger rows.
                const fresh = {
                    ...freshRow,
                    date: freshRow.universalVoucher!.date,
                    type: freshRow.universalVoucher!.type,
                    branchId: freshRow.universalVoucher!.branchId ?? "",
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
                    ? await tx.universalVoucher.findUnique({ where: { id: existing.universalVoucherId }, select: { id: true } })   // 5D-16: spine id directly (was sourceJournalEntryId self-ref)
                    : null;
                await tx.voucherDetail.update({ where: { id }, data: { universalVoucherId: newSpine?.id ?? null } });   // 5D-5: postedAt on spine
                // Phase 5 5C: link the rewritten stock rows (+ any new goods lines) to the spine.
            }

            const updatedRow = await tx.voucherDetail.findUnique({
                where: { id },
                include: { universalVoucher: { select: { createdById: true } } },   // 5D-2: creator on spine
            });
            const creator = updatedRow?.universalVoucher?.createdById != null
                ? await tx.user.findUnique({ where: { id: updatedRow.universalVoucher.createdById }, select: { name: true } })
                : null;
            // Phase 5 5C: goods lines hang off the spine.
            return updatedRow ? {
                ...updatedRow,
                createdBy: creator,
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
        // A voucher whose ledger entry cannot be built is the user's to fix (the
        // payment rows do not add up), not a server fault — show it as it is.
        if (e instanceof GlBuildError) return NextResponse.json({ error: e.message }, { status: 422 });
        return handleApiError(e, "Failed to update voucher");
    }
}

// DELETE /api/inventory/vouchers/[id]  — only allowed on DRAFT
export async function DELETE(_req: Request, { params }: Params) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const existing = await prisma.voucherDetail.findUnique({ where: { id: Number(id) }, include: { universalVoucher: { select: { status: true } } } });   // 5D-8
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.universalVoucher?.status !== "DRAFT") {
        return NextResponse.json({ error: "Only DRAFT vouchers can be deleted via this route. Use /cancel or /delete for lifecycle." }, { status: 409 });
    }
    await prisma.voucherInventoryLine.deleteMany({ where: { universalVoucherId: existing.universalVoucherId ?? -1 } });
    await prisma.voucherDetail.delete({ where: { id: Number(id) } });
    return NextResponse.json({ ok: true });
}
