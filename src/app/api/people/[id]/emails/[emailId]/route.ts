import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { ContactConflictError, contactValueSchema, updateEmail } from "@/shared/lib/format/contactWrite";
import { validateRequest } from "@/shared/lib/api";

// PATCH /api/people/[id]/emails/[emailId]
export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string; emailId: string }> },
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id, emailId } = await params;
    const emailIdNum = Number(emailId);
    const personIdNum = Number(id);
    if (!Number.isFinite(emailIdNum) || !Number.isFinite(personIdNum)) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const existing = await prisma.email.findUnique({ where: { id: emailIdNum } });
    if (!existing || existing.personId !== personIdNum) {
        return NextResponse.json({ error: "Email not found for this person" }, { status: 404 });
    }

    const { data, error } = await validateRequest(req, contactValueSchema.partial());
    if (error) return error;

    try {
        const row = await updateEmail(emailIdNum, data);
        return NextResponse.json(row);
    } catch (err) {
        if (err instanceof ContactConflictError) {
            return NextResponse.json({ error: err.message, field: err.field }, { status: 409 });
        }
        console.error(err);
        return NextResponse.json({ error: "Failed to update email" }, { status: 500 });
    }
}

// DELETE /api/people/[id]/emails/[emailId]
export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string; emailId: string }> },
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id, emailId } = await params;
    const emailIdNum = Number(emailId);
    const personIdNum = Number(id);
    const existing = await prisma.email.findUnique({ where: { id: emailIdNum } });
    if (!existing || existing.personId !== personIdNum) {
        return NextResponse.json({ error: "Email not found for this person" }, { status: 404 });
    }

    await prisma.email.delete({ where: { id: emailIdNum } });
    return NextResponse.json({ success: true });
}
