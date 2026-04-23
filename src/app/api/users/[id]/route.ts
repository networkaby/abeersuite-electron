import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requirePermission } from "@/lib/auth-guard";
import { z } from "zod";

const userUpdateSchema = z.object({
    name: z.string().trim().min(1, "Name is required"),
    email: z.string().trim().email("Valid email is required"),
    role: z.string().trim().min(1, "Role is required"),
    managerId: z.union([z.coerce.number().int().positive(), z.literal(""), z.null()]).optional(),
    password: z.string().min(6, "Password must be at least 6 characters").optional().or(z.literal("")),
});

export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requirePermission("users:manage");
    if (response) return response;
    try {
        const { id } = await params;
        const parsed = userUpdateSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid user payload" }, { status: 400 });
        }
        const body = parsed.data;

        const primaryRole: string = body.role as string;

        const data: {
            name: string;
            email: string;
            role: string;
            managerId?: number | null;
            password?: string;
        } = {
            name: body.name,
            email: body.email,
            role: primaryRole,
            managerId: body.managerId !== undefined
                ? (body.managerId ? Number(body.managerId) : null)
                : undefined,
        };

        if (body.password) {
            data.password = await bcrypt.hash(body.password, 10);
        }

        // Update user + keep primary UserRole in sync
        const user = await prisma.$transaction(async (tx) => {
            const updated = await tx.user.update({
                where: { id: Number(id) },
                data,
                select: { id: true, name: true, email: true, role: true, createdAt: true },
            });
            // Upsert the primary UserRole row (don't touch any secondary roles)
            await tx.userRole.upsert({
                where: { userId_roleId: { userId: updated.id, roleId: primaryRole } },
                create: { userId: updated.id, roleId: primaryRole, isPrimary: true },
                update: { isPrimary: true },
            });
            // Demote any old primary that's no longer primary
            await tx.userRole.updateMany({
                where: { userId: updated.id, roleId: { not: primaryRole }, isPrimary: true },
                data: { isPrimary: false },
            });
            return updated;
        });

        return NextResponse.json(user);
    } catch {
        return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
    }
}

export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requirePermission("users:manage");
    if (response) return response;
    try {
        const { id } = await params;
        const userId = Number(id);

        if (Number.isNaN(userId)) {
            return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
        }

        const userWithRelations = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                _count: {
                    select: {
                        ownedTickets: true,
                        ticketLogs: true,
                    },
                },
            },
        });

        if (!userWithRelations) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        if (userWithRelations._count.ownedTickets > 0 || userWithRelations._count.ticketLogs > 0) {
            return NextResponse.json(
                {
                    error:
                        "Cannot delete user because linked tickets or ticket logs exist. Reassign records first.",
                },
                { status: 400 }
            );
        }

        await prisma.user.delete({ where: { id: userId } });
        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
    }
}
