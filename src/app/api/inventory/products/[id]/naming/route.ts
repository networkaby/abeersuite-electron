import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError, parseIdParam } from "@/shared/lib/api";
import { buildProductNaming } from "@/modules/inventory/lib/regenerateNames";

// GET /api/inventory/products/[id]/naming
// What Settings → Naming Convention WOULD produce for this product right now
// ({ name, onlineName, slug }), from its current brand / group / model / …
// Read-only: it computes, it never writes — the caller shows the result and the
// operator decides. Consumed by the shop product form's regenerate buttons, so
// any authed staff who can edit a product may read it.
// ?groupId= / ?brandId= build it with a master picked on screen but not saved
// yet ("" = cleared), so the form can show the new name before Save.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { id, error } = await parseIdParam(params);
        if (error) return error;
        const sp = new URL(req.url).searchParams;
        const idOrNull = (k: string) => {
            const v = sp.get(k);
            if (v === null) return undefined;
            const n = parseInt(v, 10);
            return Number.isFinite(n) && n > 0 ? n : null;
        };
        const naming = await buildProductNaming(id, { groupId: idOrNull("groupId"), brandId: idOrNull("brandId") });
        if (!naming) return NextResponse.json({ error: "Product not found" }, { status: 404 });
        return NextResponse.json(naming);
    } catch (e) {
        return handleApiError(e, "Failed to build product naming");
    }
}
