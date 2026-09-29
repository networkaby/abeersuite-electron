import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAnyPermission } from "@/shared/lib/auth/permissions";
import { validateRequest } from "@/shared/lib/api/validateRequest";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { sidebarChildPermissionId } from "@/shared/lib/auth/sidebarModules";
import { z } from "zod";

const protectionSchema = z.object({
    productId: z.coerce.number().int().positive(),
});

// Read and write share one gate — the Protection page is the only reader.
const requireProtectionAccess = () => requireAnyPermission(
    sidebarChildPermissionId("retention", "protection"),
    PERMISSIONS.RETENTION_PROTECTION_MANAGE,
);

export async function GET() {
    const { response } = await requireProtectionAccess();
    if (response) return response;

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
    // RBAC bridge: page view rides the sidebar link grant; the manage capability
    // also opens the page. Relax the hard gate to match the page layout until
    // server-side per-action security is implemented (see AGENTS.md).
    const { response } = await requireProtectionAccess();
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
