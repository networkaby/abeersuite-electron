import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
    try {
        const products = await prisma.shopProduct.findMany({
            where: { isActive: true },
            orderBy: { id: "asc" },
            select: {
                id: true,
                name: true,
                description: true,
                pricePaise: true,
                imageUrl: true,
            },
        });
        return NextResponse.json(products);
    } catch {
        return NextResponse.json({ error: "Failed to load products" }, { status: 500 });
    }
}
