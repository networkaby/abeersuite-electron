import { prisma } from "@/shared/lib/prisma/prismaClient";
import { Prisma } from "@/generated/prisma/client";
import { variantAttrGaps } from "@/modules/ecommerce/lib/shopQualification";

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
    isActive: boolean;
    shopStatus: string;
    /** Live in the shop now (PUBLISHED and the publish rules met). */
    isListedInShop: boolean;
    groupId: number | null;
    /** Filled attributes, key → value (empty values are never stored). */
    attrs: Record<string, string>;
    /** Attributes a sibling has filled and this one has not ("Colour"). */
    gaps: string[];
};

const MEMBER_SELECT = {
    id: true, sku: true, name: true, isActive: true, shopStatus: true, isListedInShop: true,
    groupId: true, variantFamilyId: true, attrsJson: true,
} as const;

/** attrsJson → clean key → value, empty values dropped. */
export function readAttrs(raw: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
            if (typeof v === "string" && v.trim()) out[k] = v.trim();
        }
    }
    return out;
}

/** Every product in this product's family, itself included, by id. [] = no family. */
export async function listVariantFamily(productId: number): Promise<VariantMember[]> {
    const p = await prisma.invProduct.findUnique({ where: { id: productId }, select: { variantFamilyId: true } });
    if (p?.variantFamilyId == null) return [];
    const rows = await prisma.invProduct.findMany({
        where: { variantFamilyId: p.variantFamilyId },
        select: MEMBER_SELECT,
        orderBy: { id: "asc" },
    });
    const withAttrs = rows.map((r) => ({ ...r, attrs: readAttrs(r.attrsJson) }));
    const gaps = variantAttrGaps(withAttrs);
    return withAttrs.map(({ attrsJson: _a, variantFamilyId: _f, ...m }) => ({ ...m, gaps: gaps.get(m.id) ?? [] }));
}

/**
 * Set some attributes on one product, keeping the others. An empty value
 * removes the key — an empty attribute is never stored; the variant rule
 * shows it as missing instead.
 */
export async function setMemberAttrs(productId: number, patch: Record<string, string>): Promise<void> {
    const p = await prisma.invProduct.findUnique({ where: { id: productId }, select: { attrsJson: true } });
    if (!p) throw new VariantError("Product not found.");
    const next = readAttrs(p.attrsJson);
    for (const [k, v] of Object.entries(patch)) {
        const key = k.trim();
        if (!key) continue;
        const val = String(v ?? "").trim().slice(0, 120);
        if (val) next[key] = val;
        else delete next[key];
    }
    await prisma.invProduct.update({
        where: { id: productId },
        data: { attrsJson: Object.keys(next).length ? next : Prisma.DbNull },
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

export class VariantError extends Error {}
