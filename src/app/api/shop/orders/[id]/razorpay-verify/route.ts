import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createHmac, timingSafeEqual } from "crypto";
import { handleApiError } from "@/shared/lib/api";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { markOrderPaid } from "@/modules/order/lib/markOrderPaid";

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

const bodySchema = z.object({
    razorpay_order_id: z.string().trim().min(1),
    razorpay_payment_id: z.string().trim().min(1),
    razorpay_signature: z.string().trim().min(1),
});

/**
 * Confirm a Razorpay payment. The client posts the three fields Razorpay Checkout
 * returns; we verify HMAC_SHA256(order_id|payment_id, key_secret) === signature,
 * confirm the order_id matches the one we created, then mark the order paid.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const auth = await requirePortalCustomer();
        if (auth.response) return auth.response;
        const { customerId } = auth;

        const { id } = paramsSchema.parse(await params);
        const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
        if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = parsed.data;

        const keySecret = process.env.RAZORPAY_KEY_SECRET;
        if (!keySecret) return NextResponse.json({ error: "Razorpay is not configured." }, { status: 400 });

        const order = await prisma.ticketOrder.findUnique({
            where: { ticketId: id },
            select: { ticketId: true, personId: true, razorpayOrderId: true },
        });
        if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
        if (order.personId !== customerId) {
            return NextResponse.json({ error: "This order is not yours." }, { status: 403 });
        }
        // The paid order_id must be the one we created for this order.
        if (order.razorpayOrderId !== razorpay_order_id) {
            return NextResponse.json({ error: "Order mismatch." }, { status: 400 });
        }

        // Verify the signature (constant-time).
        const expected = createHmac("sha256", keySecret)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest("hex");
        const a = Buffer.from(expected);
        const b = Buffer.from(razorpay_signature);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
            return NextResponse.json({ error: "Signature verification failed." }, { status: 400 });
        }

        const result = await markOrderPaid(order.ticketId, {
            paymentId: razorpay_payment_id,
            gatewayLabel: "Razorpay",
            provider: "razorpay",
            customerId,
        });
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
        return NextResponse.json({ paid: true, alreadyPaid: result.alreadyPaid ?? false });
    } catch (e) {
        return handleApiError(e, "Failed to verify payment");
    }
}
