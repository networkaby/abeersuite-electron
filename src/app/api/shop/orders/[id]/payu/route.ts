import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/shared/lib/api";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { getPayableGateway } from "@/shared/lib/payments/activeOnlineGateway";
import { payuCreds, payuEndpoint, payuAmount, buildPayuRequest } from "@/shared/lib/payments/payu";
import { absoluteBase } from "@/shared/lib/http/absoluteBase";

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

/**
 * Start a PayU payment for an order. Returns { action, fields } — the client builds
 * a hidden form and POSTs it to `action` (PayU's hosted page). The customer pays
 * there; PayU then POSTs the result to /api/shop/payu/callback.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const auth = await requirePortalCustomer();
        if (auth.response) return auth.response;
        const { customerId } = auth;

        const { id } = paramsSchema.parse(await params);

        // Offerable = enabled + wired + settlement ledger set (no ledger → unusable).
        const payu = await getPayableGateway("payu");
        if (!payu) {
            return NextResponse.json({ error: "PayU is not enabled for online checkout." }, { status: 400 });
        }
        const creds = payuCreds();
        if (!creds) {
            return NextResponse.json(
                { error: "PayU keys are not set (PAYU_MERCHANT_KEY / PAYU_MERCHANT_SALT)." },
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
        if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
        if (order.personId !== customerId) {
            return NextResponse.json({ error: "This order is not yours." }, { status: 403 });
        }
        if (order.paymentMethod !== "ONLINE") {
            return NextResponse.json({ error: "This order is not an online-payment order." }, { status: 400 });
        }
        if (order.legacyStatus !== "PENDING_PAYMENT") {
            return NextResponse.json({ error: "Order is not payable." }, { status: 400 });
        }

        // Charge the GRAND total (goods + shipping) — what the order page shows as due.
        const grandPaise = (order.totalPaise ?? 0) + (order.shippingChargePaise ?? 0);
        const amount = payuAmount(grandPaise);

        const addr = order.shippingAddress as { name?: string; phone?: string } | null;
        const emailRow = await prisma.email.findFirst({
            where: { personId: customerId },
            orderBy: [{ isPrimary: "desc" }, { id: "asc" }],
            select: { email: true },
        });
        const firstname = (order.shippingName || addr?.name || "Customer").slice(0, 60);
        const phone = (addr?.phone || "").replace(/\D/gu, "").slice(0, 15);
        const email = (emailRow?.email || "").trim() || `order${order.ticketId}@shop.local`;

        // PayU txnid: unique, alphanumeric, ≤25 chars. Stored on razorpayOrderId (the
        // generic PSP-order column) so the callback can find the order by it.
        const txnid = `SHOP${order.ticketId}T${Date.now().toString(36)}`.toUpperCase().slice(0, 25);
        await prisma.ticketOrder.update({
            where: { ticketId: order.ticketId },
            data: { razorpayOrderId: txnid },
        });

        const base = absoluteBase(req);
        const callback = `${base}/api/shop/payu/callback`;
        const env: "TEST" | "LIVE" = payu.environment === "LIVE" ? "LIVE" : "TEST";

        const fields = buildPayuRequest({
            key: creds.key,
            salt: creds.salt,
            txnid,
            amount,
            productinfo: `Order ${order.ticketId}`,
            firstname,
            email,
            phone,
            surl: callback,
            furl: callback,
        });

        return NextResponse.json({ action: payuEndpoint(env), fields });
    } catch (e) {
        return handleApiError(e, "Failed to start PayU payment");
    }
}
