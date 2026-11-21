import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { parkInAttention } from "@/modules/ecommerce/lib/shopAttention";
import { recordStaffMoves, staffName, stagesNow } from "@/modules/ecommerce/lib/shopStaffMoves";
import { saveStaffNote } from "@/modules/ecommerce/lib/agentProductPrep";
import { readShopDraft } from "@/modules/ecommerce/lib/productAdmin";

// POST /api/ecommerce/products/attention { ids, reason } — park products in
// the Attention stage (owner, 2026-11-11): work blocked until something is
// checked by hand. Draft, and since 2026-11-22 Published / Pending too (a big
// mistake found on a live product — it leaves the shop). The rest are named back.
// The reason is optional and joins the product's manual note; the move joins
// the run list as a staff line (owner, 2026-11-22).
// Leaving Attention is Save as draft / Save as ready on the product (PATCH).

const schema = z.object({
    ids: z.array(z.coerce.number().int().positive()).min(1).max(5000),
    reason: z.string().trim().max(1000).default(""),
});

export async function POST(req: Request) {
    const mod = await requireModuleAccess("e-commerce");
    if (mod.response) return mod.response;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    try {
        const by = await staffName(mod.user.id);
        const before = await stagesNow(data.ids);
        const out = await parkInAttention(data.ids, data.reason, by, ["DRAFT", "PUBLISHED"]);
        const after = await stagesNow(data.ids);
        const parked = [...after].filter(([id, s]) => s === "ATTENTION" && before.get(id) !== "ATTENTION").map(([id]) => id);
        if (data.reason) {
            const notes = await prisma.invProduct.findMany({ where: { id: { in: parked } }, select: { id: true, shopDraftJson: true } });
            for (const n of notes) {
                const old = readShopDraft(n.shopDraftJson)?.staffNote?.text?.trim();
                await saveStaffNote(n.id, old ? `${old}
${data.reason}` : data.reason, by);
            }
        }
        await recordStaffMoves(before, by);
        return NextResponse.json(out);
    } catch (e) {
        return handleApiError(e, "Could not park in Attention");
    }
}
