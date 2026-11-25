import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { ShopStatus } from "@/generated/prisma/enums";
import { prisma, prismaWhereSaved } from "@/shared/lib/prisma/prismaClient";
import { attentionAgain, attentionText, draftOf, raiseProblems, type PrepProblem, type RaisedProblem, type ShopDraft } from "@/modules/ecommerce/lib/productAdmin";

// Attention stage (owner, 2026-11-11): a Draft blocked on a manual check — name
// and photo clash, verify the unit in the warehouse — is parked here with the
// reason until the next working day. Off the shop. It leaves by Save as draft
// (back to work, reason kept) or Save as ready (reason cleared) — updateShopProduct.

/**
 * Park products in Attention. Staff park from Draft only (`from: ["DRAFT"]`);
 * Claude may park from any stage. `raise.problems` join the product's one problem list;
 * the Attention reason is a summary made from that list (owner, 2026-11-25). The stage it came from is remembered for Discard draft.
 * Returns how many were parked and the names of those skipped.
 */
export async function parkInAttention(
    ids: number[],
    raise: { problems: RaisedProblem[]; replaces?: (p: PrepProblem) => boolean; more?: string[] },
    by: string,
    from: ShopStatus[] | "any",
): Promise<{ parked: number; skipped: string[] }> {
    const rows = await prismaWhereSaved().invProduct.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, shopStatus: true, shopDraftJson: true, shopAttention: true, shopAttentionAt: true },
    });
    const ok = rows.filter((r) => r.shopStatus === "ATTENTION" || from === "any" || from.includes(r.shopStatus));
    const now = new Date();
    await prisma.$transaction(
        ok.map((r) => {
            const info = draftOf(r);
            const stageBefore = r.shopStatus === "DRAFT" || r.shopStatus === "ATTENTION" || r.shopStatus === "WAITING" ? info?.stageBefore : r.shopStatus;
            const next: ShopDraft = raiseProblems({ ...info, ...(stageBefore && { stageBefore }) }, raise.problems, { replaces: raise.replaces, by });
            return prisma.invProduct.update({
                where: { id: r.id },
                data: {
                    shopStatus: "ATTENTION",
                    isListedInShop: false,
                    shopDraftJson: next as unknown as Prisma.InputJsonValue,
                    shopDraftAt: now,
                    shopAttention: (raise.more ? attentionText(next, raise.more) : r.shopStatus === "ATTENTION" && r.shopAttention ? attentionAgain(r.shopAttention, info, next) : attentionText(next, [])) || null,
                    shopAttentionAt: now,
                    shopAttentionBy: by,
                },
            });
        }),
    );
    const okIds = new Set(ok.map((r) => r.id));
    return { parked: ok.length, skipped: rows.filter((r) => !okIds.has(r.id)).map((r) => r.name) };
}
