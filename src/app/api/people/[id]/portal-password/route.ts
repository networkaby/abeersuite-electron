import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guard";
import { normalizePortalEmail, normalizePortalPhone } from "@/lib/auth/portal-identifier";

const schema = z.object({
    tempPassword: z.string().min(6, "Temporary password must be at least 6 characters"),
});

export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requirePermission("users:manage");
    if (response) return response;

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }

    const { id } = await params;
    const personId = Number(id);
    if (Number.isNaN(personId)) {
        return NextResponse.json({ error: "Invalid person id" }, { status: 400 });
    }

    const person = await prisma.person.findUnique({
        where: { id: personId },
        select: {
            id: true,
            isActive: true,
            name: true,
            phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1 },
            emails: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1 },
        },
    });
    if (!person || !person.isActive) {
        return NextResponse.json({ error: "Person not found" }, { status: 404 });
    }

    const primaryEmail = person.emails[0]?.email ?? null;
    const primaryPhone = person.phones[0]?.phone ?? null;

    const emailNormalized = primaryEmail ? normalizePortalEmail(primaryEmail) : null;
    const phoneNormalized = primaryPhone ? normalizePortalPhone(primaryPhone) : null;

    if (!emailNormalized && !phoneNormalized) {
        return NextResponse.json(
            { error: "Person must have email or mobile to receive a portal login credential" },
            { status: 409 }
        );
    }

    try {
        const passwordHash = await bcrypt.hash(parsed.data.tempPassword, 10);
        await prisma.personPortalCredential.upsert({
            where: { personId },
            update: {
                passwordHash,
                emailNormalized,
                phoneNormalized,
            },
            create: {
                personId,
                passwordHash,
                emailNormalized,
                phoneNormalized,
            },
        });

        return NextResponse.json({
            success: true,
            personId,
            personName: person.name,
        });
    } catch {
        return NextResponse.json({ error: "Failed to reset person portal password" }, { status: 500 });
    }
}
