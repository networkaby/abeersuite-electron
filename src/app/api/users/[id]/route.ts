import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { Role } from "@/generated/prisma/client";
import bcrypt from "bcryptjs";

export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await req.json();

        const data: {
            name: string;
            email: string;
            role: Role;
            password?: string;
        } = {
            name: body.name,
            email: body.email,
            role: body.role as Role,
        };

        if (body.password) {
            data.password = await bcrypt.hash(body.password, 10);
        }

        const user = await prisma.user.update({
            where: { id: Number(id) },
            data,
            select: { id: true, name: true, email: true, role: true, createdAt: true },
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