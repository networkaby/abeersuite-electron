import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-guard";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
    const { response } = await requireRole("R1");
    if (response) return response;
    try {
        const { id } = await params;
        const body = await req.json();

        const status = await prisma.ticketStatus.update({
            where: { id },
            data: {
                label:      body.label      !== undefined ? body.label      : undefined,
                color:      body.color      !== undefined ? body.color      : undefined,
                order:      body.order      !== undefined ? Number(body.order) : undefined,
                isTerminal: body.isTerminal !== undefined ? body.isTerminal : undefined,
            },
        });
        return NextResponse.json(status);
    } catch {
        return NextResponse.json({ error: "Failed to update status" }, { status: 500 });
    }
}

export async function DELETE(_: Request, { params }: Params) {
    const { response } = await requireRole("R1");
    if (response) return response;
    try {
        const { id } = await params;

        const inUse = await prisma.ticket.count({ where: { status: id } });
        if (inUse > 0) {
            return NextResponse.json(
                { error: `Cannot delete: ${inUse} ticket(s) currently use this status.` },
                { status: 400 }
            );
        }

        // Transitions cascade automatically via ON DELETE CASCADE
        await prisma.ticketStatus.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Failed to delete status" }, { status: 500 });
    }
}
