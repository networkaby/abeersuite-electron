import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requireModuleAccess, requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { invProductToAdmin, withShopDraft } from "@/modules/ecommerce/lib/productAdmin";
import { runDraftAction } from "@/modules/ecommerce/lib/shopDraft";
import { shopProductInclude as productInclude, shopProductPatchSchema, updateShopProduct } from "@/modules/ecommerce/lib/updateShopProduct";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;
    const { id } = await ctx.params;
    const pid = parseInt(id, 10);
    if (!Number.isFinite(pid)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    try {
        const bands = await loadBarcodeBands();
        const p = await prisma.invProduct.findUnique({ where: { id: pid }, include: productInclude });
        if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
        // The draft copy rides only here — the product's own page edits it.
        return NextResponse.json(withShopDraft(p, bands));
    } catch (e) {
        return handleApiError(e, "Failed to load product");
    }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requireModuleAccess("e-commerce");
    if (response) return response;
    const { id } = await ctx.params;
    const pid = parseInt(id, 10);
    if (!Number.isFinite(pid)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const { data, error } = await validateRequest(req, shopProductPatchSchema);
    if (error) return error;
    // Group / brand / collections are inventory masters (group drives inherited GST/HSN) —
    // a separate tick from editing the shop copy.
    if (data.groupId !== undefined || data.brandId !== undefined || data.collectionIds !== undefined) {
        const gate = await requirePermission(PERMISSIONS.ECOMMERCE_PRODUCT_MASTERS);
        if (gate.response) return gate.response;
    }
    // Save as draft / Save as ready / Discard — the draft copy (shopDraft.ts).
    const { draft } = data;
    const saved = draft
        ? await runDraftAction(pid, { ...data, draft })
        // Shared with the phone app's Photos screen — see updateShopProduct.ts.
        : await updateShopProduct(pid, data);
    return saved.response ?? NextResponse.json(saved.product);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requireModuleAccess("e-commerce");
    if (response) return response;
    const { id } = await ctx.params;
    const pid = parseInt(id, 10);
    if (!Number.isFinite(pid)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    try {
        const p = await prisma.invProduct.update({
            where: { id: pid },
            data: { isListedInShop: false, isActive: false },
            include: productInclude,
        });
        return NextResponse.json(invProductToAdmin(p));
    } catch (e) {
        return handleApiError(e, "Failed to deactivate product");
    }
}
