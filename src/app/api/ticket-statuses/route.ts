import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";

export async function GET() {
    try {
        const statuses = await prisma.ticketStatus.findMany({
            orderBy: { order: "asc" },
            include: {
                fromTransitions: {
                    include: { to: true },
                    orderBy: { toStatusId: "asc" },
                },
                _count: { select: { tickets: true } },
            },
        });
        return NextResponse.json(statuses);
    } catch {
        return NextResponse.json({ error: "Failed to fetch statuses" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission("settings:statuses");
    if (response) return response;
    try {
        const body = await req.json();

        // Generate next opaque ID: find highest numeric suffix among existing S* IDs
        const existing = await prisma.ticketStatus.findMany({ select: { id: true } });
        const maxN = existing.reduce((max, s) => {
            const n = parseInt(s.id.replace(/\D/g, ""), 10);
            return isNaN(n) ? max : Math.max(max, n);
        }, 0);
        const newId = `S${maxN + 1}`;

        const status = await prisma.ticketStatus.create({
            data: {
                id:           newId,
                label:        body.label,
                color:        body.color       ?? "bg-gray-100 text-gray-600",
                order:        body.order       ?? maxN + 1,
                isTerminal:   body.isTerminal  ?? false,
                allowedRoles: body.allowedRoles ?? [],
                notifyRoles:  body.notifyRoles  ?? [],
                actionLabel:  body.actionLabel  ?? null,
            },
        });
        return NextResponse.json(status, { status: 201 });
    } catch {
        return NextResponse.json({ error: "Failed to create status" }, { status: 500 });
    }
}
