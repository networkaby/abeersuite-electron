import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { ORDER_STAGE } from "@/modules/order/lib/orderPipeline";
import { checkCreditLimit, CreditLimitError } from "@/shared/lib/accountancy/checkCreditLimit";

// POST /api/orders/[source]/[id]/fulfil
//
// One-click fulfilment: turn an order into a posted SALE. To avoid re-implementing
// the protected GL/stock posting, this DELEGATES to the existing voucher routes via
// internal calls (create DRAFT SALE → post it), then clears the order's stock
// reservation (the hold becomes a real stock-out), links the sale to the order, and
// advances the order to Delivered. Counter/office orders (source="inv") for now;
// online ShopOrder fulfilment (needs per-line tax resolution) is a follow-up.
export async function POST(req: NextRequest, { params }: { params: Promise<{ source: string; id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { source, id: idStr } = await params;
    const id = Number(idStr);
    if (source !== "inv" || !Number.isInteger(id) || id < 1) {
        return NextResponse.json({ error: "Fulfil currently supports counter/office orders." }, { status: 400 });
    }

    try {
        const order = await prisma.invVoucher.findUnique({
            where: { id },
            select: {
                id: true, type: true, reference: true, branchId: true, orderStatusId: true,
                accountId: true, totalAmount: true,
                partyName: true, partyType: true, partyId: true,
                discountAmt: true, discountPct: true, shippingAmt: true, roundOff: true,
                lines: { select: { productId: true, quantity: true, rate: true, taxRate: true, mrpPaise: true } },
            },
        });
        if (!order || (order.type !== "POS_ORDER" && order.type !== "SALES_ORDER")) {
            return NextResponse.json({ error: "Order not found" }, { status: 404 });
        }
        if (order.orderStatusId === ORDER_STAGE.DELIVERED || order.orderStatusId === ORDER_STAGE.CANCELLED || order.orderStatusId === ORDER_STAGE.RETURNED) {
            return NextResponse.json({ error: "This order is already finalised." }, { status: 409 });
        }
        if (order.lines.length === 0) {
            return NextResponse.json({ error: "Order has no lines to fulfil." }, { status: 400 });
        }
        // Every order has a mandatory customer, so accountId is set — guard for
        // legacy rows that predate that rule.
        if (!order.accountId) {
            return NextResponse.json({ error: "This order has no customer account to invoice — attach a customer to the order first." }, { status: 400 });
        }
        const accountId = order.accountId;

        // Credit limit is ENFORCED (deny-by-default: no positive limit ⇒ no credit
        // sale). Fulfil currently posts the SALE fully on credit (no tender yet), so
        // the whole total is the on-credit amount. Reuse the canonical helper — same
        // one the POS sale uses — so the sign/semantics are correct. A no-credit
        // customer is correctly blocked here ("must be paid in full"); collecting
        // payment at Fulfil (so onCredit drops) is the G4b follow-up.
        // (Minor TOCTOU vs the later post tx — acceptable for fulfilment; fully
        // atomic enforcement would require the check inside the protected post route.)
        const onCredit = toNumber(order.totalAmount);
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
                description: `Sale — fulfil ${order.reference}`,
                branchId: order.branchId,
                partyName: order.partyName,
                partyType: order.partyType,
                partyId: order.partyId,
                discountAmt: order.discountAmt != null ? Number(order.discountAmt) : undefined,
                discountPct: order.discountPct != null ? Number(order.discountPct) : undefined,
                shippingAmt: order.shippingAmt != null ? Number(order.shippingAmt) : 0,
                roundOff: order.roundOff != null ? Number(order.roundOff) : 0,
                lines: order.lines.map((l) => ({
                    productId: l.productId,
                    quantity: toNumber(l.quantity),
                    rate: toNumber(l.rate),
                    taxRate: toNumber(l.taxRate),
                    mrpPaise: l.mrpPaise ?? undefined,
                })),
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
            await tx.invVoucher.update({ where: { id: sale.id }, data: { refVoucherId: id } }); // sale → order
            await tx.invVoucher.update({ where: { id }, data: { orderStatusId: ORDER_STAGE.DELIVERED } });
        }, { timeout: 30_000, maxWait: 10_000 });

        return NextResponse.json({ saleId: sale.id, saleRef: sale.reference });
    } catch (e) {
        return handleApiError(e, "Failed to fulfil order");
    }
}
