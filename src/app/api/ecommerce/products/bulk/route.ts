import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { applyPublished } from "@/modules/ecommerce/lib/applyPublished";

// Bulk Mark ready / Publish / Unpublish for the E-Commerce Products list (owner, 2026-11-07).
// - ready: Unpublished → READY (complete, waiting for a good time; not live).
// - publish: every id becomes PUBLISHED. Those meeting the publish rules go live;
//   the rest are Pending and go live by themselves once fixed. A live product
//   with no slug gets one (same as the single-product save).
// - unpublish: Published / Pending → READY, off the shop (the work is finished).
// A product in Draft is skipped and named — finish it (Save as ready) or Discard draft first.

const schema = z.object({
    ids: z.array(z.coerce.number().int().positive()).min(1).max(5000),
    action: z.enum(["publish", "unpublish", "ready"]),
});

export async function POST(req: Request) {
    const { response } = await requireModuleAccess("e-commerce");
    if (response) return response;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    let { ids } = data;
    const { action } = data;

    try {
        const inDraft = await prisma.invProduct.findMany({
            where: { id: { in: ids }, shopStatus: "DRAFT" },
            select: { id: true, name: true },
        });
        const skipped = { inDraft: inDraft.length, names: inDraft.slice(0, 5).map((p) => p.name) };
        const draftIds = new Set(inDraft.map((p) => p.id));
        ids = ids.filter((id) => !draftIds.has(id));

        if (action === "ready") {
            const res = await prisma.invProduct.updateMany({
                where: { id: { in: ids }, shopStatus: "UNPUBLISHED" },
                data: { shopStatus: "READY", isListedInShop: false },
            });
            return NextResponse.json({ published: 0, pending: 0, unpublished: 0, ready: res.count, skipped });
        }
        if (action === "unpublish") {
            const res = await prisma.invProduct.updateMany({
                where: { id: { in: ids }, shopStatus: "PUBLISHED" },
                data: { shopStatus: "READY", isListedInShop: false },
            });
            return NextResponse.json({ published: 0, pending: 0, unpublished: res.count, skipped });
        }

        const { published, pending } = await applyPublished(ids);
        return NextResponse.json({ published, pending, unpublished: 0, skipped });
    } catch (e) {
        return handleApiError(e, "Bulk update failed");
    }
}
