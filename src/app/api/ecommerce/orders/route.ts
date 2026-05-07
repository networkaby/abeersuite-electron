import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { OrderSource, ShopOrderStatus } from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import { getOrdersPipeline } from "@/lib/orders-pipeline";
import { z } from "zod";

const ACCOUNT_SELECT = {
    id: true,
    name: true,
    person: {
        select: {
            id: true,
            name: true,
            phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1 },
            emails: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1 },
        },
    },
    company: { select: { id: true, name: true } },
} satisfies Prisma.AccountSelect;

export async function GET(req: Request) {
    const { response } = await requirePermission("ecommerce:manage");
    if (response) return response;
    try {
        const { searchParams } = new URL(req.url);
        const statusParam = searchParams.get("status");
        const pipelineStatusId = searchParams.get("statusId");
        const orderSource = searchParams.get("orderSource") as OrderSource | null;
        const q = searchParams.get("q")?.trim();
        const from = searchParams.get("from");
        const to = searchParams.get("to");
        const take = Math.min(200, Math.max(1, Number(searchParams.get("limit")) || 50));
        const page = Math.max(1, Number(searchParams.get("page")) || 1);

        const legacyStatusFilter =
            statusParam && Object.values(ShopOrderStatus).includes(statusParam as ShopOrderStatus)
                ? (statusParam as ShopOrderStatus)
                : undefined;

        const orders = await prisma.shopOrder.findMany({
            where: {
                ...(legacyStatusFilter ? { status: legacyStatusFilter } : {}),
                ...(pipelineStatusId ? { statusId: pipelineStatusId } : {}),
                ...(orderSource ? { orderSource } : {}),
                ...(from || to
                    ? {
                          createdAt: {
                              ...(from ? { gte: new Date(from) } : {}),
                              ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
                          },
                      }
                    : {}),
                ...(q
                    ? {
                          OR: [
                              { account: { person: { name: { contains: q, mode: "insensitive" as const } } } },
                              { account: { person: { phones: { some: { phone: { contains: q } } } } } },
                              { account: { person: { emails: { some: { email: { contains: q, mode: "insensitive" as const } } } } } },
                              { account: { company: { name: { contains: q, mode: "insensitive" as const } } } },
                              // Legacy compat — orders still using personId
                              { person: { name: { contains: q, mode: "insensitive" as const } } },
                              ...(Number.isFinite(Number(q)) && String(Number(q)) === q.trim()
                                  ? [{ id: Number(q) }]
                                  : []),
                          ],
                      }
                    : {}),
            },
            orderBy: { createdAt: "desc" },
            take,
            skip: (page - 1) * take,
            include: {
                account: { select: ACCOUNT_SELECT },
                person: {
                    select: {
                        id: true,
                        name: true,
                        phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1 },
                        emails: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1 },
                    },
                },
                orderStatus: { select: { id: true, label: true, color: true, isTerminal: true } },
                invoice: { select: { id: true, number: true, status: true } },
                lines: { include: { product: { select: { id: true, name: true, imageUrl: true } } } },
            },
        });

        return NextResponse.json(orders);
    } catch (e) {
        console.error(e);
        return NextResponse.json({ error: "Failed to list orders" }, { status: 500 });
    }
}

const createSchema = z.object({
    accountId: z.number().int().positive(),
    orderSource: z.nativeEnum(OrderSource).default("IN_STORE"),
    shippingName: z.string().trim().optional(),
    shippingAddress: z.record(z.string(), z.unknown()).optional(),
    totalPaise: z.number().int().min(0).default(0),
    lines: z
        .array(
            z.object({
                productId: z.number().int().positive(),
                quantity: z.number().int().positive(),
                unitPricePaise: z.number().int().min(0),
            }),
        )
        .min(1),
});

export async function POST(req: Request) {
    const { response } = await requirePermission("ecommerce:manage");
    if (response) return response;

    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }
    const body = parsed.data;

    // Look up the P7 "Sales Orders" pipeline and its entry-point status
    const pipeline = await getOrdersPipeline(prisma);
    if (!pipeline) {
        return NextResponse.json({ error: "Sales Orders pipeline not seeded. Run the seed script." }, { status: 500 });
    }
    const entryStatus = pipeline.statuses.find((s) => s.isEntryPoint);
    if (!entryStatus) {
        return NextResponse.json({ error: "Sales Orders pipeline has no entry-point status." }, { status: 500 });
    }

    try {
        const order = await prisma.shopOrder.create({
            data: {
                accountId: body.accountId,
                orderSource: body.orderSource,
                pipelineId: pipeline.id,
                statusId: entryStatus.id,
                shippingName: body.shippingName ?? null,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                shippingAddress: (body.shippingAddress as any) ?? undefined,
                totalPaise: body.totalPaise,
                lines: {
                    create: body.lines.map((l) => ({
                        productId: l.productId,
                        quantity: l.quantity,
                        unitPricePaise: l.unitPricePaise,
                    })),
                },
            },
            include: {
                account: { select: ACCOUNT_SELECT },
                orderStatus: { select: { id: true, label: true, color: true } },
                lines: { include: { product: { select: { id: true, name: true } } } },
            },
        });
        return NextResponse.json(order, { status: 201 });
    } catch (e) {
        console.error(e);
        return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
    }
}
