import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSystemInboxNotifications } from "@/modules/message/lib/inbox";

const lineSchema = z.object({
    productId: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().positive().max(99),
});

const createOrderSchema = z.object({
    lines: z.array(lineSchema).min(1),
    guestEmail: z.string().email().optional(),
    guestPhone: z.string().trim().optional(),
});

export async function POST(req: Request) {
    try {
        const parsed = createOrderSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json(
                { error: parsed.error.issues[0]?.message ?? "Invalid order" },
                { status: 400 }
            );
        }
        const { lines, guestEmail, guestPhone } = parsed.data;

        const session = await auth();
        const kind = (session?.user as { kind?: string } | undefined)?.kind;
        const customerId =
            kind === "customer" && (session?.user as { customerId?: string }).customerId
                ? parseInt((session!.user as { customerId: string }).customerId, 10)
                : null;

        const productIds = [...new Set(lines.map((l) => l.productId))];
        const products = await prisma.shopProduct.findMany({
            where: { id: { in: productIds }, isActive: true },
        });
        const byId = new Map(products.map((p) => [p.id, p]));

        let totalPaise = 0;
        const resolvedLines: { productId: number; quantity: number; unitPricePaise: number }[] = [];
        for (const l of lines) {
            const p = byId.get(l.productId);
            if (!p) {
                return NextResponse.json({ error: `Unknown product ${l.productId}` }, { status: 400 });
            }
            if (p.stock !== null && p.stock < l.quantity) {
                return NextResponse.json(
                    { error: `Not enough stock for “${p.name}”. Available: ${p.stock}.` },
                    { status: 400 }
                );
            }
            totalPaise += p.pricePaise * l.quantity;
            resolvedLines.push({
                productId: l.productId,
                quantity: l.quantity,
                unitPricePaise: p.pricePaise,
            });
        }

        const order = await prisma.shopOrder.create({
            data: {
                status: "PENDING_PAYMENT",
                totalPaise,
                customerId: Number.isFinite(customerId!) ? customerId : null,
                guestEmail: guestEmail ?? null,
                guestPhone: guestPhone ?? null,
                lines: {
                    create: resolvedLines.map((r) => ({
                        productId: r.productId,
                        quantity: r.quantity,
                        unitPricePaise: r.unitPricePaise,
                    })),
                },
            },
            select: { id: true, totalPaise: true, status: true },
        });

        await createSystemInboxNotifications({
            roleIds: ["R1", "R2"],
            title: `New shop order #${order.id}`,
            body: `Total ₹ ${(order.totalPaise / 100).toFixed(2)} · ${guestEmail ?? guestPhone ?? "checkout pending"}`,
            link: `/ecommerce/orders/${order.id}`,
        });

        return NextResponse.json(order);
    } catch {
        return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
    }
}
