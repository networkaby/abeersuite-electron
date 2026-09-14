// The single voucher POST implementation.
//
// This is the body of `POST /api/inventory/vouchers/[id]/post`, lifted out so the
// create route can run it in the SAME transaction instead of the client making a
// second HTTP call. One implementation, two callers, deliberately: the comment
// further down about cancel/delete drifting away from post is the same hazard, and
// a second copy of this is exactly how it would happen again.
//
// Everything here runs inside the caller's `tx`. It never opens one, and it never
// resolves anything it could have been handed: the GST state codes are worked out
// before the transaction (see `resolvePostGstStates`) because `getOrganisation()`
// runs on the global pool, and calling it inside an open interactive transaction
// takes a SECOND pooled connection while the first one is still held.

import type { Prisma, InvVoucherDeliveryMode } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { invNextRef } from "@/modules/inventory/lib/stock";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { recordStockMovement, stockDirectionForType } from "@/modules/inventory/lib/stockMovement";
import { valueStockBatch } from "@/modules/inventory/lib/valuation";
import { saleToSpec } from "@/modules/accountancy/lib/voucherMappers";
import { readSettlement } from "@/shared/lib/accountancy/settlement";
import { enginePost } from "@/modules/accountancy/lib/transactionEngine";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { resolveBuyerStateCode } from "@/shared/lib/gst/resolveBuyerState";

/** Tagged error: the GL bridge returned without creating a ledger entry for a
 *  trading voucher (SALE/PURCHASE/SALE_RETURN/PURCHASE_RETURN). Callers turn this
 *  into HTTP 422 with the bridge's diagnostic `notes` so the UI can show why
 *  (missing ledger, no party account, etc.). Thrown INSIDE the transaction, so the
 *  stock-ledger writes and the status flip roll back with it and the voucher stays
 *  DRAFT until the underlying chart-of-accounts / party issue is fixed. */
export class GlPostFailedError extends Error {
    readonly notes: string[];
    constructor(message: string, notes: string[]) {
        super(message);
        this.name = "GlPostFailedError";
        this.notes = notes;
    }
}

/** A goods line as the post path reads it. */
export interface PostableLine {
    productId:  number;
    quantity:   Prisma.Decimal | number | string;
    freeQty?:   Prisma.Decimal | number | string | null;
    rate:       Prisma.Decimal | number | string;
    amount:     Prisma.Decimal | number | string;
    mrpPaise?:  number | null;
    direction?: string | null;
    product:    { id: number; stock: number | null; mrpPaise?: number | null };
}

/** The voucher as the post path reads it - the detail row, its spine, its lines. */
export interface PostableVoucher {
    id:                  number;
    universalVoucherId:  number | null;
    type:                string;
    branchId:            string;
    destinationBranchId: string | null;
    placeOfSupply:       string | null;
    deliveryMode:        InvVoucherDeliveryMode | null;
    partyType:           string | null;
    partyId:             number | null;
    settlementJson:      Prisma.JsonValue | null;
    // The money the GL builder posts against — frozen on the detail row.
    partyJson:           Prisma.JsonValue | null;
    subtotal:            Prisma.Decimal | number;
    taxAmount:           Prisma.Decimal | number;
    shippingAmt:         Prisma.Decimal | number;
    shippingTaxAmt?:     Prisma.Decimal | number | null;
    roundOff:            Prisma.Decimal | number;
    totalAmount:         Prisma.Decimal | number;
    discountAmt?:        Prisma.Decimal | number | null;
    universalVoucher: {
        date:        Date;
        voucherNo:   string | null;
        description: string | null;
        branch?:     { gstStateCode: string | null } | null;
    } | null;
    lines: PostableLine[];
}

/** Which arm of the post path a voucher kind takes. ONE classification, read by
 *  both callers, so a kind can never be a commitment in one and a trading voucher
 *  in the other. */
export function classifyVoucherPost(type: string) {
    const stockDirection = stockDirectionForType(type);
    const isPurchase = stockDirection === "IN";
    const isSale     = stockDirection === "OUT";
    return {
        isPurchase,
        isSale,
        // POS_ESTIMATE / POS_ORDER / ONLINE_ORDER are counter/online quotations &
        // orders - like SALES_ORDER they NEVER move stock or post GL here.
        isCommitment: type === "SALES_ORDER" || type === "PURCHASE_ORDER"
            || type === "POS_ESTIMATE" || type === "POS_ORDER" || type === "ONLINE_ORDER",
        isPhysicalStock:        type === "PHYSICAL_STOCK",
        isManufacturingJournal: type === "MANUFACTURING_JOURNAL",
        isBranchTransfer:       type === "BRANCH_TRANSFER",
        // Fixed-direction trading types (stock IN/OUT decided by type) route through
        // the Transaction Engine - stock + GL in one `enginePost`. PHYSICAL_STOCK /
        // MANUFACTURING_JOURNAL / BRANCH_TRANSFER keep their bespoke logic.
        isFixedDirection: isSale || isPurchase,
        isTradingVoucher: ["SALE", "ONLINE_INVOICE", "PURCHASE", "SALE_RETURN", "PURCHASE_RETURN"].includes(type),
    };
}

/**
 * Seller + buyer state codes for the CGST/SGST-vs-IGST split, resolved BEFORE the
 * transaction opens. Read-only lookups that depend on nothing the transaction
 * writes; see the note at the top of this file for why they must not sit inside it.
 *
 * `knownBranchState` lets a caller that already loaded the branch skip that lookup
 * entirely - the create route has it in hand.
 */
export async function resolvePostGstStates(
    voucher: Pick<PostableVoucher, "type" | "placeOfSupply" | "deliveryMode" | "partyType" | "partyId" | "universalVoucher">,
    knownBranchState?: string | null,
): Promise<{ sellerStateCode: string; buyerStateCode: string }> {
    if (!classifyVoucherPost(voucher.type).isTradingVoucher) {
        return { sellerStateCode: "", buyerStateCode: "" };
    }
    const org = getOrganisation();
    const branchState = knownBranchState ?? voucher.universalVoucher?.branch?.gstStateCode ?? null;
    const sellerStateCode = (branchState || org.gstStateCode || "").trim();

    let buyerStateCode = (voucher.placeOfSupply ?? "").trim();
    if (!buyerStateCode) {
        // Live lookup against party - covers legacy rows where placeOfSupply was
        // never set.
        let party: { gstin: string | null; gstStateCode: string | null; shippingStateCode: string | null } | null = null;
        if (voucher.partyType === "customer" && voucher.partyId) {
            party = await prisma.person.findUnique({
                where: { id: voucher.partyId },
                select: { gstin: true, gstStateCode: true, shippingStateCode: true },
            });
        } else if (voucher.partyType === "company" && voucher.partyId) {
            party = await prisma.company.findUnique({
                where: { id: voucher.partyId },
                select: { gstin: true, gstStateCode: true, shippingStateCode: true },
            });
        }
        buyerStateCode = resolveBuyerStateCode(party, sellerStateCode, voucher.deliveryMode ?? "COUNTER");
    }
    return { sellerStateCode, buyerStateCode };
}

/**
 * Post one inventory voucher, inside the caller's transaction.
 *
 *   1. Stock ledger + cached InvProduct / InvProductBranch stock
 *   2. GL via the Transaction Engine (trading kinds, and MJ charge rows)
 *   3. Number the spine, flip it to POSTED, link the detail to it
 *
 * Returns the updated detail row (with its lines) and any diagnostic notes.
 */
export async function postVoucherInTx(
    tx: Prisma.TransactionClient,
    args: {
        voucher:         PostableVoucher;
        userId:          number;
        sellerStateCode: string;
        buyerStateCode:  string;
    },
): Promise<{ result: { id: number } & Record<string, unknown>; notes: string[] }> {
    const { voucher, userId, sellerStateCode, buyerStateCode } = args;
    const {
        isPurchase, isSale, isCommitment, isPhysicalStock,
        isManufacturingJournal, isBranchTransfer, isFixedDirection, isTradingVoucher,
    } = classifyVoucherPost(voucher.type);
    const goodsLines = voucher.lines;

    // ── 1. Stock ledger + cached InvProduct.stock ─────────────────
    // Commitments (SO / PO) skip stock entirely. Trading vouchers
    // (SALE/PURCHASE/etc.) use a fixed direction. Manufacturing
    // Journal uses per-line `direction` to decide IN vs OUT.
    // Physical Stock is a stock-take override: the entered qty is
    // the OPENING for voucher.universalVoucher!.date. We insert one adjustment row at
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
                universalVoucherId: voucher.universalVoucherId!,
                productId: line.productId,
                branchId:  voucher.branchId,
                date:      voucher.universalVoucher!.date,
                inQty:     0,
                outQty:    qty,
                rate:      line.rate,
                amount:    line.amount,
                updateOrgWideStock: false,
            });

            // Destination side: IN
            await recordStockMovement(tx, {
                universalVoucherId: voucher.universalVoucherId!,
                productId: line.productId,
                branchId:  destBranchId,
                date:      voucher.universalVoucher!.date,
                inQty:     qty,
                outQty:    0,
                rate:      line.rate,
                amount:    line.amount,
                updateOrgWideStock: false,
            });
        }
    } else if (!isCommitment && !isFixedDirection) {
        // PHYSICAL_STOCK + MANUFACTURING_JOURNAL only — fixed-direction
        // trading types now move stock via the engine (below).
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
                const priorSameDay = await tx.voucherDetail.count({
                    where: {
                        id:       { not: voucher.id },
                        // 5D-8 status + 5D-10 date + 5D-11 type + 5D-12 branch on spine + Phase 5 5C: goods lines hang off the spine.
                        universalVoucher: { type: "PHYSICAL_STOCK", status: "POSTED", date: voucher.universalVoucher!.date, branchId: voucher.branchId, inventoryLines: { some: { productId: line.productId } } },
                    },
                });
                if (priorSameDay === 0) {
                    // First PS of the day for this product → absolute reset.
                    // IMPORTANT: only sum ledger rows whose source voucher
                    // is still POSTED (and not soft-deleted). Cancelled
                    // vouchers leave their original entry in place with a
                    // counter-entry dated when the cancel happened — that
                    // counter-entry is often outside the < voucher.universalVoucher!.date
                    // window, which would double-count the original. The
                    // join via voucher.status guarantees we only see the
                    // true pre-date balance.
                    const priorEntries = await tx.invStockLedger.findMany({
                        where: {
                            productId: line.productId,
                            branchId:  voucher.branchId,
                            date:      { lt: voucher.universalVoucher!.date },
                            universalVoucher: { status: "POSTED", deletedAt: null },
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
                // PHYSICAL_STOCK rate stamping: a counted-up delta
                // has no purchase price of its own, but the ledger
                // walk (valuation.ts) still treats it as a normal
                // inward lot. Stamp the current LAST_INWARD rate so
                // WA/SIMPLE/FIFO arrive at sensible costs. Outward
                // deltas don't need a rate (FIFO/WA only consume
                // inward lots).
                let stampedRate = line.rate as unknown as number | string;
                if (isPhysicalStock && inQty > 0) {
                    const r = await valueStockBatch(
                        [{ id: line.productId, stock: line.product.stock }],
                        "LAST_INWARD",
                    );
                    const u = r.get(line.productId)?.unitCost ?? 0;
                    stampedRate = u > 0 ? u : toNumber(line.rate);
                }

                // Cost basis is derived from the ledger walk — no
                // costPaise cache to refresh. MRP is printed on the
                // box, not derived, so we still stamp it from supplier
                // paperwork on purchase lines.
                await recordStockMovement(tx, {
                    universalVoucherId: voucher.universalVoucherId!,
                    productId: line.productId,
                    branchId:  voucher.branchId,
                    date:      voucher.universalVoucher!.date,
                    inQty,
                    outQty,
                    rate:      stampedRate,
                    amount:    line.amount,
                    productCurrentStock: line.product.stock,
                    newMrpPaise: isPurchase && line.mrpPaise != null ? line.mrpPaise : undefined,
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
    // Phase 5 5.0: the draft spine created at voucher-save (POST attaches
    // its GL lines + flips it). Null for pre-5.0 drafts → engine create-posted.
    let universalVoucherId: number | null = voucher.universalVoucherId ?? null;
    const postNotes: string[] = [];
    // G4b: tender/charge input from settlementJson (replaced the tables).
    const settlement = readSettlement(voucher.settlementJson);
    if (isFixedDirection) {
        // Stock + GL through the Transaction Engine in ONE call (one tx).
        // `saleToSpec` builds the GL lines (shared with the legacy bridge
        // → byte-identical, parity-harness-verified) plus the stock moves;
        // `enginePost` writes both arms. sellerStateCode/buyerStateCode
        // were resolved before the tx (the CGST/SGST vs IGST split inputs).
        // GL JE lines stay branch-less (org-level), exactly as the legacy
        // bridge produced them (no branchId passed to the engine).
        const spec = await saleToSpec(
            tx,
            { ...voucher, date: voucher.universalVoucher!.date, reference: voucher.universalVoucher?.voucherNo ?? null, description: voucher.universalVoucher?.description ?? voucher.type, tenders: settlement.tenders, charges: settlement.charges, sellerStateCode, buyerStateCode },
            { branchId: voucher.branchId, lines: voucher.lines },
        );
        const out = await enginePost(tx, spec, userId, { existingSpineId: voucher.universalVoucherId });
        journalEntryId = out.journalEntryId; universalVoucherId = out.universalVoucherId;
        // A GL-posting trading voucher (SALE / PURCHASE / returns) MUST
        // produce a balanced JE — Balance Sheet / Day Book / P&L read GL
        // only, so a POSTED-without-JE voucher is invisible. Stock-only
        // fixed-direction types (GRN / Challan / Rejection) legitimately
        // have a null JE, so fail loud only for the GL-posting kinds.
        if (isTradingVoucher && journalEntryId === null) {
            throw new GlPostFailedError(
                `Cannot post ${voucher.type} ${voucher.universalVoucher?.voucherNo ?? ""}: engine produced no journal entry.`,
                [],
            );
        }
    } else if (isManufacturingJournal && settlement.charges.length > 0) {
        // Build the JE: N expense debits + 1 payment-account credit.
        // The payment account is the single tender row on the MJ
        // voucher. Total of all charges = total credited to that account.
        const totalCharges = settlement.charges.reduce((s, e) => s + toNumber(e.amount), 0);
        const paymentTender = settlement.tenders[0];
        if (totalCharges <= 0) {
            postNotes.push("Manufacturing Journal has expense lines but total charges = 0; skipping JE.");
        } else if (!paymentTender) {
            throw new Error("Manufacturing Journal with Charges requires a payment tender row (cash / bank / sundry creditors).");
        } else {
            // Settlement is id-only (no account relation) — load the charge
            // ledgers to validate they're EXPENSE-type + for descriptions.
            const accIds = [...new Set(settlement.charges.map((e) => e.accountId))];
            const accs = await tx.account.findMany({ where: { id: { in: accIds } }, select: { id: true, name: true, group: { select: { type: true } } } });
            const accById = new Map(accs.map((a) => [a.id, a]));
            for (const e of settlement.charges) {
                if (accById.get(e.accountId)?.group?.type !== "EXPENSE") {
                    throw new Error(`Charge line account "${accById.get(e.accountId)?.name ?? e.accountId}" must be an EXPENSE-type ledger.`);
                }
            }
            // N expense debits + 1 payment-account credit → the engine
            // (engineGlArm writes the JE + balance deltas + loads natures).
            const out = await enginePost(tx, {
                type:        "MANUFACTURING_JOURNAL",
                date:        voucher.universalVoucher!.date,
                description: `Manufacturing Charges for ${voucher.universalVoucher?.voucherNo ?? ""}`,
                glLines: [
                    ...settlement.charges.map((e) => ({
                        accountId:   e.accountId,
                        type:        "DEBIT" as const,
                        amount:      toNumber(e.amount),
                        description: e.description ?? `Manufacturing charge: ${accById.get(e.accountId)?.name ?? ""}`.trim(),
                    })),
                    {
                        accountId:   paymentTender.accountId,
                        type:        "CREDIT" as const,
                        amount:      totalCharges,
                        description: `Charges paid for ${voucher.universalVoucher?.voucherNo ?? ""}`,
                    },
                ],
                stockMoves: [],
            }, userId, { existingSpineId: voucher.universalVoucherId });
            journalEntryId = out.journalEntryId; universalVoucherId = out.universalVoucherId;
            postNotes.push(`Posted ${settlement.charges.length} expense debit(s) totalling ${totalCharges.toFixed(2)}.`);
        }
    }

    // Phase 5 5.0: flip the draft spine to POSTED — for the kinds that need it
    // here. Non-GL types (GRN / Challan / Rejection / Physical Stock / orders,
    // Branch Transfer) never pass through the engine's GL arm, so this is where
    // their spine takes its status and its NUMBER.
    //
    // A GL-posting voucher skips the whole block. `engineGlArm` has already set
    // status, postedAt, sourceCreatedAt and voucherNo on the same spine, so the
    // read and the update below could only ever match nothing — this used to run
    // anyway and spend two round trips discovering that, on every single sale.
    // `journalEntryId` is the honest test: it is non-null exactly when the GL arm
    // ran, and a trading voucher that produced no entry has already thrown.
    if (universalVoucherId != null && journalEntryId == null) {
        // …and this is where those non-GL types take their NUMBER, since
        // they never pass through the engine's GL arm. Only when the spine
        // still has none: a GL path above has already numbered it, and a
        // draft numbered before numbering moved to post time keeps its own.
        const spine = await tx.universalVoucher.findUnique({
            where:  { id: universalVoucherId },
            select: { status: true, voucherNo: true },
        });
        const reference = spine?.status === "DRAFT" && !spine.voucherNo
            ? await invNextRef(tx, voucher.type as Parameters<typeof invNextRef>[1])
            : null;
        await tx.universalVoucher.updateMany({
            where: { id: universalVoucherId, status: "DRAFT" },
            data:  {
                status: "POSTED", postedAt: new Date(), sourceCreatedAt: new Date(),
                ...(reference ? { voucherNo: reference } : {}),
            },
        });
    }
    // Phase 5 5C: link the just-written stock rows (+ goods lines) to the spine.

    // ── 3. Link the detail to its (now POSTED) spine ──────────────
    // 5D-8: status POSTED set on the spine above; 5D-5: postedAt too.
    const updated = await tx.voucherDetail.update({
        where: { id: voucher.id },
        data:  {
            universalVoucherId,
        },
        include: { universalVoucher: { select: { createdById: true } } },   // 5D-2: creator on spine
    });
    // Phase 5 5C: goods lines hang off the spine. Posting does not change
    // them, so the rows loaded before the transaction are still the rows —
    // reading them back out would be a round trip for the same answer. The
    // creator's name is resolved after the commit (below), so a lookup for
    // one display field does not sit inside the transaction.
    const updatedWithLines = { ...updated, lines: goodsLines };
    return { result: updatedWithLines, notes: postNotes };
}
