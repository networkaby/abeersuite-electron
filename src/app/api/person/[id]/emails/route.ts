import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { ContactConflictError, contactValueSchema, createEmail } from "@/modules/customer/lib/contactWrite";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

// POST /api/person/[id]/emails — add an email to a person
export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const { response } = await requireAuth();
    if (response) return response;

    const personId = Number((await params).id);
    if (!Number.isFinite(personId)) {
        return NextResponse.json({ error: "Invalid person id" }, { status: 400 });
    }

    const exists = await prisma.person.findUnique({ where: { id: personId }, select: { id: true } });
    if (!exists) return NextResponse.json({ error: "Person not found" }, { status: 404 });

    const { data, error } = await validateRequest(req, contactValueSchema);

    if (error) return error;

    try {
        const row = await createEmail({ personId }, data);
        return NextResponse.json(row, { status: 201 });
    } catch (e) {
        if (e instanceof ContactConflictError) {
            return NextResponse.json({ error: e.message, field: e.field }, { status: 409 });
        }
        return handleApiError(e, "Failed to add email");
    }
}
