import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { ORDER_STAGE } from "@/modules/order/lib/orderPipeline";
import { checkCreditLimit, CreditLimitError } from "@/shared/lib/accountancy/checkCreditLimit";
import { executeRedemptions } from "@/modules/order/lib/redemptionHold";
import { readPartyName } from "@/shared/lib/accountancy/partySnapshot";
import { syncVoucherLink } from "@/modules/accountancy/lib/voucherLinks";

// POST /api/orders/[source]/[id]/fulfil
//
// One-click fulfilment: turn an order into a posted SALE. To avoid re-implementing
// the protected GL/stock posting, this DELEGATES to the existing voucher routes via
// internal calls (create DRAFT SALE → post it), then clears the order's stock
// reservation (the hold becomes a real stock-out), links the sale to the order, and
// advances the order to Delivered. Counter/office orders (source="inv") for now;
// online ShopOrder fulfilment (needs per-line tax resolution) is a follow-up.
export async function POST(req: NextRequest, { params }: { params: Promise<{ source: string; id: string }> }) {
    const { response } = await requireModuleAccess("orders");
    if (response) return response;

    const { source, id: idStr } = await params;
    const id = Number(idStr);
    if (source !== "inv" || !Number.isInteger(id) || id < 1) {
        return NextResponse.json({ error: "Fulfil currently supports counter/office orders." }, { status: 400 });
    }

    // G4b — optional payment collected at fulfilment. Each row settles to an explicit
    // ledger (cash / bank / UPI account picked by the operator); the unpaid balance
    // then rides a customer-AR tender so the sale's tenders sum to its total.
    const body = (await req.json().catch(() => ({}))) as { payments?: { accountId: number; amount: number; method?: string; reference?: string }[] };
    const payments = (Array.isArray(body.payments) ? body.payments : [])
        .filter((p) => p && Number.isFinite(Number(p.accountId)) && Number(p.amount) > 0)
        .map((p) => ({ accountId: Number(p.accountId), amount: Number(p.amount), method: p.method, reference: p.reference }));
    const paidTotal = payments.reduce((s, p) => s + p.amount, 0);

    try {
        const order = await prisma.voucherDetail.findUnique({
            where: { id },
            select: {
                id: true,
                universalVoucher: { select: { partyAccountId: true, voucherNo: true, type: true, branchId: true, links: { where: { kind: "ORDER_STATUS" }, select: { targetId: true } } } },   // 5D-4 party + 5D-6 ref + 5D-11 type + 5D-12 branch
                totalAmount: true,
                partyJson: true, partyType: true, partyId: true,
                discountAmt: true, discountPct: true, shippingAmt: true, roundOff: true,
                universalVoucherId: true,
            },
        });
        if (!order || (order.universalVoucher?.type !== "POS_ORDER" && order.universalVoucher?.type !== "SALES_ORDER")) {
            return NextResponse.json({ error: "Order not found" }, { status: 404 });
        }
        const orderStatusId = order.universalVoucher?.links[0]?.targetId ?? null;
        // Phase 5 5C: goods lines hang off the spine.
        const orderLines = await prisma.voucherInventoryLine.findMany({
            where:  { universalVoucherId: order.universalVoucherId ?? -1 },
            select: { productId: true, quantity: true, rate: true, taxRate: true, mrpPaise: true },
        });
        if (orderStatusId === ORDER_STAGE.DELIVERED || orderStatusId === ORDER_STAGE.CANCELLED || orderStatusId === ORDER_STAGE.RETURNED) {
            return NextResponse.json({ error: "This order is already finalised." }, { status: 409 });
        }
        if (orderLines.length === 0) {
            return NextResponse.json({ error: "Order has no lines to fulfil." }, { status: 400 });
        }
        // Every order has a mandatory customer, so accountId is set — guard for
        // legacy rows that predate that rule.
        if (!order.universalVoucher?.partyAccountId) {
            return NextResponse.json({ error: "This order has no customer account to invoice — attach a customer to the order first." }, { status: 400 });
        }
        const accountId = order.universalVoucher.partyAccountId;

        // Credit limit is ENFORCED (deny-by-default: no positive limit ⇒ no credit
        // sale). G4b: any payment collected at fulfilment reduces the on-credit amount,
        // so a no-credit customer can fulfil by paying in full. Reuse the canonical
        // helper — same one the POS sale uses — so the sign/semantics match.
        // (Minor TOCTOU vs the later post tx — acceptable for fulfilment.)
        const total = toNumber(order.totalAmount);
        if (paidTotal > total + 0.01) {
            return NextResponse.json({ error: "Payment collected exceeds the order total." }, { status: 400 });
        }
        const onCredit = Math.max(0, total - paidTotal);
        try {
            await prisma.$transaction(async (tx) => { await checkCreditLimit(tx, accountId, onCredit); }, { timeout: 15_000, maxWait: 10_000 });
        } catch (e) {
            if (e instanceof CreditLimitError) {
                return NextResponse.json({ error: e.message, code: e.code }, { status: 422 });
            }
            throw e;
        }

        const today = new Date().toISOString().slice(0, 10);
        const cookie = req.headers.get("cookie") ?? "";

        // 1. Create a DRAFT SALE from the order (reuses the trading-voucher route).
        const createRes = await fetch(new URL("/api/inventory/vouchers", req.url), {
            method: "POST",
            headers: { "content-type": "application/json", cookie },
            body: JSON.stringify({
                type: "SALE",
                date: today,
                description: `Sale — fulfil ${order.universalVoucher?.voucherNo ?? ""}`,
                branchId: order.universalVoucher?.branchId,
                partyName: readPartyName(order.partyJson),
                partyType: order.partyType,
                partyId: order.partyId,
                discountAmt: order.discountAmt != null ? Number(order.discountAmt) : undefined,
                discountPct: order.discountPct != null ? Number(order.discountPct) : undefined,
                shippingAmt: order.shippingAmt != null ? Number(order.shippingAmt) : 0,
                roundOff: order.roundOff != null ? Number(order.roundOff) : 0,
                lines: orderLines.map((l) => ({
                    productId: l.productId,
                    quantity: toNumber(l.quantity),
                    rate: toNumber(l.rate),
                    taxRate: toNumber(l.taxRate),
                    mrpPaise: l.mrpPaise ?? undefined,
                })),
                // G4b: collected payments + a customer-AR row for the unpaid balance.
                // The create route requires tenders to sum to the total; an empty
                // payments[] → the whole total is the AR row (the old all-credit path).
                tenders: [
                    ...payments,
                    ...(onCredit > 0.005 ? [{ accountId, amount: onCredit }] : []),
                ],
            }),
        });
        if (!createRes.ok) {
            const e = (await createRes.json().catch(() => ({}))) as { error?: string };
            return NextResponse.json({ error: e.error || "Could not create the sale" }, { status: 422 });
        }
        const sale = (await createRes.json()) as { id: number; reference: string };

        // 2. Post it (GL + stock-out) — the existing post flow, untouched.
        const postRes = await fetch(new URL(`/api/inventory/vouchers/${sale.id}/post`, req.url), {
            method: "POST",
            headers: { "content-type": "application/json", cookie },
        });
        if (!postRes.ok) {
            const e = (await postRes.json().catch(() => ({}))) as { error?: string };
            return NextResponse.json({ error: e.error || "Sale created but posting failed", saleId: sale.id, saleRef: sale.reference }, { status: 422 });
        }

        // 3. The real stock-out happened, so clear the reservation hold; link the
        //    sale to the order; advance the order to Delivered.
        await prisma.$transaction(async (tx) => {
            const held = await tx.stockReservation.findMany({
                where: { orderSource: "inv", orderId: id, status: "HELD" },
                select: { productId: true, quantity: true },
            });
            for (const r of held) {
                await tx.invProduct.update({ where: { id: r.productId }, data: { reserved: { decrement: r.quantity } } });
            }
            await tx.stockReservation.updateMany({
                where: { orderSource: "inv", orderId: id, status: "HELD" },
                data: { status: "EXECUTED" },
            });
            // 2b: flip any reward holds to EXECUTED in the same tx. (Burning the reward
            // onto this sale — loyalty lots / coupon / gift card — is TODO(2b-apply);
            // a no-op today since no capture UI produces holds yet.)
            await executeRedemptions({ source: "inv", id }, tx);
            await tx.voucherDetail.update({ where: { id: sale.id }, data: { refVoucherId: id } }); // sale → order
            await syncVoucherLink(tx, order.universalVoucherId, "ORDER_STATUS", ORDER_STAGE.DELIVERED);
        }, { timeout: 30_000, maxWait: 10_000 });

        return NextResponse.json({ saleId: sale.id, saleRef: sale.reference, paid: paidTotal, onCredit });
    } catch (e) {
        return handleApiError(e, "Failed to fulfil order");
    }
}
