import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { recordStockMovement } from "@/modules/inventory/lib/stockMovement";
import { linkVoucherChildrenToSpine } from "@/modules/inventory/lib/voucherSpineLink";
import { valueStockBatch } from "@/modules/inventory/lib/valuation";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import { saleToSpec } from "@/modules/accountancy/lib/voucherMappers";
import { readSettlement } from "@/shared/lib/accountancy/settlement";
import { enginePost } from "@/modules/accountancy/lib/transactionEngine";
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
                    product: { select: { id: true, mrpPaise: true, stock: true } },
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
    // POS_ESTIMATE / POS_ORDER are counter quotations/orders — like SALES_ORDER
    // they NEVER move stock or post GL (defensive; they're created DRAFT via the
    // POS endpoints and have no "post" UI).
    const isCommitment = voucher.type === "SALES_ORDER" || voucher.type === "PURCHASE_ORDER"
        || voucher.type === "POS_ESTIMATE" || voucher.type === "POS_ORDER";
    const isPhysicalStock = voucher.type === "PHYSICAL_STOCK";
    const isManufacturingJournal = voucher.type === "MANUFACTURING_JOURNAL";
    const isBranchTransfer = voucher.type === "BRANCH_TRANSFER";
    // Fixed-direction trading types (stock IN/OUT decided by type) route through
    // the Transaction Engine — stock + GL in one `enginePost`. PHYSICAL_STOCK /
    // MANUFACTURING_JOURNAL / BRANCH_TRANSFER keep their bespoke logic below.
    const isFixedDirection = isSale || isPurchase;

    if (isBranchTransfer && !voucher.destinationBranchId) {
        return NextResponse.json({ error: "Branch Transfer is missing a destination branch — edit the draft and pick one." }, { status: 422 });
    }
    if (isBranchTransfer && voucher.destinationBranchId === voucher.branchId) {
        return NextResponse.json({ error: "Source and destination branches must differ." }, { status: 422 });
    }

    try {
        // Resolve GST place-of-supply BEFORE opening the interactive transaction.
        // These are read-only lookups (org singleton + party state) that don't
        // depend on anything the tx writes, so they don't need to be inside it.
        // Critically, getOrganisation() runs on the GLOBAL prisma pool — calling
        // it inside the interactive tx grabs a SECOND pooled connection (pgbouncer
        // contention) and adds round-trips to the tx's time budget, which is what
        // helped push posting past the 5s ceiling (P2028). Hoisting shrinks the tx.
        const isTradingVoucher = ["SALE", "PURCHASE", "SALE_RETURN", "PURCHASE_RETURN"].includes(voucher.type);
        let sellerStateCode = "";
        let buyerStateCode  = "";
        if (isTradingVoucher) {
            const org = await getOrganisation();
            sellerStateCode = (voucher.branch?.gstStateCode || org.gstStateCode || "").trim();
            buyerStateCode = (voucher.placeOfSupply ?? "").trim();
            if (!buyerStateCode) {
                // Live lookup against party — covers legacy rows where
                // placeOfSupply was never set.
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
                buyerStateCode = resolveBuyerStateCode(
                    party,
                    sellerStateCode,
                    voucher.deliveryMode ?? "COUNTER",
                );
            }
        }

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
                            voucherId: voucher.id,
                            productId: line.productId,
                            branchId:  voucher.branchId,
                            date:      voucher.date,
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
                    { ...voucher, tenders: settlement.tenders, charges: settlement.charges, sellerStateCode, buyerStateCode },
                    { voucherId: voucher.id, branchId: voucher.branchId, lines: voucher.lines },
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
                        `Cannot post ${voucher.type} ${voucher.reference}: engine produced no journal entry.`,
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
                        date:        voucher.date,
                        description: `Manufacturing Charges for ${voucher.reference}`,
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
                                description: `Charges paid for ${voucher.reference}`,
                            },
                        ],
                        stockMoves: [],
                    }, userId, { existingSpineId: voucher.universalVoucherId });
                    journalEntryId = out.journalEntryId; universalVoucherId = out.universalVoucherId;
                    postNotes.push(`Posted ${settlement.charges.length} expense debit(s) totalling ${totalCharges.toFixed(2)}.`);
                }
            }

            // Phase 5 5.0: flip the draft spine to POSTED. Idempotent — the GL
            // paths (enginePost existingSpineId) already flipped it (the DRAFT
            // guard makes this a no-op then); non-GL types (GRN / Challan /
            // Rejection / Physical Stock / orders) get flipped here so the spine
            // status tracks the voucher even without GL lines.
            if (universalVoucherId != null) {
                await tx.universalVoucher.updateMany({
                    where: { id: universalVoucherId, status: "DRAFT" },
                    data:  { status: "POSTED", postedAt: new Date(), sourceCreatedAt: new Date() },
                });
            }
            // Phase 5 5C: link the just-written stock rows (+ goods lines) to the spine.
            await linkVoucherChildrenToSpine(tx, voucher.id, universalVoucherId);

            // ── 3. Mark voucher as POSTED ─────────────────────────────────
            const updated = await tx.invVoucher.update({
                where: { id: voucher.id },
                data:  {
                    status:        "POSTED",
                    postedAt:      new Date(),
                    journalEntryId,
                    universalVoucherId,
                },
                include: {
                    lines: { include: { product: { select: { id: true, sku: true, name: true } } } },
                    createdBy: { select: { name: true } },
                },
            });
            return { result: updated, notes: postNotes };
        // Stock-ledger walk + GL post + N account-balance updates are all
        // sequential round-trips; over the Supabase pooler this overruns the
        // default 5s interactive-transaction ceiling (P2028) even though the
        // work itself finishes in ~5s. Match the sibling PATCH route's 30s
        // headroom (see vouchers/[id]/route.ts).
        }, { timeout: 30_000, maxWait: 10_000 });

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
