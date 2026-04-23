import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { z } from "zod";

const customerSchema = z.object({
    name: z.string().trim().min(1, "Name is required"),
    phone: z.string().trim().min(1, "Phone is required"),
    email: z.string().trim().email("Invalid email").optional().or(z.literal("")),
});

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { searchParams } = new URL(req.url);
        const phone = searchParams.get("phone");

        const customers = await prisma.customer.findMany({
            where: phone ? { phone: { contains: phone } } : undefined,
            orderBy: { createdAt: "desc" },
            include: { devices: true },
        });
        return NextResponse.json(customers);
    } catch {
        return NextResponse.json({ error: "Failed to fetch customers" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const parsed = customerSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid customer payload" }, { status: 400 });
        }
        const body = parsed.data;
        const customer = await prisma.customer.create({
            data: {
                name: body.name,
                phone: body.phone,
                email: body.email || null,
            },
        });
        return NextResponse.json(customer);
    } catch {
        return NextResponse.json({ error: "Failed to create customer" }, { status: 500 });
    }
}
