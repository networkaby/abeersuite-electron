import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { normalizePortalEmail, normalizePortalPhone } from "@/shared/lib/auth/portalIdentifier";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { selectPrimaryPhone, selectPrimaryEmail } from "@/shared/lib/prisma/fragments";

const schema = z.object({
    tempPassword: z.string().min(6, "Temporary password must be at least 6 characters"),
});

export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requirePermission(PERMISSIONS.USERS_MANAGE);
    if (response) return response;

    const { data, error } = await validateRequest(req, schema);

    if (error) return error;

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
            phones: selectPrimaryPhone,
            emails: selectPrimaryEmail,
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
        const passwordHash = await bcrypt.hash(data.tempPassword, 10);
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
    } catch (e) {
        return handleApiError(e, "Failed to reset person portal password");
    }
}
