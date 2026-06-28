import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { OrderSource, ShopOrderStatus } from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import { getOrdersPipeline } from "@/modules/ecommerce/lib/ordersPipeline";
import { parsePagination } from "@/shared/lib/api";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { selectPrimaryPhone, selectPrimaryEmail } from "@/shared/lib/prisma/fragments";

const ACCOUNT_SELECT = {
    id: true,
    name: true,
    person: {
        select: {
            id: true,
            name: true,
            phones: selectPrimaryPhone,
            emails: selectPrimaryEmail,
        },
    },
    company: { select: { id: true, name: true } },
} satisfies Prisma.AccountSelect;

export async function GET(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.ECOMMERCE_MANAGE);
    if (response) return response;
    try {
        const { searchParams } = new URL(req.url);
        const statusParam = searchParams.get("status");
        const pipelineStatusId = searchParams.get("statusId");
        const orderSource = searchParams.get("orderSource") as OrderSource | null;
        const q = searchParams.get("q")?.trim();
        const from = searchParams.get("from");
        const to = searchParams.get("to");
        const { take, page } = parsePagination(searchParams);

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
                        phones: selectPrimaryPhone,
                        emails: selectPrimaryEmail,
                    },
                },
                orderStatus: { select: { id: true, label: true, color: true, isTerminal: true } },
                invVoucher: { select: { id: true, type: true, status: true, universalVoucher: { select: { friendlyRef: true } } } },   // 5D-6
                lines: { include: { product: { select: { id: true, name: true, imageUrl: true } } } },
            },
        });

        // 5D-6: expose each inv voucher's user-facing number from its spine.
        return NextResponse.json(orders.map((o) => ({
            ...o,
            invVoucher: o.invVoucher ? { ...o.invVoucher, reference: o.invVoucher.universalVoucher?.friendlyRef ?? "" } : null,
        })));
    } catch (e) {
        return handleApiError(e, "Failed to list orders");
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
    const { response } = await requirePermission(PERMISSIONS.ECOMMERCE_MANAGE);
    if (response) return response;

    const { data, error } = await validateRequest(req, createSchema);

    if (error) return error;
    const body = data;

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
        return handleApiError(e, "Failed to create order");
    }
}
