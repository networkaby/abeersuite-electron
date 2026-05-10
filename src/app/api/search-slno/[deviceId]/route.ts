import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/authGuard";
import { buildTicketReadScopeWhere } from "@/shared/lib/format/ticketScope";

export async function GET(
    _: Request,
    { params }: { params: Promise<{ deviceId: string }> }
) {
    const { user, response } = await requireAuth();
    if (response) return response;

    try {
        const { deviceId } = await params;
        const id = Number(deviceId);
        if (!Number.isFinite(id) || id <= 0) {
            return NextResponse.json({ error: "Invalid device id" }, { status: 400 });
        }

        const scopeWhere = buildTicketReadScopeWhere(user);
        const tickets = await prisma.ticket.findMany({
            where: {
                AND: [
                    { deviceId: id },
                    ...(scopeWhere ? [scopeWhere] : []),
                ],
            },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                externalRef: true,
                warrantyRef: true,
                createdAt: true,
                updatedAt: true,
                ticketStatus: { select: { label: true, color: true } },
                ticketSubStatus: { select: { label: true, color: true } },
                device: {
                    select: {
                        id: true,
                        type: true,
                        brand: true,
                        model: true,
                        problem: true,
                        account: {
                            select: {
                                id: true,
                                name: true,
                                person: {
                                    select: {
                                        phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1 },
                                    },
                                },
                                company: {
                                    select: {
                                        phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1 },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        if (!tickets.length) {
            return NextResponse.json({ error: "Device tickets not found" }, { status: 404 });
        }

        const device = tickets[0].device;
        return NextResponse.json({
            device: {
                id: device.id,
                type: device.type,
                brand: device.brand,
                model: device.model,
                problem: device.problem,
                customerName: device.account?.name ?? "Unknown",
                customerPhone:
                    device.account?.person?.phones?.[0]?.phone
                    ?? device.account?.company?.phones?.[0]?.phone
                    ?? null,
                slNo: tickets[0].externalRef ?? tickets[0].warrantyRef ?? "",
                updatedAt: tickets[0].updatedAt.toISOString(),
            },
            tickets: tickets.map((t) => ({
                id: t.id,
                externalRef: t.externalRef,
                warrantyRef: t.warrantyRef,
                createdAt: t.createdAt.toISOString(),
                updatedAt: t.updatedAt.toISOString(),
                status: t.ticketStatus,
                subStatus: t.ticketSubStatus,
            })),
        });
    } catch (error) {
        console.error("[search-slno/:deviceId GET]", error);
        return NextResponse.json({ error: "Failed to fetch device tickets" }, { status: 500 });
    }
}
