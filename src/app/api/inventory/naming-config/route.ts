import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requireModuleAccess } from "@/shared/lib/auth/permissions";
import { invNamingConfigUpdateSchema } from "@/shared/lib/schemas/inventorySchemas";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { DEFAULT_NAMING_CONFIG } from "@/modules/inventory/lib/productName";

// Singleton — there is at most one row. GET returns the row, or
// DEFAULT_NAMING_CONFIG when the table is empty so the page renders before
// the first save. PUT upserts (no POST, no [id]).

export async function GET() {
    // Read is open to any signed-in user: every product-creating role needs the
    // naming template to auto-generate names. Writes stay behind inventory:manage.
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const row = await prisma.invNamingConfig.findFirst({ orderBy: { id: "asc" } });
        if (!row) return NextResponse.json({ id: null, ...DEFAULT_NAMING_CONFIG });
        return NextResponse.json(row);
    } catch (e) {
        return handleApiError(e, "Failed to fetch naming config");
    }
}

export async function PUT(req: Request) {
    const { response } = await requireModuleAccess("inventory");
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, invNamingConfigUpdateSchema);
        if (error) return error;

        const existing = await prisma.invNamingConfig.findFirst({ orderBy: { id: "asc" } });
        const row = existing
            ? await prisma.invNamingConfig.update({ where: { id: existing.id }, data })
            : await prisma.invNamingConfig.create({ data });
        return NextResponse.json(row);
    } catch (e) {
        return handleApiError(e, "Failed to save naming config");
    }
}
