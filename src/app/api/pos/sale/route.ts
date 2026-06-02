import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { invNextRef, calcVoucherTotals } from "@/modules/inventory/lib/stock";
import { recordStockMovement } from "@/modules/inventory/lib/stockMovement";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import { postInvVoucherToGl } from "@/modules/accountancy/lib/postInvVoucher";
import * as Sentry from "@sentry/nextjs";
import { validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { checkCreditLimit, CreditLimitError } from "@/shared/lib/accountancy/checkCreditLimit";
import {
    ratesFromConfig,
    buildRulesIndex,
    redeemableBaseForCart,
    clampRedemption,
    applyLoyaltyForSale,
    applyMilestones,
    liveBalance,
    type EarnLine,
    type TaxonomyMaps,
    type MilestoneTier,
} from "@/modules/loyalty/lib";
// Note: branch context comes from the cashier's active shift, NOT from the
// session cookie. This allows multiple browsers / users to bill in parallel
// from different counters without their active-branch cookie interfering.

// POST /api/pos/sale
//
// Atomic POS sale — single InvVoucher (type=POS) carrying items, multi-
// tender settlement rows (Cash / UPI / Card / etc.), stock movement, and
// GST routing. One balanced JE per voucher; no separate Receipt voucher
// or VoucherAllocation. Same shape as office SALE post-Layer 7.
//
// Posting flow (one $transaction):
//   1. Resolve customer Account, branch state, validate tender total.
//   2. Create InvVoucher + lines + tender rows in a single nested write.
//   3. postInvVoucherToGl → one JE: Dr per tender (Till / Bank / AR) /
//      Cr Sales / Cr CGST+SGST or IGST. Wire JE id back onto voucher.
//   4. InvStockLedger + per-branch + org-wide stock decrement per line.
//
// Replaces the prior three-step write (Invoice + InvoiceLine + Payment),
// later the receipt-voucher detour, with the unified tender shape.
//
// As of 2026-05-14 the route requires the cashier to have an OPEN PosShift
// in the active branch. The CASH portion of any payment auto-debits the
// shift's tillAccountId; non-CASH portions debit the user-picked bank account.
// See docs/modules/pos.md.

const lineSchema = z.object({
    productId:   z.number().int().positive(),
    description: z.string().trim().min(1),
    quantity:    z.number().positive(),
    unitPrice:   z.number().min(0),
    taxRate:     z.number().min(0).max(100).default(0),
});

const paymentSchema = z.object({
    method:    z.enum(["CASH", "BANK_TRANSFER", "CARD", "CHEQUE", "MOBILE_PAYMENT", "OTHER"]),
    amount:    z.number().positive(),
    accountId: z.number().int().positive().optional(),   // required for non-CASH; CASH auto-routes to till
    reference: z.string().trim().max(120).optional(),
});

// Signed amount — positive raises the bill (Cr Income leg), negative lowers it
// (Dr Expense leg). Mirrors office SALE charges. accountId is the GL account
// the leg posts against.
const chargeSchema = z.object({
    accountId:   z.number().int().positive(),
    description: z.string().trim().max(200).optional(),
    amount:      z.number().refine((n) => Math.abs(n) >= 0.005, "Charge amount must be non-zero"),
});

const createSchema = z.object({
    accountId: z.number().int().positive(),                                       // customer AR account
    issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dueDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    notes:     z.string().trim().optional(),
    lines:     z.array(lineSchema).min(1, "At least one line item required"),
    payments:  z.array(paymentSchema).min(1, "At least one payment line required"),
    shippingAmt: z.number().min(0).default(0),
    roundOff:    z.number().default(0),  // signed
    charges:     z.array(chargeSchema).default([]),
    // Voucher-level tier discount (₹). Reduces the bill via the existing
    // discountAmt → "Discount Allowed" path. Client-supplied (cashier-trusted,
    // same as line prices). Server still validates payment total == bill total.
    discountAmt: z.number().min(0).default(0),
    // Loyalty points the customer wants to burn. The server is authoritative for
    // the ₹ value (recomputed from LoyaltyConfig) and validates against balance.
    redeemPoints: z.number().int().min(0).default(0),
});

class GlPostFailedError extends Error {
    constructor(message: string, public notes: string[]) { super(message); }
}

export async function POST(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { data, error } = await validateRequest(req, createSchema);
    if (error) return error;
    const body = data;

    // ── Active shift requirement ──────────────────────────────────────────
    // Branch context comes from the shift, not the session cookie.
    // This lets multiple users bill in parallel from different browsers
    // without their active-branch cookie interfering.
    const shift = await prisma.posShift.findFirst({
        where:  { userId: user!.id, status: "OPEN" },
        select: {
            id: true, branchId: true,
            counter: {
                select: {
                    name: true,
                    tillAccountId:         true,
                    upiAccountId:          true,
                    cardAccountId:         true,
                    walletAccountId:       true,
                    chequeAccountId:       true,
                    bankTransferAccountId: true,
                },
            },
        },
    });
    if (!shift) {
        return NextResponse.json(
            { error: "Open a shift before billing.", code: "NO_OPEN_SHIFT" },
            { status: 400 },
        );
    }
    const tillAccountId  = shift.counter.tillAccountId;
    const activeBranchId = shift.branchId;
    // Per-method ledger map: server is the source of truth for which Account
    // each non-CASH method settles into. Null = method not accepted at this
    // counter. Operator configures these under /office/admin/counters.
    const counterMethodMap: Record<typeof body.payments[number]["method"], number | null> = {
        CASH:           tillAccountId,   // always — auto-routed
        MOBILE_PAYMENT: shift.counter.upiAccountId,
        CARD:           shift.counter.cardAccountId,
        OTHER:          shift.counter.walletAccountId,    // "Wallet" surface label
        CHEQUE:         shift.counter.chequeAccountId,
        BANK_TRANSFER:  shift.counter.bankTransferAccountId,
    };
    const counterName = shift.counter.name;

    // ── Resolve customer account (party ledger) ───────────────────────────
    // The new schema stores `accountId` directly on InvVoucher. We also
    // capture the display name + identity ids for the partyName/partyType/
    // partyId triple so postInvVoucherToGl can build the JE description and
    // any legacy reader (until Layer 5) still sees the old fields populated.
    const customerAccount = await prisma.account.findUnique({
        where:  { id: body.accountId },
        select: {
            id: true, name: true, personId: true, companyId: true,
            person:  { select: { name: true } },
            company: { select: { name: true } },
        },
    });
    if (!customerAccount) {
        return NextResponse.json({ error: "Customer account not found." }, { status: 422 });
    }
    const partyName = customerAccount.person?.name
                   ?? customerAccount.company?.name
                   ?? customerAccount.name;
    const partyType = customerAccount.personId !== null ? "customer"
                     : customerAccount.companyId !== null ? "company"
                     : "account";
    const partyId   = customerAccount.personId
                   ?? customerAccount.companyId
                   ?? customerAccount.id;

    // ── Loyalty context ───────────────────────────────────────────────────
    // Only identified customers (a real Person/Company account) earn or redeem;
    // anonymous walk-in / counter ledgers never accrue points.
    const isIdentified = customerAccount.personId !== null || customerAccount.companyId !== null;
    const loyaltyConfig = await prisma.loyaltyConfig.upsert({
        where: { id: 1 }, create: { id: 1 }, update: {},
    });
    const loyaltyRates = ratesFromConfig(loyaltyConfig);
    const loyaltyEnabled = isIdentified && loyaltyRates.enabled;
    // Live, dynamic balance — Σ in-window lots (respects the current expiry window).
    const loyaltyBalance = loyaltyEnabled
        ? await liveBalance(prisma, customerAccount.id, loyaltyRates)
        : 0;
    // Enabled milestone tiers (only loaded when loyalty is live for this customer).
    // Empty → the milestone award step is skipped entirely below.
    const milestoneTiers: MilestoneTier[] = loyaltyEnabled
        ? (await prisma.loyaltyMilestone.findMany({ where: { enabled: true }, orderBy: { threshold: "asc" } }))
            .map((m) => ({ id: m.id, threshold: Number(m.threshold), bonusPoints: m.bonusPoints, label: m.label }))
        : [];

    // ── Validate line items + payment totals ──────────────────────────────
    const computedLines = body.lines.map((l) => {
        const lineSubtotal = l.quantity * l.unitPrice;
        const lineTax = (lineSubtotal * l.taxRate) / 100;
        return {
            productId:   l.productId,
            description: l.description,
            quantity:    l.quantity,
            unitPrice:   l.unitPrice,
            taxRate:     l.taxRate,
            taxAmount:   lineTax,
            amount:      lineSubtotal + lineTax,
        };
    });
    // Shipping / round-off / charges parity with office SALE — same single
    // source of truth (calcVoucherTotals) so /api/inventory/vouchers and
    // /api/pos/sale always agree on the math.
    const taxAmount = computedLines.reduce((s, l) => s + l.taxAmount, 0);

    // ── Discounts: tier (Discount Allowed) + loyalty redemption (Loyalty Points
    // Redeemed) ───────────────────────────────────────────────────────────────
    // goodsValue = pre-tax goods (Σ qty × unit price). The tier discount rides the
    // voucher-level discountAmt path; the loyalty redemption rides a negative
    // charge to the dedicated ledger so the two are broken out in the P&L.
    const goodsValue = body.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    const tierDiscount = Math.min(Math.max(0, body.discountAmt), goodsValue);

    // Pre-redemption invoice value — drives the min-invoice-to-earn and
    // min-invoice-to-redeem floors (the bill the customer would pay before any
    // loyalty redemption is applied).
    const manualChargesNet = body.charges.reduce((s, c) => s + c.amount, 0);
    const invoiceValueGross = goodsValue + taxAmount + body.shippingAmt - tierDiscount + body.roundOff + manualChargesNet;

    // ── Pre-load loyalty earn context (reads, outside the tx) ──────────────
    // Resolves each line's taxonomy + the earn-rule index (earn multiplier AND
    // redeem-cap %) + group/category parent chains so both the per-line
    // multiplier and the cart-aware redeem ceiling (product → group → category →
    // global) can be computed. Skipped for walk-in / disabled — no extra queries.
    let earnLines: EarnLine[] = [];
    let rulesIndex = buildRulesIndex([]);
    let taxonomyMaps: TaxonomyMaps = { groupParent: new Map(), categoryParent: new Map() };
    if (loyaltyEnabled) {
        const productIds = [...new Set(body.lines.map((l) => l.productId))];
        const [products, groups, categories, rules] = await Promise.all([
            prisma.invProduct.findMany({ where: { id: { in: productIds } }, select: { id: true, groupId: true, categoryId: true } }),
            prisma.invProductGroup.findMany({ select: { id: true, parentId: true } }),
            prisma.invCategory.findMany({ select: { id: true, parentId: true } }),
            prisma.loyaltyEarnRule.findMany({ where: { enabled: true }, select: { scope: true, categoryId: true, groupId: true, productId: true, multiplier: true, redeemCapPct: true, enabled: true } }),
        ]);
        const taxById = new Map(products.map((p) => [p.id, p]));
        earnLines = body.lines.map((l) => {
            const p = taxById.get(l.productId);
            return { productId: l.productId, groupId: p?.groupId ?? null, categoryId: p?.categoryId ?? null, goods: l.quantity * l.unitPrice };
        });
        rulesIndex = buildRulesIndex(rules.map((r) => ({ ...r, multiplier: Number(r.multiplier), redeemCapPct: r.redeemCapPct == null ? null : Number(r.redeemCapPct) })));
        taxonomyMaps = {
            groupParent: new Map(groups.map((g) => [g.id, g.parentId])),
            categoryParent: new Map(categories.map((c) => [c.id, c.parentId])),
        };
    }

    // Server owns the redemption ₹ value — never trust the client. The ceiling is
    // cart-aware: Σ (line net × that item's redeem cap %), folding in the global
    // cap as the per-line default. Clamp against balance, that ceiling, and floors.
    const requestedRedeem = loyaltyEnabled ? body.redeemPoints : 0;
    const redeemCeiling = loyaltyEnabled
        ? redeemableBaseForCart(earnLines, tierDiscount, rulesIndex, taxonomyMaps, loyaltyRates.maxRedeemPctOfBill)
        : 0;
    const redemption = clampRedemption(requestedRedeem, loyaltyBalance, redeemCeiling, invoiceValueGross, loyaltyRates);
    if (requestedRedeem > 0 && redemption.points === 0 && redemption.reason) {
        return NextResponse.json({ error: redemption.reason, code: "LOYALTY_REDEEM_REJECTED" }, { status: 422 });
    }
    const redeemPoints     = redemption.points;
    const redemptionRupees = redemption.value;
    if (redemptionRupees > 0 && loyaltyConfig.redeemExpenseAccountId == null) {
        return NextResponse.json(
            { error: "Loyalty redemption ledger is not configured. Re-run the bootstrap seed.", code: "LOYALTY_LEDGER_MISSING" },
            { status: 422 },
        );
    }

    // Loyalty redemption as a negative charge row on the dedicated ledger. Posts
    // Dr "Loyalty Points Redeemed" via postInvVoucherToGl's charge handling and
    // lowers the bill via chargesNet — no change to the protected GL math.
    const loyaltyCharge = redemptionRupees > 0 && loyaltyConfig.redeemExpenseAccountId != null
        ? { accountId: loyaltyConfig.redeemExpenseAccountId, description: `Loyalty: ${redeemPoints} pts redeemed`, amount: -redemptionRupees }
        : null;
    const allCharges = loyaltyCharge ? [...body.charges, loyaltyCharge] : body.charges;

    const chargesNet = allCharges.reduce((s, c) => s + c.amount, 0);
    const { subtotal, totalAmount } = calcVoucherTotals(
        computedLines,
        body.shippingAmt,
        tierDiscount,   // voucher-level tier discount
        body.roundOff,
        chargesNet,     // includes the negative loyalty-redemption charge
    );

    const paymentTotal = body.payments.reduce((s, p) => s + p.amount, 0);
    if (Math.abs(paymentTotal - totalAmount) > 0.01) {
        return NextResponse.json(
            { error: `Payment total (₹${paymentTotal.toFixed(2)}) does not match invoice total (₹${totalAmount.toFixed(2)}).` },
            { status: 422 },
        );
    }

    // Resolve each payment line's settlement ledger via the counter's mapping.
    // The client-supplied `accountId` (if any) is ignored — the counter owns
    // routing so the same UPI transaction always lands on the same ledger no
    // matter which cashier is at the counter. Unmapped methods are rejected
    // here (the PosScreen also hides them, so this is a guardrail).
    const METHOD_LABEL: Record<typeof body.payments[number]["method"], string> = {
        CASH: "Cash", MOBILE_PAYMENT: "UPI", CARD: "Card", CHEQUE: "Cheque", BANK_TRANSFER: "Bank Transfer", OTHER: "Wallet",
    };
    const resolvedPayments: { method: typeof body.payments[number]["method"]; accountId: number; amount: number; reference?: string }[] = [];
    for (const p of body.payments) {
        const mappedAccountId = counterMethodMap[p.method];
        if (mappedAccountId == null) {
            return NextResponse.json(
                { error: `Counter "${counterName}" does not accept ${METHOD_LABEL[p.method]}. Map it under /office/admin/counters first.`, code: "PAYMENT_METHOD_NOT_MAPPED" },
                { status: 422 },
            );
        }
        resolvedPayments.push({ method: p.method, accountId: mappedAccountId, amount: p.amount, reference: p.reference });
    }

    // Amount that will increase the customer's AR balance (onCredit portion).
    // Currently the route enforces paymentTotal === totalAmount so this is
    // always 0 — the check is a forward-compatibility guard for partial payments.
    const onCredit = Math.max(0, totalAmount - paymentTotal);

    // POS is always counter-pickup → place of supply = branch state regardless
    // of customer's address (CGST Act §10(1)(c)). Resolve once, outside tx.
    const posBranch = await prisma.branch.findUnique({
        where: { id: activeBranchId },
        select: { gstStateCode: true },
    });
    const sellerStateCode = (posBranch?.gstStateCode || "").trim() || null;

    try {
        const result = await prisma.$transaction(async (tx) => {
            // ── Credit limit check (inside tx so balance read is fresh) ────
            await checkCreditLimit(tx, body.accountId, onCredit);

            // ── 1. InvVoucher (type=POS) + lines + tender rows ───────────
            // Single voucher carries the entire sale: items, tender rows
            // (Cash / UPI / Card — one per resolved payment, plus an AR
            // tender for any unsettled balance). postInvVoucherToGl posts
            // a single balanced JE per voucher; no separate Receipt
            // voucher / VoucherAllocation needed.
            const voucherRef = await invNextRef(tx, "POS");
            // POS today enforces paymentTotal == totalAmount, so onCredit
            // is always 0 and no AR tender is needed. Kept as a future-
            // facing branch in case partial POS sales get enabled.
            const arRemainder = totalAmount - paymentTotal;
            const tenderPayload = [
                ...resolvedPayments.map((p) => ({
                    accountId: p.accountId,
                    amount:    p.amount,
                    method:    p.method,
                    reference: p.reference ?? null,
                })),
                ...(arRemainder > 0.005
                    ? [{ accountId: customerAccount.id, amount: arRemainder, method: null as null, reference: null as null }]
                    : []),
            ];
            const voucher = await tx.invVoucher.create({
                data: {
                    type:           "POS",
                    reference:      voucherRef,
                    branchId:       activeBranchId,
                    date:           new Date(body.issueDate),
                    description:    body.notes?.trim() || `POS sale — ${partyName}`,
                    status:         "POSTED",
                    postedAt:       new Date(),
                    accountId:      customerAccount.id,
                    partyName,
                    partyType,
                    partyId,
                    deliveryMode:   "COUNTER",
                    placeOfSupply:  sellerStateCode,
                    shippingAmt:    body.shippingAmt,
                    discountAmt:    tierDiscount,
                    roundOff:       body.roundOff,
                    subtotal,
                    taxAmount,
                    totalAmount,
                    createdById:    user!.id,
                    lines: {
                        create: computedLines.map((l) => ({
                            productId:   l.productId,
                            description: l.description,
                            quantity:    l.quantity,
                            rate:        l.unitPrice,
                            taxRate:     l.taxRate,
                            taxAmount:   l.taxAmount,
                            amount:      l.amount,
                        })),
                    },
                    tenders: {
                        create: tenderPayload.map((t) => ({
                            accountId: t.accountId,
                            amount:    t.amount,
                            method:    t.method,
                            reference: t.reference,
                        })),
                    },
                    ...(allCharges.length > 0 ? {
                        charges: {
                            create: allCharges.map((c) => ({
                                accountId:   c.accountId,
                                description: c.description?.trim() || null,
                                amount:      c.amount,
                            })),
                        },
                    } : {}),
                },
                include: {
                    lines:   true,
                    tenders: { include: { account: { select: { id: true, name: true, normalBalance: true, group: { select: { type: true } } } } } },
                    charges: { include: { account: { select: { id: true, name: true, normalBalance: true, group: { select: { type: true } } } } } },
                },
            });

            // ── 2. GL post (Dr Till/Bank + (optional) Dr Customer AR / Cr Sales / Cr GST) ─
            // postInvVoucherToGl reads the tender rows directly — one Dr
            // leg per tender. No back-compat single-paymentAccount path.
            const gl = await postInvVoucherToGl(tx, {
                voucherId: voucher.id,
                voucher: {
                    id:          voucher.id,
                    type:        voucher.type,
                    reference:   voucher.reference,
                    date:        voucher.date,
                    description: voucher.description,
                    partyName:   voucher.partyName,
                    partyType:   voucher.partyType,
                    partyId:     voucher.partyId,
                    subtotal:    voucher.subtotal,
                    taxAmount:   voucher.taxAmount,
                    shippingAmt: voucher.shippingAmt,
                    discountAmt: voucher.discountAmt,
                    roundOff:    voucher.roundOff,
                    totalAmount: voucher.totalAmount,
                    tenders:     voucher.tenders.map((t) => ({
                        accountId: t.accountId,
                        amount:    Number(t.amount),
                        account:   t.account,
                    })),
                    charges:     voucher.charges.map((c) => ({
                        accountId:   c.accountId,
                        amount:      Number(c.amount),
                        description: c.description,
                        account:     c.account,
                    })),
                    sellerStateCode,
                    buyerStateCode: sellerStateCode, // counter pickup → intra-state
                },
                userId: user!.id,
            });
            if (gl.journalEntryId === null) {
                throw new GlPostFailedError(
                    `Cannot post POS sale ${voucherRef}: GL bridge could not build a journal entry.`,
                    gl.notes,
                );
            }
            await tx.invVoucher.update({
                where: { id: voucher.id },
                data:  { journalEntryId: gl.journalEntryId },
            });

            // ── 3b. Loyalty: redeem (consume oldest lots) + earn (new lot) ─
            // Identified customers only. Runs inside the tx so points move
            // atomically with the sale; a GL failure above already rolled back.
            let loyaltyResult = { pointsEarned: 0, pointsRedeemed: 0, newBalance: loyaltyBalance };
            let milestoneBonus = 0;
            if (loyaltyEnabled) {
                loyaltyResult = await applyLoyaltyForSale(tx, {
                    accountId:        customerAccount.id,
                    voucherId:        voucher.id,
                    earnLines,
                    combinedDiscount: tierDiscount + redemptionRupees,
                    redeemPoints,
                    invoiceValue:     invoiceValueGross,
                    rates:            loyaltyRates,
                    rulesIndex,
                    taxonomyMaps,
                    createdById:      user!.id,
                });

                // ── Milestone bonus points: award any lifetime-spend tier the
                // customer has now crossed (one-time per tier). Lifetime spend is
                // aggregated inside the tx so it includes the just-posted sale.
                if (milestoneTiers.length > 0) {
                    const spendAgg = await tx.invVoucher.aggregate({
                        where: { accountId: customerAccount.id, type: { in: ["SALE", "POS"] }, status: "POSTED", deletedAt: null },
                        _sum: { totalAmount: true },
                    });
                    const lifetimeSpend = Number(spendAgg._sum.totalAmount ?? 0);
                    const ms = await applyMilestones(tx, {
                        accountId:     customerAccount.id,
                        lifetimeSpend,
                        voucherId:     voucher.id,
                        milestones:    milestoneTiers,
                        rates:         loyaltyRates,
                        createdById:   user!.id,
                    });
                    milestoneBonus = ms.awarded.reduce((s, a) => s + a.points, 0);
                    if (ms.awarded.length > 0) loyaltyResult.newBalance = ms.newBalance;
                }
            }

            // ── 4. Stock ledger + per-branch + org-wide stock decrement ───
            const date = new Date(body.issueDate);
            for (const line of voucher.lines) {
                const qty = Number(line.quantity);
                if (qty <= 0) continue;
                await recordStockMovement(tx, {
                    voucherId: voucher.id,
                    productId: line.productId,
                    branchId:  activeBranchId,
                    date,
                    inQty:  0,
                    outQty: qty,
                    rate:   line.rate,
                    amount: line.amount,
                });
            }

            return {
                voucherId:      voucher.id,
                voucherRef:     voucher.reference,
                journalEntryId: gl.journalEntryId,
                shiftId:        shift.id,
                // Loyalty outcome — surfaced on the POS success toast.
                pointsEarned:   loyaltyResult.pointsEarned,
                pointsRedeemed: loyaltyResult.pointsRedeemed,
                milestoneBonus,
                loyaltyBalance: loyaltyResult.newBalance,
                // Back-compat aliases — PosScreen still reads these names.
                invoiceId:      voucher.id,
                invoiceNumber:  voucher.reference,
            };
        }, {
            // POS does voucher + GL post + per-line stock movement in ONE
            // interactive transaction. Each line costs ~3 sequential DB
            // round-trips (ledger insert + product-stock update + per-branch
            // upsert), so a large cart (10+ items) blows past Prisma's 5s
            // default and the transaction expires mid-sale ("query cannot be
            // executed on an expired transaction"). Match the office voucher
            // post route's window so big carts settle reliably.
            timeout: 30_000,
            maxWait: 10_000,
        });

        const touchedProductIds = body.lines.map((l) => l.productId);
        await recomputePricesForProducts(touchedProductIds).catch((err: unknown) => {
            Sentry.captureException(err, { tags: { source: "price-recompute", voucherId: String(result.voucherId) } });
            console.error("[price-recompute] failed for voucher", result.voucherId, err);
        });

        return NextResponse.json(result, { status: 201 });
    } catch (err) {
        if (err instanceof CreditLimitError) {
            return NextResponse.json({ error: err.message, code: err.code }, { status: 422 });
        }
        if (err instanceof GlPostFailedError) {
            return NextResponse.json({ error: err.message, notes: err.notes }, { status: 500 });
        }
        console.error("[pos sale]", err);
        const msg = err instanceof Error ? err.message : "Failed to create POS sale";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
