import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { applyPublished } from "@/modules/ecommerce/lib/applyPublished";
import { recordStaffMoves, staffName, stagesNow } from "@/modules/ecommerce/lib/shopStaffMoves";

// Bulk Mark ready / Publish / Unpublish for the E-Commerce Products list (owner, 2026-11-07).
// - ready: Unpublished → READY (complete, waiting for a good time; not live).
// - publish: every id becomes PUBLISHED. Those meeting the publish rules go live;
//   the rest are Pending and go live by themselves once fixed. A live product
//   with no slug gets one (same as the single-product save).
// - unpublish: Published / Pending → READY, off the shop (the work is finished).
// A product in Draft is skipped and named — finish it (Save as ready) or Discard draft first.
// Attention (a parked Draft) and Waiting (queued for the AI) are skipped the same way.

const schema = z.object({
    ids: z.array(z.coerce.number().int().positive()).min(1).max(5000),
    action: z.enum(["publish", "unpublish", "ready"]),
});

export async function POST(req: Request) {
    const mod = await requireModuleAccess("e-commerce");
    if (mod.response) return mod.response;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    const { ids, action } = data;
    try {
        const before = await stagesNow(ids);
        const res = await run(ids, action);
        // Each stage move joins the product's run list (owner, 2026-11-22).
        await recordStaffMoves(before, await staffName(mod.user.id));
        return NextResponse.json(res);
    } catch (e) {
        return handleApiError(e, "Bulk update failed");
    }
}

async function run(ids: number[], action: z.infer<typeof schema>["action"]) {
    const held = await prisma.invProduct.findMany({
        where: { id: { in: ids }, shopStatus: { in: ["DRAFT", "ATTENTION", "WAITING"] } },
        select: { id: true, name: true, shopStatus: true },
    });
    const inDraft = held.filter((p) => p.shopStatus === "DRAFT");
    const inAttention = held.filter((p) => p.shopStatus === "ATTENTION");
    const inWaiting = held.filter((p) => p.shopStatus === "WAITING");
    const skipped = {
        inDraft: inDraft.length,
        names: inDraft.slice(0, 5).map((p) => p.name),
        inAttention: inAttention.length,
        attentionNames: inAttention.slice(0, 5).map((p) => p.name),
        inWaiting: inWaiting.length,
        waitingNames: inWaiting.slice(0, 5).map((p) => p.name),
    };
    const heldIds = new Set(held.map((p) => p.id));
    ids = ids.filter((id) => !heldIds.has(id));
    if (action === "ready") {
        const res = await prisma.invProduct.updateMany({
            where: { id: { in: ids }, shopStatus: "UNPUBLISHED" },
            data: { shopStatus: "READY", isListedInShop: false },
        });
        return { published: 0, pending: 0, unpublished: 0, ready: res.count, skipped };
    }
    if (action === "unpublish") {
        const res = await prisma.invProduct.updateMany({
            where: { id: { in: ids }, shopStatus: "PUBLISHED" },
            data: { shopStatus: "READY", isListedInShop: false },
        });
        return { published: 0, pending: 0, unpublished: res.count, skipped };
    }

    const { published, pending } = await applyPublished(ids);
    return { published, pending, unpublished: 0, skipped };
}
