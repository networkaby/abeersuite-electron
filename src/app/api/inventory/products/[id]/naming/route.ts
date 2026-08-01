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
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { id, error } = await parseIdParam(params);
        if (error) return error;
        const naming = await buildProductNaming(id);
        if (!naming) return NextResponse.json({ error: "Product not found" }, { status: 404 });
        return NextResponse.json(naming);
    } catch (e) {
        return handleApiError(e, "Failed to build product naming");
    }
}
