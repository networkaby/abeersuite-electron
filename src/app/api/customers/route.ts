import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const phone = searchParams.get("phone");

        const customers = await prisma.customer.findMany({
            where: phone ? { phone: { contains: phone } } : undefined,
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