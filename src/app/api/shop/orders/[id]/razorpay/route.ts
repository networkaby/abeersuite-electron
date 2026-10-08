import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/shared/lib/api";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { getPayableGateway } from "@/shared/lib/payments/activeOnlineGateway";

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

/**
 * Start a Razorpay payment: create a Razorpay order for the shop order's GRAND
 * total and return the config the client Checkout modal needs. The customer pays
 * in the modal; success is confirmed server-side by /razorpay-verify (signature).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const auth = await requirePortalCustomer();
        if (auth.response) return auth.response;
        const { customerId } = auth;

        const { id } = paramsSchema.parse(await params);

        // Offerable = enabled + wired + settlement ledger set (no ledger → unusable).
        if (!(await getPayableGateway("razorpay"))) {
            return NextResponse.json({ error: "Razorpay is not enabled for online checkout." }, { status: 400 });
        }
        const keyId = process.env.RAZORPAY_KEY_ID;
        const keySecret = process.env.RAZORPAY_KEY_SECRET;
        if (!keyId || !keySecret) {
            return NextResponse.json(
                { error: "Razorpay keys are not set (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)." },
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

        // Charge the GRAND total (goods + shipping), in paise.
        const amount = (order.totalPaise ?? 0) + (order.shippingChargePaise ?? 0);

        const authHeader = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
        const rp = await fetch("https://api.razorpay.com/v1/orders", {
            method: "POST",
            headers: { Authorization: `Basic ${authHeader}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                amount,
                currency: "INR",
                receipt: `shop_${order.ticketId}`,
                payment_capture: 1,
            }),
        });
        if (!rp.ok) {
            const text = await rp.text();
            return NextResponse.json({ error: "Razorpay error", detail: text }, { status: 502 });
        }
        const data = (await rp.json()) as { id: string };
        await prisma.ticketOrder.update({
            where: { ticketId: order.ticketId },
            data: { razorpayOrderId: data.id },
        });

        return NextResponse.json({
            keyId,
            orderId: data.id,
            amount,
            currency: "INR",
            shopOrderId: order.ticketId,
        });
    } catch (e) {
        return handleApiError(e, "Failed to start payment");
    }
}
