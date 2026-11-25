import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { prismaWhereSaved } from "@/shared/lib/prisma/prismaClient";
import { ContactConflictError, contactValueSchema, createEmail } from "@/modules/customer/lib/contactWrite";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const { response } = await requireAuth();
    if (response) return response;

    const companyId = Number((await params).id);
    if (!Number.isFinite(companyId)) {
        return NextResponse.json({ error: "Invalid company id" }, { status: 400 });
    }

    const exists = await prismaWhereSaved().company.findUnique({ where: { id: companyId }, select: { id: true } });
    if (!exists) return NextResponse.json({ error: "Company not found" }, { status: 404 });

    const { data, error } = await validateRequest(req, contactValueSchema);

    if (error) return error;

    try {
        const row = await createEmail({ companyId }, data);
        return NextResponse.json(row, { status: 201 });
    } catch (e) {
        if (e instanceof ContactConflictError) {
            return NextResponse.json({ error: e.message, field: e.field }, { status: 409 });
        }
        return handleApiError(e, "Failed to add email");
    }
}
