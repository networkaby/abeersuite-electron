import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { cancelWaiting, startAi } from "@/modules/ecommerce/lib/shopWaiting";

// POST /api/ecommerce/products/waiting { ids, action } — the Waiting stage
// (owner, 2026-11-17). start = Start AI: shortlist for the product-prep run (an
// Attention product's flag is cleared); remove = back to the stage it came from.
// No permission of its own — anyone who works on shop products (owner).

const schema = z.object({
    ids: z.array(z.coerce.number().int().positive()).min(1).max(5000),
    action: z.enum(["start", "remove"]),
});

export async function POST(req: Request) {
    const { response } = await requireModuleAccess("e-commerce");
    if (response) return response;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    try {
        return NextResponse.json(data.action === "start" ? await startAi(data.ids) : await cancelWaiting(data.ids));
    } catch (e) {
        return handleApiError(e, "Could not update the Start list");
    }
}
