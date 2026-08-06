import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireModuleAccess } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { normalizeHomeLayout, HOME_SECTION_KEYS } from "@/shared/lib/shop/homeLayout";
import { loadHomeLayout } from "@/shared/lib/shop/loadHomeLayout";

// Owner-configurable storefront home page layout — which sections show and in
// what order. Stored on OrgDefaults (singleton id=1).

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const layout = await loadHomeLayout();
        return NextResponse.json({ layout });
    } catch (e) {
        return handleApiError(e, "Failed to load home layout");
    }
}

const putSchema = z.object({
    layout: z.array(
        z.object({
            key: z.enum(HOME_SECTION_KEYS),
            enabled: z.boolean(),
        })
    ),
});

export async function PUT(req: Request) {
    const { response } = await requireModuleAccess("e-commerce");
    if (response) return response;
    const { data, error } = await validateRequest(req, putSchema);
    if (error) return error;
    try {
        // Normalize so the stored column always has every known key exactly
        // once, even if the client sent a partial or reordered list.
        const layout = normalizeHomeLayout(data.layout);
        await prisma.orgDefaults.update({
            where: { id: 1 },
            data: { storefrontHomeJson: layout },
        });
        return NextResponse.json({ layout });
    } catch (e) {
        return handleApiError(e, "Failed to save home layout");
    }
}
