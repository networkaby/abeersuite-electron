import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError, prismaUniqueError, validateRequest } from "@/shared/lib/api";
import { z } from "zod";

// Settings → Customer Groups — marketing segment master (Corporate / School /
// Lawyer …) for product targeting. Internal-only: assigned on the customer
// profile, never shown to the customer. See customerQuality.ts.

const createSchema = z.object({
    name:     z.string().trim().min(1).max(80),
    isActive: z.boolean().optional(),
});

// GET /api/settings/customer-groups — full list (incl. inactive) with usage counts.
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const rows = await prisma.customerGroup.findMany({
            orderBy: { name: "asc" },
            include: { _count: { select: { persons: true, companies: true } } },
        });
        return NextResponse.json(rows);
    } catch (e) {
        return handleApiError(e, "Failed to fetch customer groups");
    }
}

// POST /api/settings/customer-groups — create a group.
export async function POST(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, createSchema);
        if (error) return error;
        const row = await prisma.customerGroup.create({
            data: { name: data.name, isActive: data.isActive ?? true },
        });
        return NextResponse.json(row, { status: 201 });
    } catch (e) {
        const conflict = prismaUniqueError(e, "A group with that name already exists");
        if (conflict) return conflict;
        return handleApiError(e, "Failed to create customer group");
    }
}
