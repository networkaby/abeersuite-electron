import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await req.json();

        const data: Prisma.UserUpdateInput = {
            name: body.name,
            email: body.email,
            role: body.role,
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
        await prisma.user.delete({ where: { id: Number(id) } });
        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
    }
}