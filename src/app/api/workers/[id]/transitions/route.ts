import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

const workerTransitionsSchema = z.object({
    toIds: z.array(z.string().trim()),
});

// PUT /api/workers/[id]/transitions
// Body: { toIds: (string | null)[] }  — null means "entry point" transition
// Replaces all outgoing transitions for this worker
export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { id } = await params;
        const { data, error } = await validateRequest(req, workerTransitionsSchema);
        if (error) return error;
        const { toIds } = data;

        await prisma.$transaction([
            prisma.workerTransition.deleteMany({ where: { fromWorkerId: id } }),
            prisma.workerTransition.createMany({
                data: toIds.map((toId) => ({ fromWorkerId: id, toWorkerId: toId })),
                skipDuplicates: true,
            }),
        ]);

        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to save transitions");
    }
}
