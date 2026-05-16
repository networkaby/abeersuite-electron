import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { ContactConflictError, contactValueSchema, updateEmail } from "@/modules/customer/lib/contactWrite";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

// PATCH /api/person/[id]/emails/[emailId]
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
    } catch (e) {
        if (e instanceof ContactConflictError) {
            return NextResponse.json({ error: e.message, field: e.field }, { status: 409 });
        }
        return handleApiError(e, "Failed to update email");
    }
}

// DELETE /api/person/[id]/emails/[emailId]
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
