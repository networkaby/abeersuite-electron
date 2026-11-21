import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { cancelWaiting, startAi } from "@/modules/ecommerce/lib/shopWaiting";
import { recordStaffMoves, staffName, stagesNow } from "@/modules/ecommerce/lib/shopStaffMoves";

// POST /api/ecommerce/products/waiting { ids, action } — the Waiting stage
// (owner, 2026-11-17). start = Start AI: shortlist for the product-prep run (an
// Attention product's flag is cleared); remove = back to the stage it came from.
// No permission of its own — anyone who works on shop products (owner).

const schema = z.object({
    ids: z.array(z.coerce.number().int().positive()).min(1).max(5000),
    action: z.enum(["start", "remove"]),
});

export async function POST(req: Request) {
    const mod = await requireModuleAccess("e-commerce");
    if (mod.response) return mod.response;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    try {
        const before = await stagesNow(data.ids);
        const out = data.action === "start" ? await startAi(data.ids) : await cancelWaiting(data.ids);
        await recordStaffMoves(before, await staffName(mod.user.id));
        return NextResponse.json(out);
    } catch (e) {
        return handleApiError(e, "Could not update the Start list");
    }
}
