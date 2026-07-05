import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { buildTicketReadScopeWhere } from "@/modules/repairing/lib/ticketScope";
import { handleApiError } from "@/shared/lib/api";

// GET /api/search-slno?q=...
export async function GET(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;

    try {
        const { searchParams } = new URL(req.url);
        const q = searchParams.get("q")?.trim() ?? "";
        const scopeWhere = buildTicketReadScopeWhere(user);

        // SLno/device search only applies to repair tickets (device + slno live on the
        // TicketRepair detail).
        const where = {
            AND: [
                ...(scopeWhere ? [scopeWhere] : []),
                q
                    ? {
                        repair: {
                            OR: [
                                { externalRef: { contains: q, mode: "insensitive" as const } },
                                { warrantyRef: { contains: q, mode: "insensitive" as const } },
                                { device: { brand: { contains: q, mode: "insensitive" as const } } },
                                { device: { model: { contains: q, mode: "insensitive" as const } } },
                                { device: { type: { contains: q, mode: "insensitive" as const } } },
                                { device: { problem: { contains: q, mode: "insensitive" as const } } },
                            ],
                        },
                    }
                    : { repair: { isNot: null } },
            ],
        };

        const rows = await prisma.ticket.findMany({
            where,
            orderBy: { updatedAt: "desc" },
            take: 500,
            select: {
                id: true,
                updatedAt: true,
                ticketStatus: { select: { label: true, color: true } },
                repair: {
                    select: {
                        externalRef: true,
                        warrantyRef: true,
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
            const r = t.repair;
            if (!r) continue;
            if (!byDevice.has(r.device.id)) {
                byDevice.set(r.device.id, {
                    deviceId: r.device.id,
                    slNo: r.externalRef ?? r.warrantyRef ?? "",
                    customerName: r.device.account?.name ?? "Unknown",
                    deviceName: `${r.device.brand} ${r.device.model}`,
                    deviceType: r.device.type,
                    problem: r.device.problem,
                    updatedAt: t.updatedAt.toISOString(),
                });
            }
        }

        const items = Array.from(byDevice.values());

        return NextResponse.json(items);
    } catch (e) {
        return handleApiError(e, "Failed to fetch SLno search list");
    }
}
