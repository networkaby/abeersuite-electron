import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireRole } from "@/lib/auth-guard";

export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireRole("R1");
    if (response) return response;
    try {
        const { id } = await params;
        const body = await req.json();

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
    const { response } = await requireRole("R1");
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
                        tickets: true,
                        ticketLogs: true,
                    },
                },
            },
        });

        if (!userWithRelations) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        if (userWithRelations._count.tickets > 0 || userWithRelations._count.ticketLogs > 0) {
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