import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSystemInboxNotifications } from "@/modules/message/lib/inbox";
import { resolvePortalAccountContext } from "@/shared/lib/auth/portalAccountContext";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";
import { loadShopStockPolicy } from "@/shared/lib/shop/stockPolicy";
import { barcodeTagPaise } from "@/shared/lib/pricing/barcodePrice";
import { getOrdersPipeline } from "@/modules/ecommerce/lib/ordersPipeline";
import { computeShopCartBenefits } from "@/modules/ecommerce/lib/shopTierDiscount";
import { quoteShipping } from "@/modules/delivery/lib/shippingQuote";
import { resolvePayOnDelivery } from "@/shared/lib/payments/payOnDeliveryMethod";
import { loadDeliveryMethod, type ShiprocketConfig } from "@/modules/delivery/lib/deliveryMethods";
import { chargeableUnitGrams } from "@/modules/delivery/lib/chargeableWeight";
import { sourceCounterId } from "@/shared/lib/counter/sourceCounter";
import { saveAddress } from "@/shared/lib/address/personAddressServer";

const DEFAULT_ITEM_WEIGHT_GRAMS = 500;

const lineSchema = z.object({
    productId: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().positive().max(99),
});

const addressSchema = z.object({
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().min(6).max(20),
    line1: z.string().trim().min(1).max(200),
    line2: z.string().trim().max(200).optional().nullable(),
    landmark: z.string().trim().max(120).optional().nullable(),
    locality: z.string().trim().max(120).optional().nullable(),
    neighbourhood: z.string().trim().max(120).optional().nullable(),
    city: z.string().trim().min(1).max(80),
    state: z.string().trim().min(1).max(80),
    pincode: z.string().trim().regex(/^\d{6}$/u, "Enter a valid 6-digit pincode"),
});

const createOrderSchema = z.object({
    lines: z.array(lineSchema).min(1),
    accountId: z.coerce.number().int().positive(),
    shippingAddress: addressSchema,
    // The exact courier option the customer picked (e.g. "custom:2:0",
    // "shiprocket:3:51"). Re-priced server-side against the fresh quote.
    optionId: z.string().trim().min(1).max(80),
    paymentMethod: z.enum(["COD", "ONLINE"]).optional(),
    // The online gateway the customer chose at checkout (e.g. "razorpay", "payu",
    // "cashfree", "demo") — snapshotted so the order page opens the right flow.
    onlineProvider: z.string().trim().max(40).optional(),
    // Coupon code the customer applied (server re-validates via the shared POS
    // engine; the best AUTO offer applies even without a code).
    couponCode: z.string().trim().max(40).optional(),
    // Loyalty points the customer wants to burn (server clamps + validates;
    // the invoice conversion burns the lots when it posts).
    redeemPoints: z.coerce.number().int().min(0).optional(),
    // The saved address checkout started from (PersonAddress id); absent = typed new.
    addressId: z.coerce.number().int().positive().optional(),
});

export async function POST(req: Request) {
    try {
        const customerAuth = await requirePortalCustomer();
        if (customerAuth.response) return customerAuth.response;
        const { customerId } = customerAuth;

        const { data, error } = await validateRequest(req, createOrderSchema);
        if (error) return error;
        const { lines, accountId, shippingAddress, optionId, paymentMethod, onlineProvider, couponCode, redeemPoints } = data;

        const context = await resolvePortalAccountContext(customerId, accountId);
        if (context.active.accountId !== accountId) {
            return NextResponse.json({ error: "Account is not linked to this profile" }, { status: 403 });
        }

        const productIds = [...new Set(lines.map((l) => l.productId))];
        const [products, bands, ordersPipeline, stockPolicy, srMethod] = await Promise.all([
            prisma.invProduct.findMany({
                where: { id: { in: productIds }, isListedInShop: true, isActive: true },
            }),
            loadBarcodeBands(),
            getOrdersPipeline(prisma),
            loadShopStockPolicy(),
            loadDeliveryMethod("SHIPROCKET"),
        ]);
        const byId = new Map(products.map((p) => [p.id, p]));
        const fallbackWeight =
            Number((srMethod?.configJson as ShiprocketConfig | undefined)?.defaultItemWeightGrams) ||
            DEFAULT_ITEM_WEIGHT_GRAMS;

        let totalPaise = 0;
        let weightGrams = 0;
        const resolvedLines: { productId: number; quantity: number; unitPricePaise: number }[] = [];
        for (const l of lines) {
            const p = byId.get(l.productId);
            // Charge the barcode tag (what the storefront shows), falling back to
            // the effective price when there's no saved sale price.
            const unitPricePaise = p
                ? barcodeTagPaise(p.savedSalePricePaise, p.mrpPaise, bands, p.barcodeManualPaise) ?? p.effectiveSalePricePaise
                : null;
            if (!p || unitPricePaise == null) {
                return NextResponse.json({ error: `Unknown product ${l.productId}` }, { status: 400 });
            }
            // Short stock is allowed only when the product (or the org policy)
            // permits backorder; otherwise block the order.
            const backorderable = p.allowBackorder || stockPolicy === "BACKORDER";
            if (p.stock !== null && p.stock < l.quantity && !backorderable) {
                return NextResponse.json(
                    {
                        error:
                            p.stock <= 0
                                ? `“${p.name}” is out of stock.`
                                : `Not enough stock for “${p.name}”. Available: ${p.stock}.`,
                    },
                    { status: 400 }
                );
            }
            totalPaise += unitPricePaise * l.quantity;
            weightGrams += chargeableUnitGrams(p, fallbackWeight) * l.quantity;
            resolvedLines.push({
                productId: l.productId,
                quantity: l.quantity,
                unitPricePaise,
            });
        }

        // Re-price shipping server-side for the chosen courier — never trust a
        // client-sent amount. COD unless the customer chose the online (demo) rail.
        const isCod = (paymentMethod ?? "COD") === "COD";

        // Guard the Pay-on-Delivery rail server-side: reject a COD order when the
        // rail is switched off or the destination is outside its area rule.
        if (isCod) {
            const pod = await resolvePayOnDelivery(shippingAddress.pincode, shippingAddress.state);
            if (!pod.availableHere) {
                return NextResponse.json(
                    { error: "Pay on delivery isn't available for this address." },
                    { status: 400 },
                );
            }
        }
        const options = await quoteShipping({
            deliveryPincode: shippingAddress.pincode,
            deliveryState: shippingAddress.state,
            deliveryNeighbourhood: shippingAddress.neighbourhood ?? undefined,
            subtotalPaise: totalPaise,
            weightGrams,
            cod: isCod,
            // Same rule as the quote: a backorder cart cannot pick a quick option (owner, 2026-11-22).
            backorder: lines.some((l) => { const p = byId.get(l.productId); return !!p && p.stock !== null && p.stock < l.quantity; }),
        });
        const chosen = options.find((o) => o.optionId === optionId);
        if (!chosen) {
            return NextResponse.json(
                { error: "The selected delivery option is not available for this address." },
                { status: 400 }
            );
        }
        const shippingChargePaise = chosen.amountPaise;

        // ── Customer benefits (the SAME engines as the POS counter) ──────────
        // Tier + coupon finalized together (POS stacking rules: a non-stackable
        // coupon drops the tier; the global guard clamps the coupon). Resolved
        // server-side — the shopper's browser is never trusted; the cart /
        // checkout preview the identical numbers via /api/shop/tier-preview
        // (same helper). currentSaleValue = the bill BEFORE discount (goods
        // incl + shipping). Frozen here in paise — the price promised at
        // checkout never shifts.
        const benefits = await computeShopCartBenefits(
            prisma, accountId, resolvedLines, totalPaise + shippingChargePaise,
            { couponCode, autoApply: true, redeemPoints },
        );
        // An EXPLICIT code that fails is a hard error (the customer typed it and
        // expects the discount); a silently-failed AUTO offer just doesn't apply.
        if (couponCode?.trim() && benefits.couponError) {
            return NextResponse.json({ error: benefits.couponError, code: "COUPON_REJECTED" }, { status: 422 });
        }
        // Same for explicitly-requested points that could not apply.
        if ((redeemPoints ?? 0) > 0 && benefits.loyalty?.redeemError) {
            return NextResponse.json({ error: benefits.loyalty.redeemError, code: "LOYALTY_REDEEM_REJECTED" }, { status: 422 });
        }
        const loyaltyPts = benefits.loyalty?.redeemPoints ?? 0;
        const loyaltyPaise = benefits.loyalty?.redeemPaise ?? 0;
        if (loyaltyPaise > 0) {
            // The invoice must be able to post the redemption leg — refuse up
            // front rather than freeze an unpostable discount (POS parity).
            const loyaltyConfig = await prisma.loyaltyConfig.findUnique({ where: { id: 1 }, select: { redeemExpenseAccountId: true } });
            if (loyaltyConfig?.redeemExpenseAccountId == null) {
                return NextResponse.json(
                    { error: "Loyalty redemption ledger is not configured. Re-run the bootstrap seed.", code: "LOYALTY_LEDGER_MISSING" },
                    { status: 422 },
                );
            }
        }
        const tierDiscountInclPaise = benefits.discountInclPaise;
        const lineTierDiscPaise = benefits.lineDiscPaise;
        const couponPaise = benefits.coupon?.discountPaise ?? 0;
        // Rule 2 — independent PARTIAL (<100%) FREE_ITEM / BOGO on top: a ₹
        // discount never guard-clamped, never dropping tier / blocking loyalty.
        const onTopPaise = benefits.onTop?.discountPaise ?? 0;
        // Independent FREE-GRANT coupon (FREE_ITEM / BOGO) — the granted item
        // rides the order as a zero-price line; it never touches totalPaise.
        const freeGrant = benefits.freeGrant;
        // Rule 3 — a non-independent fully-free FREE_ITEM / BOGO that won the
        // MONEY slot: its item rides the order as a zero-price line too (the
        // coupon fields on the order carry it — exclusivity applies).
        const moneyGrant = benefits.moneyGrant;
        totalPaise -= tierDiscountInclPaise + couponPaise + onTopPaise + loyaltyPaise; // gateway/COD charges the NET

        // Place the order on the sales-orders pipeline (P7) at its entry stage —
        // it becomes a ticket on the staff orders board.
        const entryStatus = ordersPipeline?.statuses.find((s) => s.isEntryPoint);

        // An order is a Ticket (flavour "order") + TicketOrder detail on the orders
        // pipeline (P7). Core status = the pipeline entry stage; legacy enum on detail.
        // One tx: the coupon's usage slot (CouponRedemption, spine null until the
        // invoice posts) is taken atomically with the order that spends it.
        const t = await prisma.$transaction(async (tx) => {
            let couponRedemptionId: number | null = null;
            // Money slot: the ₹ coupon (rule 4) OR a money-grant (rule 3 —
            // amount 0; the slot is still the money one, so its redemption
            // rides the coupon fields).
            const moneyWinner = benefits.coupon ?? (moneyGrant ? { id: moneyGrant.couponId, code: moneyGrant.code, name: moneyGrant.name, discountPaise: 0 } : null);
            if (moneyWinner) {
                const red = await tx.couponRedemption.create({
                    data: {
                        couponId:  moneyWinner.id,
                        accountId,
                        universalVoucherId: null,   // stamped by the invoice conversion
                        amount:    moneyWinner.discountPaise / 100,
                        channel:   "SHOP",
                    },
                    select: { id: true },
                });
                couponRedemptionId = red.id;
            }
            // Free-grant coupon (rule 1): take its usage slot too (amount 0 — a
            // free grant is ₹-less by design; the row still enforces
            // total/per-customer caps and reverses on a full return, exactly
            // like the POS counter).
            let freeCouponRedemptionId: number | null = null;
            if (freeGrant) {
                const red = await tx.couponRedemption.create({
                    data: {
                        couponId: freeGrant.couponId,
                        accountId,
                        universalVoucherId: null,   // stamped by the invoice conversion
                        amount:    0,
                        channel:   "SHOP",
                    },
                    select: { id: true },
                });
                freeCouponRedemptionId = red.id;
            }
            // Rule 2 — on-top partial: its own usage slot with its ₹.
            let onTopRedemptionId: number | null = null;
            if (benefits.onTop) {
                const red = await tx.couponRedemption.create({
                    data: {
                        couponId: benefits.onTop.couponId,
                        accountId,
                        universalVoucherId: null,   // stamped by the invoice conversion
                        amount:    onTopPaise / 100,
                        channel:   "SHOP",
                    },
                    select: { id: true },
                });
                onTopRedemptionId = red.id;
            }
            return tx.ticket.create({
            data: {
                // Which till raised this — same column and resolver as every voucher.
                sourceCounterId: await sourceCounterId(tx),
                accountId: context.active.accountId,
                pipelineId: ordersPipeline?.id ?? null,
                status: entryStatus?.id ?? "S1",
                order: {
                    create: {
                        legacyStatus: "PENDING_PAYMENT",
                        paymentMethod: isCod ? "COD" : "ONLINE",
                        totalPaise,
                        shippingChargePaise,
                        // Frozen benefit snapshots (see block above). totalPaise is
                        // already NET of tier + coupon.
                        tierDiscountPaise: tierDiscountInclPaise,
                        tierDiscountPct: benefits.tierPct > 0 && tierDiscountInclPaise > 0 ? benefits.tierPct : null,
                        tierLabel: tierDiscountInclPaise > 0 ? benefits.tierLabel : null,
                        // The money winner — a ₹ coupon (rule 4) or a money-grant
                        // (rule 3, couponDiscountPaise 0 — its item is the free
                        // line below). Codeless AUTO offers freeze their display
                        // name instead.
                        couponId: benefits.coupon?.id ?? moneyGrant?.couponId ?? null,
                        couponCode: benefits.coupon ? (benefits.coupon.code ?? benefits.coupon.name)
                            : moneyGrant ? (moneyGrant.code ?? moneyGrant.name)
                            : null,
                        couponDiscountPaise: couponPaise,
                        couponRedemptionId,
                        // Independent FREE-GRANT coupon — the item rides the order
                        // as a zero-price line (freeQty below); no ₹, so
                        // couponDiscountPaise stays 0.
                        freeCouponId: freeGrant?.couponId ?? null,
                        freeCouponCode: freeGrant ? (freeGrant.code ?? freeGrant.name) : null,
                        freeCouponRedemptionId,
                        // Rule 2 — on-top partial ₹ (never guard-clamped).
                        onTopCouponId: benefits.onTop?.couponId ?? null,
                        onTopCouponCode: benefits.onTop ? (benefits.onTop.code ?? benefits.onTop.name) : null,
                        onTopDiscountPaise: onTopPaise,
                        onTopRedemptionId,
                        // Frozen loyalty redemption (points burn at invoice post).
                        loyaltyRedeemPoints: loyaltyPts,
                        loyaltyRedeemPaise: loyaltyPaise,
                        courier: chosen.kind,
                        personId: customerId,
                        guestEmail: null,
                        guestPhone: shippingAddress.phone,
                        shippingName: shippingAddress.name,
                        shippingAddress: {
                            name: shippingAddress.name,
                            phone: shippingAddress.phone,
                            line1: shippingAddress.line1,
                            line2: shippingAddress.line2 ?? null,
                            landmark: shippingAddress.landmark ?? null,
                            locality: shippingAddress.locality ?? null,
                            neighbourhood: shippingAddress.neighbourhood ?? null,
                            city: shippingAddress.city,
                            state: shippingAddress.state,
                            pincode: shippingAddress.pincode,
                            // Snapshot of the courier the customer picked (for the delivery step).
                            courierKind: chosen.kind,
                            courierOptionId: chosen.optionId,
                            courierService: chosen.serviceName ?? chosen.label,
                            // Store pickup only — the store's note (address / timings) so the
                            // order page can tell the customer where to collect.
                            pickupNote: chosen.pickupNote ?? null,
                            shiprocketCourierId: chosen.shiprocketCourierId ?? null,
                            shiprocketCourierName: chosen.shiprocketCourierName ?? null,
                            // Snapshot of the online gateway chosen at checkout (null for COD).
                            onlineProvider: isCod ? null : onlineProvider ?? null,
                        },
                        lines: {
                            create: [
                                ...resolvedLines.map((r, i) => ({
                                    productId: r.productId,
                                    quantity: r.quantity,
                                    unitPricePaise: r.unitPricePaise,
                                    // Whole-line pre-tax tier discount (paise) — the invoice
                                    // conversion replays it as the line's discountAmt.
                                    tierDiscountPaise: lineTierDiscPaise.get(i) ?? 0,
                                })),
                                // The granted free items as zero-price lines
                                // (quantity 0 + freeQty) — stock + COGS move at
                                // invoice, no money. Both the on-top grant (rule 1)
                                // and a money-slot grant (rule 3) can be present.
                                ...(freeGrant
                                    ? [{
                                        productId: freeGrant.productId,
                                        quantity: 0,
                                        freeQty: freeGrant.freeQty,
                                        unitPricePaise: 0,
                                        tierDiscountPaise: 0,
                                    }]
                                    : []),
                                ...(moneyGrant
                                    ? [{
                                        productId: moneyGrant.productId,
                                        quantity: 0,
                                        freeQty: moneyGrant.freeQty,
                                        unitPricePaise: 0,
                                        tierDiscountPaise: 0,
                                    }]
                                    : []),
                            ],
                        },
                    },
                },
            },
            select: {
                id: true,
                status: true,
                order: { select: { totalPaise: true, shippingChargePaise: true, tierDiscountPaise: true, tierLabel: true, couponCode: true, couponDiscountPaise: true, loyaltyRedeemPoints: true, loyaltyRedeemPaise: true, legacyStatus: true } },
            },
            });
        });
        const goods = t.order?.totalPaise ?? 0;
        const shipping = t.order?.shippingChargePaise ?? 0;
        const order = {
            id: t.id,
            totalPaise: goods,
            shippingChargePaise: shipping,
            grandTotalPaise: goods + shipping,
            // Frozen benefit snapshots — goods total above is already net of
            // them; returned so the order page can show the rows.
            tierDiscountPaise: t.order?.tierDiscountPaise ?? 0,
            tierLabel: t.order?.tierLabel ?? null,
            couponCode: t.order?.couponCode ?? null,
            couponDiscountPaise: t.order?.couponDiscountPaise ?? 0,
            loyaltyRedeemPoints: t.order?.loyaltyRedeemPoints ?? 0,
            loyaltyRedeemPaise: t.order?.loyaltyRedeemPaise ?? 0,
            // Free items — an on-top grant (rule 1) and/or a money-slot grant
            // (rule 3) — shown as FREE rows on the order page.
            freeItems: [
                ...(freeGrant ? [{ productId: freeGrant.productId, freeQty: freeGrant.freeQty, productName: freeGrant.productName }] : []),
                ...(moneyGrant ? [{ productId: moneyGrant.productId, freeQty: moneyGrant.freeQty, productName: moneyGrant.productName }] : []),
            ],
            // Rule 2 — on-top partial ₹ row for the order page.
            onTopDiscountPaise: onTopPaise,
            onTopCouponCode: benefits.onTop ? (benefits.onTop.code ?? benefits.onTop.name) : null,
            paymentMethod: isCod ? "COD" : "ONLINE",
            status: t.order?.legacyStatus,
        };

        // The address shipped to goes back into the customer's address book —
        // onto the row they picked (their edits included) or as a new row — and
        // becomes "last used", so the next checkout opens on it. Never fails the order.
        try {
            const book = {
                name: shippingAddress.name,
                phone: shippingAddress.phone,
                line1: shippingAddress.line1,
                line2: shippingAddress.line2 ?? null,
                landmark: shippingAddress.landmark ?? null,
                locality: shippingAddress.locality ?? null,
                neighbourhood: shippingAddress.neighbourhood ?? null,
                city: shippingAddress.city,
                state: shippingAddress.state,
                pincode: shippingAddress.pincode,
            };
            const saved = data.addressId ? await saveAddress(customerId, data.addressId, book, { used: true }) : null;
            if (!saved) await saveAddress(customerId, null, book, { used: true });
        } catch (e) {
            console.error("[shop/orders] address book save failed", e);
        }

        await createSystemInboxNotifications({
            roleIds: ["R1", "R2"],
            title: `New shop order #${order.id}`,
            body: `Total ₹ ${(order.grandTotalPaise / 100).toFixed(2)} · ${context.active.label}`,
            link: `/office/ecommerce/orders/${order.id}`,
        });

        return NextResponse.json(order);
    } catch (e) {
        return handleApiError(e, "Failed to create order");
    }
}
