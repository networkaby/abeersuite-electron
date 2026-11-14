import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAnyPermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";
import { shopProductPatchSchema, updateShopProduct } from "@/modules/ecommerce/lib/updateShopProduct";

// POST /api/ecommerce/products/old-drafts — one-time move to "Draft is a stage"
// (owner, 2026-11-10: "only one copy no parallel"). Until then an open draft was
// a separate copy in shopDraftJson.patch. Each one still open is put on its
// product and the product moves to Draft (Discard draft returns it to its old
// stage, edits kept). Safe to run again: a product already in Draft is left out.
// Run once on each database after the deploy; delete this route afterwards.

export async function POST() {
    const { response } = await requireAnyPermission(PERMISSIONS.PRODUCTS_EDIT, PERMISSIONS.ECOMMERCE_PRODUCT_DEEP_EDIT);
    if (response) return response;
    try {
        const rows = await prisma.invProduct.findMany({
            where: { shopDraftAt: { not: null }, shopStatus: { not: "DRAFT" } },
            select: { id: true, name: true, shopDraftJson: true },
        });
        const applied: number[] = [];
        const failed: { id: number; name: string; error: string }[] = [];
        for (const r of rows) {
            const raw = r.shopDraftJson as { patch?: unknown } | null;
            const parsed = shopProductPatchSchema.safeParse(raw?.patch ?? {});
            if (!parsed.success) {
                failed.push({ id: r.id, name: r.name, error: parsed.error.issues.slice(0, 2).map((i) => `${i.path.join(".")} ${i.message}`).join("; ") });
                continue;
            }
            const saved = await updateShopProduct(r.id, { ...parsed.data, shopStatus: undefined, isListedInShop: undefined, draft: "save" });
            if (saved.response) {
                const err = (await saved.response.json().catch(() => null)) as { error?: string } | null;
                failed.push({ id: r.id, name: r.name, error: err?.error ?? "save failed" });
            } else applied.push(r.id);
        }
        return NextResponse.json({ applied, failed });
    } catch (e) {
        return handleApiError(e, "Could not move old drafts");
    }
}
