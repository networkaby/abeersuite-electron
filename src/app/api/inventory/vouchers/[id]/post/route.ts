import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { toNumber, nextRefFromSeries } from "@/modules/accountancy/lib/balance";
import { recordStockMovement } from "@/modules/inventory/lib/stockMovement";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import { postInvVoucherToGl } from "@/modules/accountancy/lib/postInvVoucher";
import * as Sentry from "@sentry/nextjs";
import { handleApiError } from "@/shared/lib/api";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { resolveBuyerStateCode } from "@/shared/lib/gst/resolveBuyerState";

// Tagged error: the GL bridge returned without creating a JournalEntry for a
// trading voucher (SALE/PURCHASE/SALE_RETURN/PURCHASE_RETURN). The outer catch
// converts this into HTTP 422 with the bridge's diagnostic `notes` so the UI
// can show why (missing ledger, no party account, etc.). Throwing inside the
// $transaction rolls back stock-ledger writes and the status=POSTED update,
// so the voucher stays DRAFT until the underlying COA / party issue is fixed.
class GlPostFailedError extends Error {
    readonly notes: string[];
    constructor(message: string, notes: string[]) {
        super(message);
        this.name = "GlPostFailedError";
        this.notes = notes;
    }
}

// POST /api/inventory/vouchers/[id]/post
//   1. Write InvStockLedger entries + update cached InvProduct.stock
//   2. Auto-create GL JournalEntry via postInvVoucherToGl (SALE / PURCHASE only)
//   3. Mark voucher as POSTED
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response, user } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const userId = user!.id;

    const voucher = await prisma.invVoucher.findUnique({
        where: { id: Number(id) },
        include: {
            lines: {
                include: {
                    product: { select: { id: true, costPaise: true, mrpPaise: true, stock: true } },
                },
            },
            // Additional GL legs ("+ Add Account" rows + MJ Charges) +
            // multi-tender settlement rows. Both passed through to
            // postInvVoucherToGl so the JE includes one leg per row.
            charges: {
                include: {
                    account: { select: { id: true, name: true, normalBalance: true, group: { select: { type: true } } } },
                },
            },
            tenders: {
                orderBy: { id: "asc" },
                include: {
                    account: { select: { id: true, name: true, normalBalance: true, group: { select: { type: true } } } },
                },
            },
            // Branch state drives the seller-state in the CGST/SGST vs IGST split.
            branch: {
                select: { id: true, gstStateCode: true },
            },
        },
    });

    if (!voucher)                  return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (voucher.status !== "DRAFT") return NextResponse.json({ error: `Voucher is already ${voucher.status}` }, { status: 409 });

    // Stock-direction classification per voucher type:
    //   incoming stock: PURCHASE, GRN, REJECTION_IN, SALE_RETURN
    //                   (sale return: customer returns goods → stock back in)
    //   outgoing stock: SALE, CHALLAN, REJECTION_OUT, PURCHASE_RETURN
    //                   (purchase return: we return to supplier → stock back out)
    //   per-line direction: MANUFACTURING_JOURNAL (line.direction "CONSUME"|"PRODUCE")
    //   start-of-day reset: PHYSICAL_STOCK (line.quantity = counted opening qty)
    //   commitments:   SALES_ORDER, PURCHASE_ORDER — no stock movement at all on POST.
    const isPurchase = ["PURCHASE", "GRN", "REJECTION_IN", "SALE_RETURN"].includes(voucher.type);
    const isSale     = ["SALE", "CHALLAN", "REJECTION_OUT", "PURCHASE_RETURN"].includes(voucher.type);
    const isCommitment = voucher.type === "SALES_ORDER" || voucher.type === "PURCHASE_ORDER";
    const isPhysicalStock = voucher.type === "PHYSICAL_STOCK";
    const isManufacturingJournal = voucher.type === "MANUFACTURING_JOURNAL";
    const isBranchTransfer = voucher.type === "BRANCH_TRANSFER";

    if (isBranchTransfer && !voucher.destinationBranchId) {
        return NextResponse.json({ error: "Branch Transfer is missing a destination branch — edit the draft and pick one." }, { status: 422 });
    }
    if (isBranchTransfer && voucher.destinationBranchId === voucher.branchId) {
        return NextResponse.json({ error: "Source and destination branches must differ." }, { status: 422 });
    }

    try {
        const { result, notes } = await prisma.$transaction(async (tx) => {
            // ── 1. Stock ledger + cached InvProduct.stock ─────────────────
            // Commitments (SO / PO) skip stock entirely. Trading vouchers
            // (SALE/PURCHASE/etc.) use a fixed direction. Manufacturing
            // Journal uses per-line `direction` to decide IN vs OUT.
            // Physical Stock is a stock-take override: the entered qty is
            // the OPENING for voucher.date. We insert one adjustment row at
            // start-of-day = (counted_qty − running_stock_pre_date), so any
            // same-date sales/purchases that already exist still apply on
            // top of the new opening when the running stock is recomputed.
            if (isBranchTransfer) {
                // Branch Transfer: same product, just moved between branches.
                //   • Two InvStockLedger rows per line — qty- on source, qty+ on destination.
                //   • InvProductBranch[source].stock −=, InvProductBranch[dest].stock +=.
                //   • InvProduct.stock (org-wide cache) is UNCHANGED — the org still
                //     owns the same units.
                const destBranchId = voucher.destinationBranchId!;
                for (const line of voucher.lines) {
                    const qty = toNumber(line.quantity);
                    if (!(qty > 0)) continue;

                    // Source side: OUT
                    await recordStockMovement(tx, {
                        voucherId: voucher.id,
                        productId: line.productId,
                        branchId:  voucher.branchId,
                        date:      voucher.date,
                        inQty:     0,
                        outQty:    qty,
                        rate:      line.rate,
                        amount:    line.amount,
                        updateOrgWideStock: false,
                    });

                    // Destination side: IN
                    await recordStockMovement(tx, {
                        voucherId: voucher.id,
                        productId: line.productId,
                        branchId:  destBranchId,
                        date:      voucher.date,
                        inQty:     qty,
                        outQty:    0,
                        rate:      line.rate,
                        amount:    line.amount,
                        updateOrgWideStock: false,
                    });
                }
            } else if (!isCommitment) {
                for (const line of voucher.lines) {
                    const qty = toNumber(line.quantity);
                    const freeQty = line.freeQty != null ? toNumber(line.freeQty) : 0;
                    const totalQty = qty + freeQty;
                    let inQty = 0, outQty = 0;

                    if (isPurchase)         inQty = totalQty;
                    else if (isSale)        outQty = totalQty;
                    else if (isManufacturingJournal) {
                        // Per-line direction drives stock movement. Free qty
                        // doesn't apply on this voucher type.
                        if (line.direction === "CONSUME")      outQty = qty;
                        else if (line.direction === "PRODUCE") inQty = qty;
                        else continue;   // direction missing → skip; defensive
                    }
                    else if (isPhysicalStock) {
                        // "Combine sum" semantics: multiple Physical Stock
                        // vouchers on the same (product, branch, date) add up.
                        // - The FIRST PS voucher of the date sets absolute
                        //   opening: delta = counted_qty − pre_date_running.
                        // - Each subsequent PS voucher just adds its counted
                        //   qty on top (delta = counted_qty).
                        // We detect "first" by checking whether any earlier
                        //   POSTED PS voucher exists for this (product, branch,
                        //   date). voucher.id is excluded so re-running on the
                        //   same DRAFT is idempotent.
                        const priorSameDay = await tx.invVoucher.count({
                            where: {
                                type:     "PHYSICAL_STOCK",
                                status:   "POSTED",
                                branchId: voucher.branchId,
                                date:     voucher.date,
                                id:       { not: voucher.id },
                                lines:    { some: { productId: line.productId } },
                            },
                        });
                        if (priorSameDay === 0) {
                            // First PS of the day for this product → absolute reset.
                            // IMPORTANT: only sum ledger rows whose source voucher
                            // is still POSTED (and not soft-deleted). Cancelled
                            // vouchers leave their original entry in place with a
                            // counter-entry dated when the cancel happened — that
                            // counter-entry is often outside the < voucher.date
                            // window, which would double-count the original. The
                            // join via voucher.status guarantees we only see the
                            // true pre-date balance.
                            const priorEntries = await tx.invStockLedger.findMany({
                                where: {
                                    productId: line.productId,
                                    branchId:  voucher.branchId,
                                    date:      { lt: voucher.date },
                                    voucher:   { status: "POSTED", deletedAt: null },
                                },
                                select: { inQty: true, outQty: true },
                            });
                            const priorRunning = priorEntries.reduce(
                                (s, e) => s + toNumber(e.inQty) - toNumber(e.outQty),
                                0,
                            );
                            const delta = qty - priorRunning;
                            if (delta >= 0) inQty  = delta;
                            else            outQty = -delta;
                        } else {
                            // Subsequent PS voucher of the day → additive.
                            inQty = qty;
                        }
                    }

                    if (inQty > 0 || outQty > 0) {
                        // Update cost basis on inwards:
                        //  • Purchase-family vouchers update costPaise from the
                        //    supplier rate (existing behaviour).
                        //  • Manufacturing Journal PRODUCE lines also update
                        //    costPaise — the rate the operator entered (cost
                        //    basis = consumed materials + overhead share) is
                        //    the new cost price for the produced finished good.
                        const updateCost = isPurchase
                            || (isManufacturingJournal && line.direction === "PRODUCE" && toNumber(line.rate) > 0);
                        await recordStockMovement(tx, {
                            voucherId: voucher.id,
                            productId: line.productId,
                            branchId:  voucher.branchId,
                            date:      voucher.date,
                            inQty,
                            outQty,
                            rate:      line.rate,
                            amount:    line.amount,
                            productCurrentStock: line.product.stock,
                            newCostPaise: updateCost ? Math.round(toNumber(line.rate) * 100) : undefined,
                            newMrpPaise:  isPurchase && line.mrpPaise != null ? line.mrpPaise : undefined,
                        });
                    }
                }
            }

            // ── 2. Auto-post to GL ────────────────────────────────────────
            // Trading vouchers (SALE / PURCHASE / SALE_RETURN / PURCHASE_RETURN)
            // flow through postInvVoucherToGl with their full AR/AP/Revenue/etc.
            // chart. Manufacturing Journal posts a much simpler JE only when
            // the voucher has expense (Charges) lines — one debit per expense
            // account + a single credit to paymentAccountId for the total.
            // Other types (GRN, Challan, Rejections, Physical Stock, Sales/
            // Purchase Order) intentionally don't touch GL on POST.
            let journalEntryId: number | null = null;
            const postNotes: string[] = [];
            if (["SALE", "PURCHASE", "SALE_RETURN", "PURCHASE_RETURN"].includes(voucher.type)) {
                // Resolve seller / buyer state for the CGST/SGST vs IGST split.
                // Prefer the placeOfSupply that was stamped at save time
                // (immutable audit trail); otherwise resolve live from party +
                // delivery mode + branch as a defensive fallback.
                const org = await getOrganisation();
                const sellerStateCode = (voucher.branch?.gstStateCode || org.gstStateCode || "").trim();
                let buyerStateCode = (voucher.placeOfSupply ?? "").trim();
                if (!buyerStateCode) {
                    // Live lookup against party — covers legacy rows where
                    // placeOfSupply was never set.
                    let party: { gstin: string | null; gstStateCode: string | null; shippingStateCode: string | null } | null = null;
                    if (voucher.partyType === "customer" && voucher.partyId) {
                        party = await tx.person.findUnique({
                            where: { id: voucher.partyId },
                            select: { gstin: true, gstStateCode: true, shippingStateCode: true },
                        });
                    } else if (voucher.partyType === "company" && voucher.partyId) {
                        party = await tx.company.findUnique({
                            where: { id: voucher.partyId },
                            select: { gstin: true, gstStateCode: true, shippingStateCode: true },
                        });
                    }
                    buyerStateCode = resolveBuyerStateCode(
                        party,
                        sellerStateCode,
                        voucher.deliveryMode ?? "COUNTER",
                    );
                }

                const out = await postInvVoucherToGl(tx, {
                    voucherId: voucher.id,
                    voucher: { ...voucher, sellerStateCode, buyerStateCode },
                    userId,
                });
                journalEntryId = out.journalEntryId;
                postNotes.push(...out.notes);
                // A trading voucher MUST produce a balanced JournalEntry — the
                // top-bar Cash/Bank/Receivables/Payables widgets, Balance Sheet,
                // Day Book and P&L all read GL only, so a POSTED-without-JE
                // voucher is invisible to every consumer. Fail loud rather
                // than create another silent orphan. Rollback is automatic via
                // the surrounding $transaction.
                if (journalEntryId === null) {
                    throw new GlPostFailedError(
                        `Cannot post ${voucher.type} ${voucher.reference}: GL bridge could not build a journal entry.`,
                        out.notes,
                    );
                }
            } else if (isManufacturingJournal && voucher.charges.length > 0) {
                // Build the JE: N expense debits + 1 payment-account credit.
                // The payment account is the single tender row on the MJ
                // voucher (Layer 7g — replaces the legacy `paymentAccountId`
                // column). Total of all charges = total credited to that
                // account.
                const totalCharges = voucher.charges.reduce(
                    (s, e) => s + toNumber(e.amount),
                    0,
                );
                const paymentTender = voucher.tenders[0];
                if (totalCharges <= 0) {
                    postNotes.push("Manufacturing Journal has expense lines but total charges = 0; skipping JE.");
                } else if (!paymentTender) {
                    throw new Error("Manufacturing Journal with Charges requires a payment tender row (cash / bank / sundry creditors).");
                } else {
                    // Validate each expense account is an EXPENSE-type ledger.
                    for (const e of voucher.charges) {
                        if (e.account?.group?.type !== "EXPENSE") {
                            throw new Error(`Charge line account "${e.account?.name ?? e.accountId}" must be an EXPENSE-type ledger.`);
                        }
                    }
                    const jeRef = await nextRefFromSeries(tx, "GL_POSTING", userId);
                    const je = await tx.journalEntry.create({
                        data: {
                            date:        voucher.date,
                            reference:   jeRef,
                            description: `Manufacturing Charges for ${voucher.reference}`,
                            status:      "POSTED",
                            postedAt:    new Date(),
                            createdById: userId,
                            lines: {
                                create: [
                                    ...voucher.charges.map((e) => ({
                                        accountId: e.accountId,
                                        type:      "DEBIT" as const,
                                        amount:    toNumber(e.amount),
                                        description: e.description ?? `Manufacturing charge: ${e.account?.name ?? ""}`.trim(),
                                    })),
                                    {
                                        accountId: paymentTender.accountId,
                                        type:      "CREDIT" as const,
                                        amount:    totalCharges,
                                        description: `Charges paid for ${voucher.reference}`,
                                    },
                                ],
                            },
                        },
                    });
                    journalEntryId = je.id;

                    // Apply balance deltas. Each ledger's balance direction
                    // follows normalBalance: a DEBIT line increments DEBIT-
                    // normal accounts and decrements CREDIT-normal ones.
                    for (const e of voucher.charges) {
                        const acct = e.account!;
                        const debitDelta = toNumber(e.amount);
                        const delta = acct.normalBalance === "DEBIT" ? debitDelta : -debitDelta;
                        await tx.account.update({ where: { id: acct.id }, data: { balance: { increment: delta } } });
                    }
                    if (paymentTender.account) {
                        const credit = totalCharges;
                        const delta = paymentTender.account.normalBalance === "CREDIT" ? credit : -credit;
                        await tx.account.update({ where: { id: paymentTender.account.id }, data: { balance: { increment: delta } } });
                    }
                    postNotes.push(`Posted JE ${jeRef}: ${voucher.charges.length} expense debit(s) totalling ${totalCharges.toFixed(2)} → ${paymentTender.account?.name ?? "payment account"}.`);
                }
            }

            // ── 3. Mark voucher as POSTED ─────────────────────────────────
            const updated = await tx.invVoucher.update({
                where: { id: voucher.id },
                data:  {
                    status:        "POSTED",
                    postedAt:      new Date(),
                    journalEntryId,
                },
                include: {
                    lines: { include: { product: { select: { id: true, sku: true, name: true } } } },
                    createdBy: { select: { name: true } },
                },
            });
            return { result: updated, notes: postNotes };
        });

        // After-commit pricing recompute. Failure must NOT roll back the
        // voucher — log + Sentry-capture and continue.
        const touchedProductIds = voucher.lines.map((l) => l.productId);
        await recomputePricesForProducts(touchedProductIds).catch((err: unknown) => {
            Sentry.captureException(err, { tags: { source: "price-recompute", voucherId: String(voucher.id) } });
            console.error("[price-recompute] failed for voucher", voucher.id, err);
        });

        return NextResponse.json({ ...result, _postNotes: notes });
    } catch (e) {
        if (e instanceof GlPostFailedError) {
            return NextResponse.json(
                { error: e.message, notes: e.notes },
                { status: 422 },
            );
        }
        return handleApiError(e, "Failed to post voucher");
    }
}
