import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-guard";

// PUT /api/ticket-statuses/[id]/transitions
// Body: { toIds: string[] } — replaces all transitions FROM this status
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireRole("R1");
    if (response) return response;
    try {
        const { id } = await params;
        const { toIds }: { toIds: string[] } = await req.json();

        await prisma.$transaction([
            prisma.statusTransition.deleteMany({ where: { fromStatusId: id } }),
            prisma.statusTransition.createMany({
                data: toIds.map((toId) => ({ fromStatusId: id, toStatusId: toId })),
                skipDuplicates: true,
            }),
        ]);

        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Failed to update transitions" }, { status: 500 });
    }
}
