import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { Prisma } from "@/generated/prisma/client";
import { isKnownTool } from "@/modules/repairing/lib/actionTools";
import { revalidateTag } from "next/cache";
import { NAV_MASTERS_TAG } from "@/shared/lib/nav/navCounts";
import { canGrantWorkRoles, setWorkRoles } from "@/modules/repairing/lib/workRoleGrants";

const patchSchema = z.object({
    label: z.string().trim().min(1).optional(),
    color: z.string().trim().optional(),
    order: z.coerce.number().int().nonnegative().optional(),
    gated: z.boolean().optional(),
    // "Who can do this" — roles that hold this gated work's permission (needs roles:edit).
    roleIds: z.array(z.string().trim().min(1)).optional(),
    successLabel: z.string().trim().optional().nullable(),
    failLabel: z.string().trim().optional().nullable(),
    prompt: z.string().trim().optional().nullable(),
    startLabel: z.string().trim().optional().nullable(),
    successPopup: z.boolean().optional(),
    failPopup: z.boolean().optional(),
    args: z.array(z.object({
        key: z.string().trim().optional(),
        label: z.string().trim().min(1),
        source: z.string().trim().min(1),
        kind: z.enum(["text", "number"]).optional(),
        on: z.enum(["success", "fail", "always", "entry"]).optional(),
        required: z.boolean().optional(),
    })).optional(),
    groupIds: z.array(z.string().trim().min(1)).optional(),
    kind: z.enum(["human", "auto"]).optional(),
    toolType: z.string().trim().optional().nullable(),
    toolConfig: z.record(z.string(), z.any()).optional().nullable(),
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
    const { user, response } = await requireAuth();
    if (response) return response;
    try {
        const { id } = await params;
        const { data, error } = await validateRequest(req, patchSchema);
        if (error) return error;
        const body = data;
        if (body.roleIds && !canGrantWorkRoles(user)) return NextResponse.json({ error: "Only someone who can edit roles can choose who does this work" }, { status: 403 });

        const work = await prisma.work.findUnique({ where: { id } });
        if (!work) return NextResponse.json({ error: "Work not found" }, { status: 404 });

        const label = body.label ?? work.label;
        const isAuto = (body.kind ?? work.kind) === "auto";
        if (isAuto && body.toolType && !isKnownTool(body.toolType)) {
            return NextResponse.json({ error: `Unknown tool: ${body.toolType}` }, { status: 400 });
        }
        let permissionId = work.permissionId;
        if (isAuto) {
            // Auto Works (Actions) are system-run — never gated.
            permissionId = null;
        } else if (body.gated !== undefined) {
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
                ...("prompt" in body && { prompt: body.prompt || null }),
                ...("startLabel" in body && { startLabel: body.startLabel || null }),
                ...("successPopup" in body && { successPopup: body.successPopup }),
                ...("failPopup" in body && { failPopup: body.failPopup }),
                ...("args" in body && { args: (body.args ?? []) as unknown as Prisma.InputJsonValue }),
                ...("groupIds" in body && { groups: { deleteMany: {}, create: (body.groupIds ?? []).map((workGroupId) => ({ workGroupId })) } }),
                ...("kind" in body && { kind: body.kind ?? "human" }),
                ...("toolType" in body && { toolType: isAuto ? (body.toolType || null) : null }),
                ...("toolConfig" in body && { toolConfig: (body.toolConfig ?? {}) as Prisma.InputJsonValue }),
                permissionId,
            },
        });
        if (permissionId && body.roleIds) await setWorkRoles(permissionId, body.roleIds);
        revalidateTag(NAV_MASTERS_TAG, { expire: 0 });
        return NextResponse.json(updated);
    } catch (e) {
        return handleApiError(e, "Failed to update work");
    }
}

// DELETE /api/works/[id]
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { id } = await params;
        // Deleting a Work detaches it from any statuses / workers using it
        // (their workId is set to null via the FK's onDelete: SetNull).
        await prisma.work.delete({ where: { id } });
        revalidateTag(NAV_MASTERS_TAG, { expire: 0 });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete work");
    }
}
