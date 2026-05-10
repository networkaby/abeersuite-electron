import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { ContactConflictError, contactValueSchema, updateEmail } from "@/shared/lib/format/contactWrite";

export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string; emailId: string }> },
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id, emailId } = await params;
    const emailIdNum = Number(emailId);
    const companyIdNum = Number(id);
    if (!Number.isFinite(emailIdNum) || !Number.isFinite(companyIdNum)) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const existing = await prisma.email.findUnique({ where: { id: emailIdNum } });
    if (!existing || existing.companyId !== companyIdNum) {
        return NextResponse.json({ error: "Email not found for this company" }, { status: 404 });
    }

    const parsed = contactValueSchema.partial().safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }

    try {
        const row = await updateEmail(emailIdNum, parsed.data);
        return NextResponse.json(row);
    } catch (err) {
        if (err instanceof ContactConflictError) {
            return NextResponse.json({ error: err.message, field: err.field }, { status: 409 });
        }
        console.error(err);
        return NextResponse.json({ error: "Failed to update email" }, { status: 500 });
    }
}

export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string; emailId: string }> },
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id, emailId } = await params;
    const emailIdNum = Number(emailId);
    const companyIdNum = Number(id);
    const existing = await prisma.email.findUnique({ where: { id: emailIdNum } });
    if (!existing || existing.companyId !== companyIdNum) {
        return NextResponse.json({ error: "Email not found for this company" }, { status: 404 });
    }

    await prisma.email.delete({ where: { id: emailIdNum } });
    return NextResponse.json({ success: true });
}
