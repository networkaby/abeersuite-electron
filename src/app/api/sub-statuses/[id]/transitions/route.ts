import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";

const subStatusTransitionsSchema = z.object({
    toIds: z.array(z.string().trim()),
});

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
        const { data, error } = await validateRequest(req, subStatusTransitionsSchema);
        if (error) return error;
        const { toIds } = data;

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
