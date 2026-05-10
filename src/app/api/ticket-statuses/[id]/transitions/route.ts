import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

const statusTransitionsSchema = z.object({
    toIds: z.array(z.string().trim()),
});

// PUT /api/ticket-statuses/[id]/transitions
// Body: { toIds: string[] } — replaces all transitions FROM this status
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("settings:statuses");
    if (response) return response;
    try {
        const { id } = await params;
        const { data, error } = await validateRequest(req, statusTransitionsSchema);
        if (error) return error;
        const { toIds } = data;

        await prisma.$transaction([
            prisma.statusTransition.deleteMany({ where: { fromStatusId: id } }),
            prisma.statusTransition.createMany({
                data: toIds.map((toId) => ({ fromStatusId: id, toStatusId: toId })),
                skipDuplicates: true,
            }),
        ]);

        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to update transitions");
    }
}
