import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-guard";

// GET /api/sub-statuses?statusId=S3
export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const statusId = searchParams.get("statusId");

        const all = await prisma.ticketSubStatus.findMany({
            orderBy: { order: "asc" },
            include: {
                fromTransitions: {
                    include: { to: { select: { id: true, label: true, color: true } } },
                },
            },
        });

        const result = statusId
            ? all.filter((ss) => ss.applicableStatusIds.includes(statusId))
            : all;

        return NextResponse.json(result);
    } catch {
        return NextResponse.json({ error: "Failed to fetch sub-statuses" }, { status: 500 });
    }
}

// POST /api/sub-statuses
export async function POST(req: Request) {
    const { response } = await requireRole("R1");
    if (response) return response;
    try {
        const body = await req.json();

        const existing = await prisma.ticketSubStatus.findMany({ select: { id: true } });
        const maxN = existing.reduce((max, s) => {
            const n = parseInt(s.id.replace(/\D/g, ""), 10);
            return isNaN(n) ? max : Math.max(max, n);
        }, 0);
        const newId = `SS${maxN + 1}`;

        const created = await prisma.ticketSubStatus.create({
            data: {
                id: newId,
                label: body.label,
                color: body.color ?? "bg-gray-100 text-gray-600",
                group: body.group,
                order: body.order ?? maxN + 1,
                applicableStatusIds: body.applicableStatusIds ?? [],
                allowedRoles: body.allowedRoles ?? [],
                notifyRoles: body.notifyRoles ?? [],
                triggerMap:         body.triggerMap ?? {},
                actionLabel:        body.actionLabel ?? null,
                warrantyScope:      body.warrantyScope ?? "any",
                handoffRole:        body.handoffRole ?? null,
                autoRevertOnClear:  body.autoRevertOnClear ?? true,
            },
        });

        return NextResponse.json(created, { status: 201 });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to create sub-status" }, { status: 500 });
    }
}
