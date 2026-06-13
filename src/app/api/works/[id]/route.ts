import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { Prisma } from "@/generated/prisma/client";

const patchSchema = z.object({
    label: z.string().trim().min(1).optional(),
    color: z.string().trim().optional(),
    order: z.coerce.number().int().nonnegative().optional(),
    gated: z.boolean().optional(),
    successLabel: z.string().trim().optional().nullable(),
    failLabel: z.string().trim().optional().nullable(),
    args: z.array(z.object({
        key: z.string().trim().optional(),
        label: z.string().trim().min(1),
        source: z.string().trim().min(1),
        kind: z.enum(["text", "number"]).optional(),
        on: z.enum(["success", "fail", "always"]).optional(),
    })).optional(),
});

async function mintWorkPermission(id: string, label: string): Promise<string> {
    const permissionId = `work:${id}`;
    await prisma.permission.upsert({
        where:  { id: permissionId },
        update: { label: `Work: ${label}`, module: "tickets" },
        create: { id: permissionId, label: `Work: ${label}`, module: "tickets", description: `Set ${label} statuses / workers on a ticket.` },
    });
    return permissionId;
}

// PATCH /api/works/[id]
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_STATUSES);
    if (response) return response;
    try {
        const { id } = await params;
        const { data, error } = await validateRequest(req, patchSchema);
        if (error) return error;
        const body = data;

        const work = await prisma.work.findUnique({ where: { id } });
        if (!work) return NextResponse.json({ error: "Work not found" }, { status: 404 });

        const label = body.label ?? work.label;
        let permissionId = work.permissionId;
        if (body.gated !== undefined) {
            // Gate transition: mint/link the permission, or detach it (row kept).
            permissionId = body.gated ? await mintWorkPermission(id, label) : null;
        } else if (body.label && work.permissionId) {
            // Keep the existing permission label in sync with the work label.
            await mintWorkPermission(id, label);
        }

        const updated = await prisma.work.update({
            where: { id },
            data: {
                ...(body.label !== undefined && { label: body.label }),
                ...(body.color !== undefined && { color: body.color }),
                ...(body.order !== undefined && { order: body.order }),
                ...("successLabel" in body && { successLabel: body.successLabel || null }),
                ...("failLabel" in body && { failLabel: body.failLabel || null }),
                ...("args" in body && { args: (body.args ?? []) as unknown as Prisma.InputJsonValue }),
                permissionId,
            },
        });
        return NextResponse.json(updated);
    } catch (e) {
        return handleApiError(e, "Failed to update work");
    }
}

// DELETE /api/works/[id]
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_STATUSES);
    if (response) return response;
    try {
        const { id } = await params;
        // Deleting a Work detaches it from any statuses / workers using it
        // (their workId is set to null via the FK's onDelete: SetNull).
        await prisma.work.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete work");
    }
}
