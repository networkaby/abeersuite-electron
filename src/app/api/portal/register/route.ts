import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import {
    isLikelyEmail,
    normalizePortalEmail,
    normalizePortalPhone,
} from "@/lib/auth/portal-identifier";

const bodySchema = z.object({
    mode: z.enum(["mobile", "email"]),
    identifier: z.string().trim().min(3),
    password: z.string().min(6),
    name: z.string().trim().min(1).optional(),
});

export async function POST(req: Request) {
    try {
        const parsed = bodySchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json(
                { error: parsed.error.issues[0]?.message ?? "Invalid payload" },
                { status: 400 }
            );
        }
        const { mode, identifier, password, name } = parsed.data;

        let phone: string | null = null;
        let email: string | null = null;
        let phoneNorm: string | null = null;
        let emailNorm: string | null = null;

        if (mode === "email" || isLikelyEmail(identifier)) {
            emailNorm = normalizePortalEmail(identifier);
            email = emailNorm;
        } else {
            phoneNorm = normalizePortalPhone(identifier);
            if (!phoneNorm) {
                return NextResponse.json({ error: "Invalid mobile number" }, { status: 400 });
            }
            phone = identifier.trim();
        }

        const existingCred =
            phoneNorm != null
                ? await prisma.customerPortalCredential.findFirst({ where: { phoneNormalized: phoneNorm } })
                : emailNorm != null
                  ? await prisma.customerPortalCredential.findFirst({ where: { emailNormalized: emailNorm } })
                  : null;
        if (existingCred) {
            return NextResponse.json({ error: "An account already exists for this mobile or email" }, { status: 409 });
        }

        let customer: { id: number; name: string; phone: string | null; email: string | null } | null = null;
        if (emailNorm) {
            customer = await prisma.customer.findFirst({
                where: { email: { equals: emailNorm, mode: "insensitive" } },
            });
        }
        if (!customer && phoneNorm) {
            const candidates = await prisma.customer.findMany({
                where: { phone: { not: null } },
                select: { id: true, name: true, phone: true, email: true },
                take: 500,
            });
            customer =
                candidates.find((c) => c.phone && normalizePortalPhone(c.phone) === phoneNorm) ?? null;
        }

        if (!customer) {
            customer = await prisma.customer.create({
                data: {
                    name: name || (emailNorm ? emailNorm.split("@")[0] : "Customer") || "Customer",
                    phone: phoneNorm ? `+91${phoneNorm}` : phone ?? undefined,
                    email: emailNorm ?? undefined,
                },
            });
        } else {
            const data: { name?: string; phone?: string; email?: string } = {};
            if (name) data.name = name;
            if (phone && !customer.phone) data.phone = phone;
            if (email && !customer.email) data.email = email;
            if (Object.keys(data).length) {
                customer = await prisma.customer.update({
                    where: { id: customer.id },
                    data,
                });
            }
        }

        const finalPhoneNorm =
            phoneNorm ?? (customer.phone ? normalizePortalPhone(customer.phone) : null) ?? null;
        const finalEmailNorm =
            emailNorm ?? (customer.email ? normalizePortalEmail(customer.email) : null) ?? null;

        if (!finalPhoneNorm && !finalEmailNorm) {
            return NextResponse.json(
                { error: "Provide a valid mobile or email so you can sign in later" },
                { status: 400 }
            );
        }

        const hash = await bcrypt.hash(password, 10);
        await prisma.customerPortalCredential.create({
            data: {
                customerId: customer.id,
                phoneNormalized: finalPhoneNorm,
                emailNormalized: finalEmailNorm,
                passwordHash: hash,
            },
        });

        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ error: "Registration failed" }, { status: 500 });
    }
}
