import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { calcLineTotals, calcVoucherTotals } from "@/modules/inventory/lib/stock";
import { toNumber, nextRefFromSeries } from "@/modules/accountancy/lib/balance";
import { recordStockMovement } from "@/modules/inventory/lib/stockMovement";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import { postInvVoucherToGl } from "@/modules/accountancy/lib/postInvVoucher";
import * as Sentry from "@sentry/nextjs";
import { handleApiError } from "@/shared/lib/api";

type Params = { params: Promise<{ id: string }> };

// GET /api/inventory/vouchers/[id]
export async function GET(_req: Request, { params }: Params) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const voucher = await prisma.invVoucher.findUnique({
        where: { id: Number(id) },
        include: {
            lines: {
                include: {
                    product: {
                        select: { id: true, sku: true, name: true, unit: { select: { code: true, label: true } } },
                    },
                },
            },
            stockEntries: { include: { product: { select: { id: true, sku: true, name: true } } } },
            createdBy: { select: { name: true } },
            branch:    { select: { id: true, name: true } },
            // refVoucher powers parent-link surfaces — "Replaces <old ref>"
            // for a SALE_RETURN against a SALE, or "Linked to PO-…" on a GRN.
            refVoucher: { select: { id: true, reference: true, type: true } },
            // Multi-tender + additional charges so the form's edit-mode
            // hydration (?voucherId=) can rebuild the rows it presented
            // to the operator on the original save.
            tenders: {
                orderBy: { id: "asc" },
                include: { account: { select: { id: true, name: true, code: true } } },
            },
            charges: {
                orderBy: { id: "asc" },
                include: { account: { select: { id: true, name: true, code: true } } },
            },
        },
    });
    if (!voucher) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(voucher);
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

    const existing = await prisma.invVoucher.findUnique({
        where: { id },
        include: { lines: { include: { product: { select: { id: true, stock: true } } } } },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
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
                const isPurchase = existing.type === "PURCHASE" || existing.type === "GRN" || existing.type === "REJECTION_IN" || existing.type === "SALE_RETURN";
                // POS = counter sale: same stock-out + GL shape as SALE (postInvVoucherToGl
                // treats POS like SALE), so a posted-POS edit reverses + re-posts like a sale.
                const isSale     = existing.type === "SALE"     || existing.type === "POS" || existing.type === "CHALLAN" || existing.type === "REJECTION_OUT" || existing.type === "PURCHASE_RETURN";

                // Reverse stock — write counter entries against the same
                // voucher id and adjust the cached InvProduct.stock so the
                // running balance matches pre-original state.
                for (const line of existing.lines) {
                    const qty = toNumber(line.quantity);
                    const freeQty = line.freeQty != null ? toNumber(line.freeQty) : 0;
                    const totalQty = qty + freeQty;
                    if (totalQty <= 0) continue;

                    // For non-purchase/non-sale types (e.g., POS POSTED edits)
                    // we still write a zero-qty ledger row as audit trail; the
                    // helper's internal `delta === 0` guard then skips the
                    // product/branch updates.
                    await recordStockMovement(tx, {
                        voucherId: existing.id,
                        productId: line.productId,
                        branchId:  existing.branchId,
                        date:      new Date(),
                        inQty:     isSale     ? totalQty : 0,
                        outQty:    isPurchase ? totalQty : 0,
                        rate:      line.rate,
                        amount:    -toNumber(line.amount),
                    });
                }

                // Reverse GL — post a reversal JE and cancel the original.
                if (existing.journalEntryId) {
                    const origJe = await tx.journalEntry.findUnique({
                        where: { id: existing.journalEntryId },
                        include: { lines: { include: { account: { select: { normalBalance: true } } } } },
                    });
                    if (origJe && origJe.status === "POSTED") {
                        const jeRef = await nextRefFromSeries(tx, "GL_POSTING", userId);

                        const reversalLines = origJe.lines.map((l) => ({
                            accountId:   l.accountId,
                            type:        (l.type === "DEBIT" ? "CREDIT" : "DEBIT") as "DEBIT" | "CREDIT",
                            amount:      toNumber(l.amount),
                            description: `EDIT: ${l.description ?? ""}`,
                        }));

                        const revJe = await tx.journalEntry.create({
                            data: {
                                date:        new Date(),
                                reference:   jeRef,
                                description: `EDIT (reverse): ${origJe.description}`,
                                status:      "POSTED",
                                postedAt:    new Date(),
                                createdById: userId,
                                lines:       { create: reversalLines },
                            },
                        });

                        for (const rl of reversalLines) {
                            const origLine = origJe.lines.find((l) => l.accountId === rl.accountId)!;
                            const delta = origLine.account.normalBalance === "DEBIT"
                                ? (rl.type === "DEBIT" ? rl.amount : -rl.amount)
                                : (rl.type === "CREDIT" ? rl.amount : -rl.amount);
                            await tx.account.update({
                                where: { id: rl.accountId },
                                data:  { balance: { increment: delta } },
                            });
                        }

                        // Tally-style: original JE stays POSTED. The reversal
                        // JE above nets it out at the line level (so ledger
                        // running balance is correct) and is the audit signal
                        // for "this was edited". Marking the original as
                        // CANCELLED would hide it from the POSTED-only ledger
                        // view while the reversal stayed visible — leaving the
                        // counter-entry with no original to cancel out, and
                        // breaking the closing balance.
                        void revJe;
                    }
                }
            }

            // ────────────────────────────────────────────────────────────
            // PHASE 2 — Apply the user's edits (header + lines)
            // ────────────────────────────────────────────────────────────
            if (computedLines) {
                await tx.invVoucherLine.deleteMany({ where: { voucherId: id } });
            }
            // Additional Charges + Tenders — delete-and-recreate when
            // provided (even as empty arrays, signalling "clear them all").
            // The same pattern the lines block uses above. Keeps the
            // post → reverse → re-post lifecycle simple: every PATCH that
            // touches these sections fully replaces the rows.
            if (charges !== undefined) {
                await tx.invVoucherCharge.deleteMany({ where: { voucherId: id } });
            }
            if (tenders !== undefined) {
                await tx.invVoucherTender.deleteMany({ where: { voucherId: id } });
            }
            // Status stays POSTED for posted edits; the re-post below sets a
            // fresh journalEntryId. For draft edits the row is unchanged.
            await tx.invVoucher.update({
                where: { id },
                data: {
                    ...(date        ? { date: new Date(date) } : {}),
                    ...(description ? { description: description.trim() } : {}),
                    ...(partyName        !== undefined ? { partyName:        partyName        || null } : {}),
                    ...(partyType        !== undefined ? { partyType:        partyType        || null } : {}),
                    ...(partyId          !== undefined ? { partyId:          partyId          || null } : {}),
                    ...(partyPhone       !== undefined ? { partyPhone:       partyPhone       || null } : {}),
                    ...(partyAddress     !== undefined ? { partyAddress:     partyAddress     || null } : {}),
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
                    // Clear the link to the now-cancelled JE; re-post fills it.
                    ...(wasPosted ? { journalEntryId: null } : {}),
                    ...(computedLines ? {
                        lines: {
                            create: computedLines.map((l) => ({
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
                        },
                    } : {}),
                    ...(charges && charges.length > 0 ? {
                        charges: {
                            create: charges.map((e) => ({
                                accountId:   e.accountId,
                                description: e.description?.trim() || null,
                                amount:      e.amount,
                            })),
                        },
                    } : {}),
                    ...(tenders && tenders.length > 0 ? {
                        tenders: {
                            create: tenders.map((t) => ({
                                accountId: t.accountId,
                                amount:    t.amount,
                                method:    t.method ?? null,
                                reference: t.reference?.trim() || null,
                            })),
                        },
                    } : {}),
                },
            });

            // ────────────────────────────────────────────────────────────
            // PHASE 3 — Re-post stock + GL (POSTED only)
            // ────────────────────────────────────────────────────────────
            if (wasPosted) {
                const fresh = await tx.invVoucher.findUnique({
                    where: { id },
                    include: {
                        lines: { include: { product: { select: { id: true, mrpPaise: true, stock: true } } } },
                        // Multi-tender + additional-charge rows flow through
                        // to postInvVoucherToGl so the re-posted JE has one
                        // leg per row.
                        tenders: {
                            orderBy: { id: "asc" },
                            include: { account: { select: { id: true, name: true, normalBalance: true, group: { select: { type: true } } } } },
                        },
                        charges: {
                            include: { account: { select: { id: true, name: true, normalBalance: true, group: { select: { type: true } } } } },
                        },
                    },
                });
                if (!fresh) throw new Error("Voucher disappeared mid-transaction");

                const isPurchase = ["PURCHASE", "GRN", "REJECTION_IN", "SALE_RETURN"].includes(fresh.type);
                const isSale     = ["SALE", "POS", "CHALLAN", "REJECTION_OUT", "PURCHASE_RETURN"].includes(fresh.type);

                for (const line of fresh.lines) {
                    const qty = toNumber(line.quantity);
                    const freeQty = line.freeQty != null ? toNumber(line.freeQty) : 0;
                    const totalQty = qty + freeQty;
                    if (totalQty <= 0) continue;
                    let inQty = 0, outQty = 0;
                    if (isPurchase) inQty = totalQty; else if (isSale) outQty = totalQty;
                    if (inQty === 0 && outQty === 0) continue;

                    await recordStockMovement(tx, {
                        voucherId: fresh.id,
                        productId: line.productId,
                        branchId:  fresh.branchId,
                        date:      fresh.date,
                        inQty,
                        outQty,
                        rate:      line.rate,
                        amount:    line.amount,
                        productCurrentStock: line.product.stock,
                        newMrpPaise: isPurchase && line.mrpPaise != null ? line.mrpPaise : undefined,
                    });
                }

                let journalEntryId: number | null = null;
                if (["SALE", "POS", "PURCHASE", "SALE_RETURN", "PURCHASE_RETURN"].includes(fresh.type)) {
                    const out = await postInvVoucherToGl(tx, {
                        voucherId: fresh.id,
                        voucher:   fresh,
                        userId,
                    });
                    journalEntryId = out.journalEntryId;
                }

                await tx.invVoucher.update({
                    where: { id },
                    data:  {
                        // Already POSTED — just refresh the JE link.
                        journalEntryId,
                        postedAt: new Date(),
                    },
                });
            }

            return tx.invVoucher.findUnique({
                where: { id },
                include: {
                    lines: { include: { product: { select: { id: true, sku: true, name: true } } } },
                    createdBy: { select: { name: true } },
                },
            });
        }, { timeout: 30_000, maxWait: 10_000 });

        // After-commit pricing recompute — union of old lines (just reversed)
        // and new lines (just posted). Both sets can affect cost basis.
        const touchedProductIds = new Set<number>();
        for (const l of existing.lines) touchedProductIds.add(l.productId);
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
    await prisma.invVoucherLine.deleteMany({ where: { voucherId: Number(id) } });
    await prisma.invVoucher.delete({ where: { id: Number(id) } });
    return NextResponse.json({ ok: true });
}
