import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { selectPrimaryPhone } from "@/shared/lib/prisma/fragments";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.ECOMMERCE_MANAGE);
    if (response) return response;
    const { id } = await ctx.params;
    const oid = parseInt(id, 10);
    if (!Number.isFinite(oid)) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    try {
        const order = await prisma.shopOrder.findUnique({
            where: { id: oid },
            include: {
                person: {
                    include: {
                        phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
                        emails: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
                    },
                },
                account: {
                    include: {
                        company: {
                            include: {
                                phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
                                emails: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
                            },
                        },
                        person: {
                            select: {
                                id: true,
                                name: true,
                                phones: selectPrimaryPhone,
                            },
                        },
                    },
                },
                sourceCoupon: true,
                lines: { include: { product: true } },
                tickets: { select: { id: true, status: true, notes: true, createdAt: true } },
                orderStatus: {
                    include: {
                        toTransitions: {
                            include: { to: true },
                            orderBy: { to: { order: "asc" } },
                        },
                    },
                },
                invoice: {
                    select: { id: true, number: true, status: true, totalAmount: true },
                },
            },
        });
        if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json(order);
    } catch (e) {
        return handleApiError(e, "Failed to load order");
    }
}
