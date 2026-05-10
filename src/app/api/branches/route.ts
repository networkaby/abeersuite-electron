import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

const createSchema = z.object({
    id:       z.string().trim().min(1, "ID is required").toUpperCase(),
    name:     z.string().trim().min(1, "Name is required"),
    address:  z.string().trim().optional().nullable(),
    phone:    z.string().trim().optional().nullable(),
    isActive: z.boolean().optional(),
});

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const branches = await prisma.branch.findMany({
            orderBy: { name: "asc" },
            include: { _count: { select: { users: true, departments: true } } },
        });
        return NextResponse.json(branches);
    } catch (e) {
        return handleApiError(e, "Failed to fetch branches");
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, createSchema);
        if (error) return error;
        const { id, name, address, phone, isActive } = data;
        const existing = await prisma.branch.findUnique({ where: { id } });
        if (existing) return NextResponse.json({ error: "Branch ID already exists" }, { status: 409 });
        const branch = await prisma.branch.create({ data: { id, name, address: address ?? null, phone: phone ?? null, isActive: isActive ?? true } });
        return NextResponse.json(branch, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create branch");
    }
}
