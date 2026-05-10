import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { ContactConflictError, contactValueSchema, createEmail } from "@/shared/lib/format/contactWrite";
import { validateRequest } from "@/shared/lib/api";

// POST /api/people/[id]/emails — add an email to a person
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
    } catch (err) {
        if (err instanceof ContactConflictError) {
            return NextResponse.json({ error: err.message, field: err.field }, { status: 409 });
        }
        console.error(err);
        return NextResponse.json({ error: "Failed to add email" }, { status: 500 });
    }
}
