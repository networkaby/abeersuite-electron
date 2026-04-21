import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";

// PUT /api/sub-statuses/[id]/transitions
// Body: { toIds: (string | null)[] }  — null means "entry point" transition
// Replaces all outgoing transitions for this sub-status
export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requirePermission("settings:statuses");
    if (response) return response;
    try {
        const { id } = await params;
        const { toIds } = await req.json() as { toIds: string[] };

        await prisma.$transaction([
            prisma.subStatusTransition.deleteMany({ where: { fromSubStatusId: id } }),
            prisma.subStatusTransition.createMany({
                data: toIds.map((toId) => ({ fromSubStatusId: id, toSubStatusId: toId })),
                skipDuplicates: true,
            }),
        ]);

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to save transitions" }, { status: 500 });
    }
}
