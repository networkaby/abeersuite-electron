import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { ContactConflictError, contactValueSchema, updatePhone } from "@/shared/lib/format/contactWrite";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

// PATCH /api/people/[id]/phones/[phoneId] — update a phone row
export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string; phoneId: string }> },
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id, phoneId } = await params;
    const phoneIdNum = Number(phoneId);
    const personIdNum = Number(id);
    if (!Number.isFinite(phoneIdNum) || !Number.isFinite(personIdNum)) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const existing = await prisma.phone.findUnique({ where: { id: phoneIdNum } });
    if (!existing || existing.personId !== personIdNum) {
        return NextResponse.json({ error: "Phone not found for this person" }, { status: 404 });
    }

    const { data, error } = await validateRequest(req, contactValueSchema.partial());
    if (error) return error;

    try {
        const row = await updatePhone(phoneIdNum, data);
        return NextResponse.json(row);
    } catch (e) {
        if (e instanceof ContactConflictError) {
            return NextResponse.json({ error: e.message, field: e.field }, { status: 409 });
        }
        return handleApiError(e, "Failed to update phone");
    }
}

// DELETE /api/people/[id]/phones/[phoneId]
export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string; phoneId: string }> },
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id, phoneId } = await params;
    const phoneIdNum = Number(phoneId);
    const personIdNum = Number(id);
    const existing = await prisma.phone.findUnique({ where: { id: phoneIdNum } });
    if (!existing || existing.personId !== personIdNum) {
        return NextResponse.json({ error: "Phone not found for this person" }, { status: 404 });
    }

    await prisma.phone.delete({ where: { id: phoneIdNum } });
    return NextResponse.json({ success: true });
}
