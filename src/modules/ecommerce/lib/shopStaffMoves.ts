import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { ShopStatus } from "@/generated/prisma/enums";
import { prisma, prismaWhereSaved } from "@/shared/lib/prisma/prismaClient";
import { readShopDraft, trimRuns, type ShopDraft } from "@/modules/ecommerce/lib/productAdmin";

// Staff stage moves join the AI run list (owner, 2026-11-22): one line per move,
// "staff <name> · date · From → To", in the same max-10 record. Called only from
// the routes staff use — the AI skills write their own runs. Automatic moves
// (the publish-rule re-check) are not recorded.

/** Who is acting, by name, for the run line. */
export async function staffName(userId: string | number): Promise<string> {
    const u = await prisma.user.findUnique({ where: { id: userId as never }, select: { name: true } });
    return u?.name ?? "Staff";
}

/** Each product's stage now — take it before a move, hand it to recordStaffMoves after. */
export async function stagesNow(ids: number[]): Promise<Map<number, ShopStatus>> {
    const rows = await prismaWhereSaved().invProduct.findMany({ where: { id: { in: ids } }, select: { id: true, shopStatus: true } });
    return new Map(rows.map((r) => [r.id, r.shopStatus]));
}

/** Add a staff run line to every product whose stage changed since `before`. */
export async function recordStaffMoves(before: Map<number, ShopStatus>, by: string): Promise<void> {
    if (!before.size) return;
    // Written back below, so it must be the row just saved, not the replica's old copy.
    const rows = await prismaWhereSaved().invProduct.findMany({
        where: { id: { in: [...before.keys()] } },
        select: { id: true, shopStatus: true, shopDraftJson: true },
    });
    const at = new Date().toISOString();
    const moved = rows.filter((r) => before.get(r.id) !== r.shopStatus);
    if (!moved.length) return;
    await prisma.$transaction(
        moved.map((r) => {
            const info = readShopDraft(r.shopDraftJson);
            const runs = trimRuns([...(info?.runs ?? []), { skill: "staff", part: by, at, from: before.get(r.id)!, to: r.shopStatus }]);
            const next: ShopDraft = { ...info, runs };
            return prisma.invProduct.update({
                where: { id: r.id },
                data: { shopDraftJson: next as unknown as Prisma.InputJsonValue },
            });
        }),
    );
}
