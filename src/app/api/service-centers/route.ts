import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
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
    try {
        const body = await req.json();
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