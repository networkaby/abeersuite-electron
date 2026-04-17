import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireAuth, requireRole } from "@/lib/auth-guard";

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const users = await prisma.user.findMany({
            orderBy: { createdAt: "desc" },
            select: { id: true, name: true, email: true, role: true, createdAt: true, userRole: { select: { label: true, color: true } } },
        });
        return NextResponse.json(users);
    } catch {
        return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const { response } = await requireRole("R1");
    if (response) return response;
    try {
        const body = await req.json();
        const password = await bcrypt.hash(body.password, 10);
        const user = await prisma.user.create({
            data: {
                name: body.name,
                email: body.email,
                password,
                role: body.role || "R2",
            },
            select: { id: true, name: true, email: true, role: true, createdAt: true, userRole: { select: { label: true, color: true } } },
        });
        return NextResponse.json(user);
    } catch {
        return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
    }
}