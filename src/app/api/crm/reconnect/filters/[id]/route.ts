import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { Prisma } from "@/generated/prisma/client";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { savedFilterUpdateSchema } from "@/shared/lib/schemas/reconnectSchema";

// Only the owner may edit or delete their saved filter (a shared one is still owned).
async function ownOr(id: number, meId: number): Promise<"ok" | "missing" | "forbidden"> {
    const row = await prisma.savedFilter.findUnique({ where: { id }, select: { ownerUserId: true } });
    if (!row) return "missing";
    return row.ownerUserId === meId ? "ok" : "forbidden";
}

// PATCH /api/crm/reconnect/filters/[id] — rename, re-share, or overwrite the criteria.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireModuleAccess("crm");
    if (response) return response;
    const id = Number((await params).id);
    if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const { data, error } = await validateRequest(req, savedFilterUpdateSchema);
    if (error) return error;
    try {
        const gate = await ownOr(id, Number(user.id));
        if (gate === "missing") return NextResponse.json({ error: "Filter not found" }, { status: 404 });
        if (gate === "forbidden") return NextResponse.json({ error: "Only the owner can change this filter" }, { status: 403 });
        const row = await prisma.savedFilter.update({
            where: { id },
            data: { ...(data.name != null ? { name: data.name } : {}), ...(data.isShared != null ? { isShared: data.isShared } : {}), ...(data.payload != null ? { payload: data.payload as Prisma.InputJsonValue } : {}) },
            select: { id: true, name: true, isShared: true, payload: true },
        });
        return NextResponse.json({ ...row, mine: true });
    } catch (e) {
        return handleApiError(e, "Failed to update filter");
    }
}

// DELETE /api/crm/reconnect/filters/[id]
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireModuleAccess("crm");
    if (response) return response;
    const id = Number((await params).id);
    if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    try {
        const gate = await ownOr(id, Number(user.id));
        if (gate === "missing") return NextResponse.json({ error: "Filter not found" }, { status: 404 });
        if (gate === "forbidden") return NextResponse.json({ error: "Only the owner can delete this filter" }, { status: 403 });
        await prisma.savedFilter.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete filter");
    }
}
