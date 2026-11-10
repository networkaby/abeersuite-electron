import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { STOREFRONT_PRODUCTS_TAG } from "@/shared/lib/shop/storefrontProducts";
import { recheckVariantFamilies } from "@/modules/ecommerce/lib/applyPublished";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, parseIdParam } from "@/shared/lib/api";
import {
    addVariant,
    listVariantFamily,
    removeVariant,
    setMemberAttrs,
    VariantError,
} from "@/modules/inventory/lib/variants";

// /api/inventory/products/[id]/variants — the product's variant family
// (modules/inventory/lib/variants.ts). Read by any signed-in staff; changes
// need Products edit, like any other product field. The shop button text is
// automatic (lib/shop/variants.ts) — there is no label to set.
//   GET                                  → { members }
//   POST   { otherId }                   → add a product to this one's family
//   PATCH  { memberId, attrs: {k: v} }   → set a member's attributes ("" removes)
//   DELETE ?memberId=<id>                → take that product out of the family

async function familyResponse(id: number) {
    return NextResponse.json({ members: await listVariantFamily(id) });
}

function variantError(e: unknown, fallback: string) {
    if (e instanceof VariantError) return NextResponse.json({ error: e.message }, { status: 400 });
    return handleApiError(e, fallback);
}

/** A family change can move siblings into / out of Pending, and the shop buttons read the cached catalogue. */
async function afterChange(ids: number[]) {
    await recheckVariantFamilies(ids);
    revalidateTag(STOREFRONT_PRODUCTS_TAG, { expire: 0 });
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { id, error } = await parseIdParam(params);
        if (error) return error;
        return await familyResponse(id);
    } catch (e) {
        return handleApiError(e, "Failed to load variants");
    }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.PRODUCTS_EDIT);
    if (response) return response;
    try {
        const { id, error } = await parseIdParam(params);
        if (error) return error;
        const body = (await req.json().catch(() => ({}))) as { otherId?: unknown };
        const otherId = Number(body.otherId);
        if (!Number.isInteger(otherId) || otherId <= 0) {
            return NextResponse.json({ error: "Pick a product to add." }, { status: 400 });
        }
        await addVariant(id, otherId);
        await afterChange([id, otherId]);
        return await familyResponse(id);
    } catch (e) {
        return variantError(e, "Failed to add variant");
    }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.PRODUCTS_EDIT);
    if (response) return response;
    try {
        const { id, error } = await parseIdParam(params);
        if (error) return error;
        const body = (await req.json().catch(() => ({}))) as { memberId?: unknown; attrs?: unknown };
        const memberId = Number(body.memberId ?? id);
        const attrs = body.attrs;
        if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) {
            return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
        }
        const members = await listVariantFamily(id);
        if (memberId !== id && !members.some((m) => m.id === memberId)) {
            return NextResponse.json({ error: "That product is not in this family." }, { status: 400 });
        }
        await setMemberAttrs(memberId, attrs as Record<string, string>);
        await afterChange([memberId]);
        return await familyResponse(id);
    } catch (e) {
        return variantError(e, "Failed to save attribute");
    }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.PRODUCTS_EDIT);
    if (response) return response;
    try {
        const { id, error } = await parseIdParam(params);
        if (error) return error;
        const memberId = Number(new URL(req.url).searchParams.get("memberId") ?? id);
        const members = await listVariantFamily(id);
        if (!members.some((m) => m.id === memberId)) {
            return NextResponse.json({ error: "That product is not in this family." }, { status: 400 });
        }
        await removeVariant(memberId);
        // Every former member, as `id` itself may be the one that left.
        await afterChange(members.map((m) => m.id));
        return await familyResponse(id);
    } catch (e) {
        return variantError(e, "Failed to remove variant");
    }
}
