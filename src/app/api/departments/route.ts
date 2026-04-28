import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/lib/auth-guard";
import { z } from "zod";

const createSchema = z.object({
    id:          z.string().trim().min(1, "ID is required").toUpperCase(),
    name:        z.string().trim().min(1, "Name is required"),
    description: z.string().trim().optional().nullable(),
    branchId:    z.string().trim().optional().nullable(),
});

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const departments = await prisma.department.findMany({
            orderBy: { name: "asc" },
            include: {
                branch: { select: { id: true, name: true } },
                _count: { select: { users: true } },
            },
        });
        return NextResponse.json(departments);
    } catch {
        return NextResponse.json({ error: "Failed to fetch departments" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;
    try {
        const parsed = createSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
        }
        const { id, name, description, branchId } = parsed.data;
        const existing = await prisma.department.findUnique({ where: { id } });
        if (existing) return NextResponse.json({ error: "Department ID already exists" }, { status: 409 });
        const department = await prisma.department.create({
            data: { id, name, description: description ?? null, branchId: branchId ?? null },
            include: { branch: { select: { id: true, name: true } } },
        });
        return NextResponse.json(department, { status: 201 });
    } catch {
        return NextResponse.json({ error: "Failed to create department" }, { status: 500 });
    }
}
