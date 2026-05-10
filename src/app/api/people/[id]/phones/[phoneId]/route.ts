import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/authGuard";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { ContactConflictError, contactValueSchema, updatePhone } from "@/shared/lib/format/contactWrite";

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

    const parsed = contactValueSchema.partial().safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }

    try {
        const row = await updatePhone(phoneIdNum, parsed.data);
        return NextResponse.json(row);
    } catch (err) {
        if (err instanceof ContactConflictError) {
            return NextResponse.json({ error: err.message, field: err.field }, { status: 409 });
        }
        console.error(err);
        return NextResponse.json({ error: "Failed to update phone" }, { status: 500 });
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
