import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { sanitizeDeliveryConfig, type DeliveryKind } from "@/modules/delivery/lib/deliveryMethods";

const patchSchema = z.object({
    displayName: z.string().trim().min(1).max(80).optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    configJson: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    try {
        const method = await prisma.deliveryMethod.findUnique({ where: { id } });
        if (!method) return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json({ method });
    } catch (e) {
        return handleApiError(e, "Failed to load courier");
    }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const { data, error } = await validateRequest(req, patchSchema);
    if (error) return error;
    try {
        const existing = await prisma.deliveryMethod.findUnique({ where: { id }, select: { kind: true } });
        if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

        const patch: Record<string, unknown> = {};
        if (data.displayName !== undefined) patch.displayName = data.displayName;
        if (data.isActive !== undefined) patch.isActive = data.isActive;
        if (data.sortOrder !== undefined) patch.sortOrder = data.sortOrder;
        if (data.configJson !== undefined) {
            patch.configJson = sanitizeDeliveryConfig(existing.kind as DeliveryKind, data.configJson) as Prisma.InputJsonValue;
        }
        if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

        const updated = await prisma.deliveryMethod.update({ where: { id }, data: patch });
        return NextResponse.json({ method: updated });
    } catch (e) {
        return handleApiError(e, "Failed to update courier");
    }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    try {
        await prisma.deliveryMethod.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete courier");
    }
}
