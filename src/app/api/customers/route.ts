import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
    try {
        const customers = await prisma.customer.findMany({
            orderBy: { createdAt: "desc" },
            include: { devices: true },
        });
        return NextResponse.json(customers);
    } catch (error) {
        return NextResponse.json({ error: "Failed to fetch customers" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const customer = await prisma.customer.create({
            data: {
                name: body.name,
                phone: body.phone,
                email: body.email || null,
            },
        });
        return NextResponse.json(customer);
    } catch (error) {
        return NextResponse.json({ error: "Failed to create customer" }, { status: 500 });
    }
}