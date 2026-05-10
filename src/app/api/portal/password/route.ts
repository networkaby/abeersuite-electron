import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";

const schema = z.object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(6, "Password must be at least 6 characters"),
});

export async function PATCH(req: Request) {
    const authResult = await requirePortalCustomer();
    if (authResult.response) return authResult.response;

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }

    try {
        const credential = await prisma.personPortalCredential.findUnique({
            where: { personId: authResult.customerId! },
            select: { passwordHash: true },
        });
        if (!credential) {
            return NextResponse.json({ error: "No portal credential found for this account" }, { status: 404 });
        }

        const isValid = await bcrypt.compare(parsed.data.currentPassword, credential.passwordHash);
        if (!isValid) {
            return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
        }

        const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
        await prisma.personPortalCredential.update({
            where: { personId: authResult.customerId! },
            data: { passwordHash },
        });

        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Failed to update password" }, { status: 500 });
    }
}

