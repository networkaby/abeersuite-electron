import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/shared/lib/api";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { getPayableGateway } from "@/shared/lib/payments/activeOnlineGateway";
import { cashfreeCreds, cashfreeMode, createCashfreeOrder } from "@/shared/lib/payments/cashfree";
import { absoluteBase } from "@/shared/lib/http/absoluteBase";

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

/**
 * Start a Cashfree payment: create a Cashfree order for the GRAND total and return
 * the payment_session_id (+ SDK mode). The client launches Cashfree checkout with
 * it; Cashfree then redirects to /api/shop/cashfree/callback for confirmation.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const auth = await requirePortalCustomer();
        if (auth.response) return auth.response;
        const { customerId } = auth;

        const { id } = paramsSchema.parse(await params);

        // Offerable = enabled + wired + settlement ledger set (no ledger → unusable).
        const cf = await getPayableGateway("cashfree");
        if (!cf) {
            return NextResponse.json({ error: "Cashfree is not enabled for online checkout." }, { status: 400 });
        }
        const creds = await cashfreeCreds();
        if (!creds) {
            return NextResponse.json(
                { error: "Cashfree keys are not set (CASHFREE_APP_ID / CASHFREE_SECRET_KEY)." },
                { status: 400 },
            );
        }

        const order = await prisma.ticketOrder.findUnique({
            where: { ticketId: id },
            select: {
                ticketId: true,
                personId: true,
                paymentMethod: true,
                legacyStatus: true,
                totalPaise: true,
                shippingChargePaise: true,
                shippingName: true,
                shippingAddress: true,
            },
        });
        // Somebody else's order answers exactly like a missing one — never confirm it exists.
        if (!order || order.personId !== customerId) {
            return NextResponse.json({ error: "Order not found" }, { status: 404 });
        }
        if (order.paymentMethod !== "ONLINE") {
            return NextResponse.json({ error: "This order is not an online-payment order." }, { status: 400 });
        }
        if (order.legacyStatus !== "PENDING_PAYMENT") {
            return NextResponse.json({ error: "Order is not payable." }, { status: 400 });
        }

        const grandPaise = (order.totalPaise ?? 0) + (order.shippingChargePaise ?? 0);
        const amountRupees = Number((grandPaise / 100).toFixed(2));

        const addr = order.shippingAddress as { name?: string; phone?: string } | null;
        const emailRow = await prisma.email.findFirst({
            where: { personId: customerId },
            orderBy: [{ isPrimary: "desc" }, { id: "asc" }],
            select: { email: true },
        });
        const customerName = (order.shippingName || addr?.name || "Customer").slice(0, 100);
        const customerPhone = (addr?.phone || "").replace(/\D/gu, "").slice(-10) || "9999999999";
        const customerEmail = (emailRow?.email || "").trim() || `order${order.ticketId}@shop.local`;

        // Unique Cashfree order id; stored on razorpayOrderId (generic PSP-order column)
        // so the callback can confirm status server-side.
        const cfOrderId = `SHOP${order.ticketId}CF${Date.now().toString(36)}`.toUpperCase();
        await prisma.ticketOrder.update({
            where: { ticketId: order.ticketId },
            data: { razorpayOrderId: cfOrderId },
        });

        const base = absoluteBase(req);
        const env: "TEST" | "LIVE" = cf.environment === "LIVE" ? "LIVE" : "TEST";
        const created = await createCashfreeOrder(env, creds, {
            orderId: cfOrderId,
            amountRupees,
            customerId: `cust_${customerId}`,
            customerPhone,
            customerName,
            customerEmail,
            returnUrl: `${base}/api/shop/cashfree/callback?ticketId=${order.ticketId}`,
        });
        if ("error" in created) {
            return NextResponse.json({ error: created.error }, { status: 502 });
        }

        return NextResponse.json({
            paymentSessionId: created.paymentSessionId,
            mode: cashfreeMode(env),
        });
    } catch (e) {
        return handleApiError(e, "Failed to start Cashfree payment");
    }
}
