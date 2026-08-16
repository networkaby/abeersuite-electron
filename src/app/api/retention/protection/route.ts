import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest } from "@/shared/lib/api/validateRequest";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { z } from "zod";

const protectionSchema = z.object({
    productId: z.coerce.number().int().positive(),
});

export async function GET() {
    const items = await prisma.productProtection.findMany({
        include: {
            product: {
                select: {
                    id: true,
                    sku: true,
                    name: true,
                }
            }
        },
        orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(items);
}

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.RETENTION_PROTECTION_MANAGE);
    if (response) return response;

    const { data, error } = await validateRequest(req, protectionSchema);
    if (error) return error;

    const item = await prisma.productProtection.upsert({
        where: { productId: data.productId },
        update: {},
        create: { productId: data.productId },
        include: {
            product: {
                select: {
                    id: true,
                    sku: true,
                    name: true,
                }
            }
        },
    });

    return NextResponse.json(item);
}
