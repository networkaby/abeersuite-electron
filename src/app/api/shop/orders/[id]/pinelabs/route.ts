import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/shared/lib/api";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { getPayableGateway } from "@/shared/lib/payments/activeOnlineGateway";
import { createPineLabsCheckout, pineLabsCreds } from "@/shared/lib/payments/pinelabs";
import { absoluteBase } from "@/shared/lib/http/absoluteBase";

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

/**
 * Start a Pine Labs payment: create a hosted checkout for the GRAND total and return
 * the page to send the customer to. Pine Labs brings them back to
 * /api/shop/pinelabs/callback, which confirms the order with Pine Labs itself.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const auth = await requirePortalCustomer();
        if (auth.response) return auth.response;
        const { customerId } = auth;

        const { id } = paramsSchema.parse(await params);

        // Offerable = enabled + wired + settlement ledger set (no ledger → unusable).
        const pl = await getPayableGateway("pinelabs");
        if (!pl) {
            return NextResponse.json({ error: "Pine Labs is not enabled for online checkout." }, { status: 400 });
        }
        const creds = await pineLabsCreds();
        if (!creds) {
            return NextResponse.json(
                { error: "Pine Labs keys are not set (PINELABS_CLIENT_ID / PINELABS_CLIENT_SECRET)." },
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

        const addr = order.shippingAddress as { name?: string; phone?: string } | null;
        const emailRow = await prisma.email.findFirst({
            where: { personId: customerId },
            orderBy: [{ isPrimary: "desc" }, { id: "asc" }],
            select: { email: true },
        });
        const customerName = (order.shippingName || addr?.name || "Customer").slice(0, 100);
        const customerPhone = (addr?.phone || "").replace(/\D/gu, "").slice(-10) || "9999999999";
        const customerEmail = (emailRow?.email || "").trim() || `order${order.ticketId}@shop.local`;

        const base = absoluteBase(req);
        const env: "TEST" | "LIVE" = pl.environment === "LIVE" ? "LIVE" : "TEST";
        const created = await createPineLabsCheckout(env, creds, {
            reference: `SHOP${order.ticketId}PL${Date.now().toString(36)}`.toUpperCase(),
            amountPaise: grandPaise,
            customerName,
            customerPhone,
            customerEmail,
            callbackUrl: `${base}/api/shop/pinelabs/callback?ticketId=${order.ticketId}`,
        });
        if ("error" in created) {
            return NextResponse.json({ error: created.error }, { status: 502 });
        }
        // Pine Labs' order id on the generic PSP-order column, so the callback can confirm it.
        await prisma.ticketOrder.update({
            where: { ticketId: order.ticketId },
            data: { razorpayOrderId: created.orderId },
        });

        return NextResponse.json({ redirectUrl: created.redirectUrl });
    } catch (e) {
        return handleApiError(e, "Failed to start Pine Labs payment");
    }
}
