import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { ShopStatus } from "@/generated/prisma/enums";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { readShopDraft, type ShopDraft } from "@/modules/ecommerce/lib/productAdmin";

// Attention stage (owner, 2026-11-11): a Draft blocked on a manual check — name
// and photo clash, verify the unit in the warehouse — is parked here with the
// reason until the next working day. Off the shop. It leaves by Save as draft
// (back to work, reason kept) or Save as ready (reason cleared) — updateShopProduct.

/**
 * Park products in Attention. Staff park from Draft only (`from: ["DRAFT"]`);
 * Claude's review notes may park from any stage. A product already in Attention
 * gets the new reason. The stage it came from is remembered for Discard draft.
 * Returns how many were parked and the names of those skipped.
 */
export async function parkInAttention(
    ids: number[],
    reason: string,
    by: string,
    from: ShopStatus[] | "any",
): Promise<{ parked: number; skipped: string[] }> {
    const rows = await prisma.invProduct.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, shopStatus: true, shopDraftJson: true },
    });
    const ok = rows.filter((r) => r.shopStatus === "ATTENTION" || from === "any" || from.includes(r.shopStatus));
    const now = new Date();
    await prisma.$transaction(
        ok.map((r) => {
            const info = readShopDraft(r.shopDraftJson);
            const stageBefore = r.shopStatus === "DRAFT" || r.shopStatus === "ATTENTION" || r.shopStatus === "WAITING" ? info?.stageBefore : r.shopStatus;
            const next: ShopDraft = { ...info, ...(stageBefore && { stageBefore }) };
            return prisma.invProduct.update({
                where: { id: r.id },
                data: {
                    shopStatus: "ATTENTION",
                    isListedInShop: false,
                    shopDraftJson: next as unknown as Prisma.InputJsonValue,
                    shopDraftAt: now,
                    shopAttention: reason || null,
                    shopAttentionAt: now,
                    shopAttentionBy: by,
                },
            });
        }),
    );
    const okIds = new Set(ok.map((r) => r.id));
    return { parked: ok.length, skipped: rows.filter((r) => !okIds.has(r.id)).map((r) => r.name) };
}
