import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/authGuard";
import { invUnitCreateSchema } from "@/shared/lib/schemas/inventorySchemas";
import { unstable_cache, revalidateTag } from "next/cache";

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
        const parsed = invUnitCreateSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
        }
        const b = parsed.data;
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
        const code = typeof e === "object" && e !== null && "code" in e ? (e as { code: string }).code : "";
        if (code === "P2002") return NextResponse.json({ error: "Unit code already exists" }, { status: 409 });
        return NextResponse.json({ error: "Failed to create unit" }, { status: 500 });
    }
}
