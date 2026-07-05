import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

const serviceCenterSchema = z.object({
    name: z.string().trim().min(1, "Name is required"),
    phone: z.string().trim().min(1, "Phone is required"),
    email: z.string().trim().email("Invalid email").optional().or(z.literal("")),
    address: z.string().trim().optional().or(z.literal("")),
});

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const serviceCenters = await prisma.serviceCenter.findMany({
            orderBy: { createdAt: "desc" },
            include: { _count: { select: { repairs: true } } },
        });
        return NextResponse.json(serviceCenters);
    } catch (e) {
        return handleApiError(e, "Failed to fetch service centers");
    }
}

export async function POST(req: Request) {
    // TODO(rbac): was requirePermission(WARRANTY_CONVERT) — open to all staff for now.
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, serviceCenterSchema);
        if (error) return error;
        const body = data;
        const serviceCenter = await prisma.serviceCenter.create({
            data: {
                name: body.name,
                phone: body.phone,
                email: body.email || null,
                address: body.address || null,
            },
        });
        return NextResponse.json(serviceCenter);
    } catch (e) {
        return handleApiError(e, "Failed to create service center");
    }
}
