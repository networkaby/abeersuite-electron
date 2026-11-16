import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { ShopStatus } from "@/generated/prisma/enums";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { readShopDraft, type ShopDraft } from "@/modules/ecommerce/lib/productAdmin";

// Waiting stage (owner, 2026-11-17): staff shortlist products for the AI run
// (the product-prep skill), or send an Attention product back once fixed — Start
// AI clears the Attention flag. Off the shop. The AI run moves it on to Draft or
// Attention; Remove puts it back to the stage it came from.

/** Stages a product can be sent to the AI from — any but Waiting itself. */
const IN_WORK: ShopStatus[] = ["DRAFT", "ATTENTION", "WAITING"];

/** Start AI: move to Waiting, remember the stage it came from, clear the Attention flag. */
export async function startAi(ids: number[]): Promise<{ queued: number; published: string[] }> {
    const rows = await prisma.invProduct.findMany({
        where: { id: { in: ids }, shopStatus: { not: "WAITING" } },
        select: { id: true, name: true, shopStatus: true, shopDraftJson: true },
    });
    await prisma.$transaction(
        rows.map((r) => {
            const info = readShopDraft(r.shopDraftJson);
            const stageBefore = IN_WORK.includes(r.shopStatus) ? info?.stageBefore : r.shopStatus;
            const next: ShopDraft = { ...info, ...(stageBefore && { stageBefore }) };
            return prisma.invProduct.update({
                where: { id: r.id },
                data: {
                    shopStatus: "WAITING",
                    isListedInShop: false,
                    shopDraftJson: next as unknown as Prisma.InputJsonValue,
                    shopDraftAt: new Date(),
                    shopAttention: null,
                    shopAttentionAt: null,
                    shopAttentionBy: null,
                },
            });
        }),
    );
    // Published ones left the shop — named back so staff know.
    return { queued: rows.length, published: rows.filter((r) => r.shopStatus === "PUBLISHED").map((r) => r.name) };
}

/** Remove from Waiting: back to the stage it came from (Unpublished when unknown). */
export async function cancelWaiting(ids: number[]): Promise<{ removed: number }> {
    const rows = await prisma.invProduct.findMany({
        where: { id: { in: ids }, shopStatus: "WAITING" },
        select: { id: true, shopDraftJson: true },
    });
    await prisma.$transaction(
        rows.map((r) => {
            const info = readShopDraft(r.shopDraftJson);
            const back = info?.stageBefore ?? "UNPUBLISHED";
            const { stageBefore: _drop, ...rest } = info ?? {};
            void _drop;
            const keep = Object.keys(rest).length ? (rest as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
            return prisma.invProduct.update({
                where: { id: r.id },
                data: { shopStatus: back, shopDraftJson: keep, shopDraftAt: null },
            });
        }),
    );
    return { removed: rows.length };
}
