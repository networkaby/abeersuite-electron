import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { STOREFRONT_PRODUCTS_TAG } from "@/shared/lib/shop/storefrontProducts";
import { recheckVariantFamilies } from "@/modules/ecommerce/lib/applyPublished";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, parseIdParam } from "@/shared/lib/api";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import {
    addVariant,
    cleanVariantLabel,
    listVariantFamily,
    removeVariant,
    VariantError,
} from "@/modules/inventory/lib/variants";

// /api/inventory/products/[id]/variants — the product's variant family
// (modules/inventory/lib/variants.ts). Read by any signed-in staff; changes
// need Products edit, like any other product field.
//   GET                      → { label, members }
//   POST   { otherId }       → add a product to this one's family
//   PATCH  { label }         → this product's shop button text
//   DELETE ?memberId=<id>    → take that product out of the family

async function familyResponse(id: number) {
    const [self, members] = await Promise.all([
        prisma.invProduct.findUnique({ where: { id }, select: { variantLabel: true } }),
        listVariantFamily(id),
    ]);
    if (!self) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    return NextResponse.json({ label: self.variantLabel, members });
}

function variantError(e: unknown, fallback: string) {
    if (e instanceof VariantError) return NextResponse.json({ error: e.message }, { status: 400 });
    return handleApiError(e, fallback);
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
        // A new member brings its attributes — siblings may now be missing one.
        await recheckVariantFamilies([id, otherId]);
        // The shop's option buttons come from the cached catalogue — refresh it now.
        revalidateTag(STOREFRONT_PRODUCTS_TAG, { expire: 0 });
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
        const body = (await req.json().catch(() => ({}))) as { label?: unknown };
        await prisma.invProduct.update({ where: { id }, data: { variantLabel: cleanVariantLabel(body.label) } });
        revalidateTag(STOREFRONT_PRODUCTS_TAG, { expire: 0 });
        return await familyResponse(id);
    } catch (e) {
        return handleApiError(e, "Failed to save variant label");
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
        // The family (and the product that left it) no longer share attributes.
        // Every former member, as `id` itself may be the one that left.
        await recheckVariantFamilies(members.map((m) => m.id));
        revalidateTag(STOREFRONT_PRODUCTS_TAG, { expire: 0 });
        return await familyResponse(id);
    } catch (e) {
        return variantError(e, "Failed to remove variant");
    }
}
