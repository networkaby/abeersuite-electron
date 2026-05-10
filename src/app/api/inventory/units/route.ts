import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { invUnitCreateSchema } from "@/shared/lib/schemas/inventorySchemas";
import { prismaUniqueError } from "@/shared/lib/api";
import { unstable_cache, revalidateTag } from "next/cache";
import { validateRequest } from "@/shared/lib/api";

// Cache key+tag exported so the [id] route's PATCH/DELETE can revalidate.
export const INV_UNITS_TAG = "inv-units";

const getUnitsCached = unstable_cache(
    async () => prisma.invUnit.findMany({ orderBy: { code: "asc" } }),
    ["inv-units:list"],
    { tags: [INV_UNITS_TAG], revalidate: 3600 },
);

export async function GET() {
    const { response } = await requirePermission("inventory:manage");
    if (response) return response;
    try {
        const rows = await getUnitsCached();
        return NextResponse.json(rows);
    } catch {
        return NextResponse.json({ error: "Failed to fetch units" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission("inventory:manage");
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, invUnitCreateSchema);
        if (error) return error;
        const b = data;
        const row = await prisma.invUnit.create({
            data: {
                code: b.code.toUpperCase(),
                label: b.label,
                decimals: b.decimals ?? 0,
                isActive: b.isActive ?? true,
            },
        });
        revalidateTag(INV_UNITS_TAG, { expire: 0 });
        return NextResponse.json(row, { status: 201 });
    } catch (e: unknown) {
        const conflict = prismaUniqueError(e, "Unit code already exists");
        if (conflict) return conflict;
        return NextResponse.json({ error: "Failed to create unit" }, { status: 500 });
    }
}
