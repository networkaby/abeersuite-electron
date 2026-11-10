import { prisma } from "@/shared/lib/prisma/prismaClient";

/**
 * Product variants (owner, 2026-11-10): "XYZ Black" and "XYZ Blue" stay two
 * independent products — own photos, title, price, stock, shop page — and share
 * one hidden number, InvProduct.variantFamilyId. Staff never see the number:
 * they press "Add variant" on any product and pick another, and both land in
 * one family (either way round; A adds B, B adds C → A, B, C).
 *
 * A new family takes MAX + 1 under an advisory lock, so two staff starting a
 * family at the same moment never share a number. A family left with one
 * product is cleared — a family of one shows nothing anywhere.
 */

/** Advisory-lock key for numbering families (any fixed number unique to this use). */
const FAMILY_LOCK = 742_001;

export type VariantMember = {
    id: number;
    sku: string;
    name: string;
    variantLabel: string | null;
    isActive: boolean;
    shopStatus: string;
};

const MEMBER_SELECT = { id: true, sku: true, name: true, variantLabel: true, isActive: true, shopStatus: true } as const;

/** Every product in this product's family, itself included, by id. [] = no family. */
export async function listVariantFamily(productId: number): Promise<VariantMember[]> {
    const p = await prisma.invProduct.findUnique({ where: { id: productId }, select: { variantFamilyId: true } });
    if (p?.variantFamilyId == null) return [];
    return prisma.invProduct.findMany({
        where: { variantFamilyId: p.variantFamilyId },
        select: MEMBER_SELECT,
        orderBy: { id: "asc" },
    });
}

/**
 * Put `otherId` in `productId`'s family. Neither in one → a new family for both;
 * one in a family → the other joins it; both in different families → the two
 * merge into the first product's family.
 */
export async function addVariant(productId: number, otherId: number): Promise<void> {
    if (productId === otherId) throw new VariantError("A product cannot be its own variant.");
    await prisma.$transaction(async (tx) => {
        const rows = await tx.invProduct.findMany({
            where: { id: { in: [productId, otherId] } },
            select: { id: true, variantFamilyId: true },
        });
        const a = rows.find((r) => r.id === productId);
        const b = rows.find((r) => r.id === otherId);
        if (!a || !b) throw new VariantError("Product not found.");

        let family = a.variantFamilyId ?? b.variantFamilyId;
        if (family == null) {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${FAMILY_LOCK})`;
            const max = await tx.invProduct.aggregate({ _max: { variantFamilyId: true } });
            family = (max._max.variantFamilyId ?? 0) + 1;
        }
        // Merge: every product of b's old family moves over, not just b.
        const moving = [a.variantFamilyId, b.variantFamilyId].filter((f): f is number => f != null && f !== family);
        await tx.invProduct.updateMany({
            where: { OR: [{ id: { in: [a.id, b.id] } }, ...(moving.length ? [{ variantFamilyId: { in: moving } }] : [])] },
            data: { variantFamilyId: family },
        });
    });
}

/** Take one product out of its family; a family left with one product is cleared. */
export async function removeVariant(productId: number): Promise<void> {
    await prisma.$transaction(async (tx) => {
        const p = await tx.invProduct.findUnique({ where: { id: productId }, select: { variantFamilyId: true } });
        if (p?.variantFamilyId == null) return;
        await tx.invProduct.update({ where: { id: productId }, data: { variantFamilyId: null } });
        const left = await tx.invProduct.count({ where: { variantFamilyId: p.variantFamilyId } });
        if (left <= 1) {
            await tx.invProduct.updateMany({ where: { variantFamilyId: p.variantFamilyId }, data: { variantFamilyId: null } });
        }
    });
}

/** The shop button text — trimmed, capped, "" = none. */
export function cleanVariantLabel(v: unknown): string | null {
    if (typeof v !== "string") return null;
    const t = v.trim().slice(0, 40);
    return t || null;
}

export class VariantError extends Error {}
