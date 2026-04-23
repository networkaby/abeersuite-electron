import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/lib/auth-guard";
import { z } from "zod";

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
            include: { _count: { select: { tickets: true } } },
        });
        return NextResponse.json(serviceCenters);
    } catch {
        return NextResponse.json({ error: "Failed to fetch service centers" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission("warranty:convert");
    if (response) return response;
    try {
        const parsed = serviceCenterSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid service center payload" }, { status: 400 });
        }
        const body = parsed.data;
        const serviceCenter = await prisma.serviceCenter.create({
            data: {
                name: body.name,
                phone: body.phone,
                email: body.email || null,
                address: body.address || null,
            },
        });
        return NextResponse.json(serviceCenter);
    } catch {
        return NextResponse.json({ error: "Failed to create service center" }, { status: 500 });
    }
}
