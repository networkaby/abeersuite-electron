import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { z } from "zod";

const createSchema = z.object({
    name: z.string().trim().min(1),
    description: z.string().trim().optional().nullable(),
    pricePaise: z.coerce.number().int().positive(),
    imageUrl: z.string().url().optional().nullable(),
    isActive: z.boolean().optional(),
});

export async function GET() {
    const { response } = await requirePermission("ecommerce:manage");
    if (response) return response;
    try {
        const products = await prisma.shopProduct.findMany({ orderBy: { id: "desc" } });
        return NextResponse.json(products);
    } catch {
        return NextResponse.json({ error: "Failed to list products" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission("ecommerce:manage");
    if (response) return response;
    try {
        const parsed = createSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json(
                { error: parsed.error.issues[0]?.message ?? "Invalid payload" },
                { status: 400 }
            );
        }
        const b = parsed.data;
        const p = await prisma.shopProduct.create({
            data: {
                name: b.name,
                description: b.description ?? null,
                pricePaise: b.pricePaise,
                imageUrl: b.imageUrl ?? null,
                isActive: b.isActive ?? true,
            },
        });
        return NextResponse.json(p);
    } catch {
        return NextResponse.json({ error: "Failed to create product" }, { status: 500 });
    }
}
