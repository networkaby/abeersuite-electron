import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/authGuard";
import { buildTicketReadScopeWhere } from "@/shared/lib/format/ticketScope";

// GET /api/search-slno?q=...
export async function GET(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;

    try {
        const { searchParams } = new URL(req.url);
        const q = searchParams.get("q")?.trim() ?? "";
        const scopeWhere = buildTicketReadScopeWhere(user);

        const where = {
            AND: [
                ...(scopeWhere ? [scopeWhere] : []),
                ...(q
                    ? [{
                        OR: [
                            { externalRef: { contains: q, mode: "insensitive" as const } },
                            { warrantyRef: { contains: q, mode: "insensitive" as const } },
                            { device: { brand: { contains: q, mode: "insensitive" as const } } },
                            { device: { model: { contains: q, mode: "insensitive" as const } } },
                            { device: { type: { contains: q, mode: "insensitive" as const } } },
                            { device: { problem: { contains: q, mode: "insensitive" as const } } },
                        ],
                    }]
                    : []),
            ],
        };

        const rows = await prisma.ticket.findMany({
            where,
            orderBy: { updatedAt: "desc" },
            take: 500,
            select: {
                id: true,
                externalRef: true,
                warrantyRef: true,
                updatedAt: true,
                ticketStatus: { select: { label: true, color: true } },
                device: {
                    select: {
                        id: true,
                        brand: true,
                        model: true,
                        type: true,
                        problem: true,
                        account: { select: { id: true, name: true } },
                    },
                },
            },
        });

        const byDevice = new Map<number, {
            deviceId: number;
            slNo: string;
            customerName: string;
            deviceName: string;
            deviceType: string;
            problem: string;
            updatedAt: string;
        }>();

        for (const t of rows) {
            if (!byDevice.has(t.device.id)) {
                byDevice.set(t.device.id, {
                    deviceId: t.device.id,
                    slNo: t.externalRef ?? t.warrantyRef ?? "",
                    customerName: t.device.account?.name ?? "Unknown",
                    deviceName: `${t.device.brand} ${t.device.model}`,
                    deviceType: t.device.type,
                    problem: t.device.problem,
                    updatedAt: t.updatedAt.toISOString(),
                });
            }
        }

        const items = Array.from(byDevice.values());

        return NextResponse.json(items);
    } catch (error) {
        console.error("[search-slno GET]", error);
        return NextResponse.json({ error: "Failed to fetch SLno search list" }, { status: 500 });
    }
}
