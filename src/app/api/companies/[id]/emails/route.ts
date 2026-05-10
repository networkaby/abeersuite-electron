import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/authGuard";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { ContactConflictError, contactValueSchema, createEmail } from "@/shared/lib/format/contactWrite";

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

    const exists = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
    if (!exists) return NextResponse.json({ error: "Company not found" }, { status: 404 });

    const parsed = contactValueSchema.safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }

    try {
        const row = await createEmail({ companyId }, parsed.data);
        return NextResponse.json(row, { status: 201 });
    } catch (err) {
        if (err instanceof ContactConflictError) {
            return NextResponse.json({ error: err.message, field: err.field }, { status: 409 });
        }
        console.error(err);
        return NextResponse.json({ error: "Failed to add email" }, { status: 500 });
    }
}
