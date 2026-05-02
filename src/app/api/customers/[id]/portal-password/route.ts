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
    const customerId = Number(id);
    if (Number.isNaN(customerId)) {
        return NextResponse.json({ error: "Invalid customer id" }, { status: 400 });
    }

    const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true, isActive: true, email: true, phone: true, name: true },
    });
    if (!customer || !customer.isActive) {
        return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const emailNormalized = customer.email ? normalizePortalEmail(customer.email) : null;
    const phoneNormalized = customer.phone ? normalizePortalPhone(customer.phone) : null;

    if (!emailNormalized && !phoneNormalized) {
        return NextResponse.json(
            { error: "Customer must have email or mobile to receive a portal login credential" },
            { status: 409 }
        );
    }

    try {
        const passwordHash = await bcrypt.hash(parsed.data.tempPassword, 10);
        await prisma.customerPortalCredential.upsert({
            where: { customerId },
            update: {
                passwordHash,
                emailNormalized,
                phoneNormalized,
            },
            create: {
                customerId,
                passwordHash,
                emailNormalized,
                phoneNormalized,
            },
        });

        return NextResponse.json({
            success: true,
            customerId,
            customerName: customer.name,
        });
    } catch {
        return NextResponse.json({ error: "Failed to reset customer portal password" }, { status: 500 });
    }
}

