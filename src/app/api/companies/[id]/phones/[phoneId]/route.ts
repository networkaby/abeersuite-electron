import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { ContactConflictError, contactValueSchema, updatePhone } from "@/shared/lib/format/contactWrite";
import { validateRequest } from "@/shared/lib/api";

export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string; phoneId: string }> },
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id, phoneId } = await params;
    const phoneIdNum = Number(phoneId);
    const companyIdNum = Number(id);
    if (!Number.isFinite(phoneIdNum) || !Number.isFinite(companyIdNum)) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const existing = await prisma.phone.findUnique({ where: { id: phoneIdNum } });
    if (!existing || existing.companyId !== companyIdNum) {
        return NextResponse.json({ error: "Phone not found for this company" }, { status: 404 });
    }

    const { data, error } = await validateRequest(req, contactValueSchema.partial());
    if (error) return error;

    try {
        const row = await updatePhone(phoneIdNum, data);
        return NextResponse.json(row);
    } catch (err) {
        if (err instanceof ContactConflictError) {
            return NextResponse.json({ error: err.message, field: err.field }, { status: 409 });
        }
        console.error(err);
        return NextResponse.json({ error: "Failed to update phone" }, { status: 500 });
    }
}

export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string; phoneId: string }> },
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id, phoneId } = await params;
    const phoneIdNum = Number(phoneId);
    const companyIdNum = Number(id);
    const existing = await prisma.phone.findUnique({ where: { id: phoneIdNum } });
    if (!existing || existing.companyId !== companyIdNum) {
        return NextResponse.json({ error: "Phone not found for this company" }, { status: 404 });
    }

    await prisma.phone.delete({ where: { id: phoneIdNum } });
    return NextResponse.json({ success: true });
}
