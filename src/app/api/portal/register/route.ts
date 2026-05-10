import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import {
    isLikelyEmail,
    normalizePortalEmail,
    normalizePortalPhone,
} from "@/shared/lib/auth/portalIdentifier";

const bodySchema = z.object({
    mode: z.enum(["mobile", "email"]),
    identifier: z.string().trim().min(3),
    password: z.string().min(6),
    name: z.string().trim().min(1).optional(),
});

export async function POST(req: Request) {
    try {
        const { data, error } = await validateRequest(req, bodySchema);
        if (error) return error;
        const { mode, identifier, password, name } = data;

        let phoneRaw: string | null = null;
        let emailRaw: string | null = null;
        let phoneNorm: string | null = null;
        let emailNorm: string | null = null;

        if (mode === "email" || isLikelyEmail(identifier)) {
            emailNorm = normalizePortalEmail(identifier);
            emailRaw = emailNorm;
        } else {
            phoneNorm = normalizePortalPhone(identifier);
            if (!phoneNorm) {
                return NextResponse.json({ error: "Invalid mobile number" }, { status: 400 });
            }
            phoneRaw = identifier.trim();
        }

        const existingCred =
            phoneNorm != null
                ? await prisma.personPortalCredential.findFirst({ where: { phoneNormalized: phoneNorm } })
                : emailNorm != null
                  ? await prisma.personPortalCredential.findFirst({ where: { emailNormalized: emailNorm } })
                  : null;
        if (existingCred) {
            return NextResponse.json({ error: "An account already exists for this mobile or email" }, { status: 409 });
        }

        // Look up an existing person by stored phone/email rows.
        let person: { id: number; name: string } | null = null;
        if (emailNorm) {
            const match = await prisma.email.findFirst({
                where: { email: { equals: emailNorm, mode: "insensitive" }, personId: { not: null } },
                select: { person: { select: { id: true, name: true } } },
            });
            person = match?.person ?? null;
        }
        if (!person && phoneNorm) {
            // Phone rows may store the prefixed format; scan candidates and normalise.
            const phoneCandidates = await prisma.phone.findMany({
                where: { personId: { not: null } },
                select: { phone: true, person: { select: { id: true, name: true } } },
                take: 500,
            });
            person =
                phoneCandidates.find(
                    (row) => row.phone && normalizePortalPhone(row.phone) === phoneNorm,
                )?.person ?? null;
        }

        if (!person) {
            const created = await prisma.$transaction(async (tx) => {
                const p = await tx.person.create({
                    data: {
                        name: name || (emailNorm ? emailNorm.split("@")[0] : "Customer") || "Customer",
                    },
                });
                if (phoneNorm || phoneRaw) {
                    await tx.phone.create({
                        data: {
                            phone: phoneNorm ? `+91${phoneNorm}` : phoneRaw!,
                            personId: p.id,
                            isPrimary: true,
                        },
                    });
                }
                if (emailNorm) {
                    await tx.email.create({
                        data: { email: emailNorm, personId: p.id, isPrimary: true },
                    });
                }
                await tx.account.create({
                    data: { personId: p.id, name: p.name },
                });
                return p;
            });
            person = { id: created.id, name: created.name };
        } else {
            if (name) {
                await prisma.person.update({ where: { id: person.id }, data: { name } });
                person.name = name;
            }
            // If a phone or email was provided that the person doesn't yet have,
            // attach it (best-effort; ignore unique violations).
            if (phoneRaw || phoneNorm) {
                const phoneVal = phoneNorm ? `+91${phoneNorm}` : phoneRaw!;
                try {
                    await prisma.phone.create({
                        data: { phone: phoneVal, personId: person.id },
                    });
                } catch {
                    /* already exists — ignore */
                }
            }
            if (emailNorm) {
                try {
                    await prisma.email.create({
                        data: { email: emailNorm, personId: person.id },
                    });
                } catch {
                    /* already exists — ignore */
                }
            }
            const existingAccount = await prisma.account.findUnique({
                where: { personId: person.id },
                select: { id: true },
            });
            if (!existingAccount) {
                await prisma.account.create({
                    data: { personId: person.id, name: person.name },
                });
            }
        }

        if (!phoneNorm && !emailNorm) {
            return NextResponse.json(
                { error: "Provide a valid mobile or email so you can sign in later" },
                { status: 400 }
            );
        }

        const hash = await bcrypt.hash(password, 10);
        await prisma.personPortalCredential.create({
            data: {
                personId: person.id,
                phoneNormalized: phoneNorm,
                emailNormalized: emailNorm,
                passwordHash: hash,
            },
        });

        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Registration failed");
    }
}
