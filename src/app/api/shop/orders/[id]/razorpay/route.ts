import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/shared/lib/api";

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

/**
 * Prepare Razorpay order (MVP: returns config when keys exist; otherwise mock payload).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = paramsSchema.parse(await params);
        const order = await prisma.shopOrder.findUnique({
            where: { id },
            select: { id: true, totalPaise: true, status: true, razorpayOrderId: true },
        });
        if (!order) {
            return NextResponse.json({ error: "Order not found" }, { status: 404 });
        }
        if (order.status !== "PENDING_PAYMENT") {
            return NextResponse.json({ error: "Order is not payable" }, { status: 400 });
        }

        const keyId = process.env.RAZORPAY_KEY_ID;
        const keySecret = process.env.RAZORPAY_KEY_SECRET;

        if (!keyId || !keySecret) {
            return NextResponse.json({
                mock: true,
                message: "Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to create live Razorpay orders.",
                orderId: order.id,
                amountPaise: order.totalPaise,
            });
        }

        const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
        const amount = order.totalPaise;
        const rp = await fetch("https://api.razorpay.com/v1/orders", {
            method: "POST",
            headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                amount,
                currency: "INR",
                receipt: `shop_${order.id}`,
                payment_capture: 1,
            }),
        });
        if (!rp.ok) {
            const text = await rp.text();
            return NextResponse.json({ error: "Razorpay error", detail: text }, { status: 502 });
        }
        const data = (await rp.json()) as { id: string };
        await prisma.shopOrder.update({
            where: { id: order.id },
            data: { razorpayOrderId: data.id },
        });

        return NextResponse.json({
            keyId,
            orderId: data.id,
            amount,
            currency: "INR",
            shopOrderId: order.id,
        });
    } catch (e) {
        return handleApiError(e, "Failed to start payment");
    }
}
