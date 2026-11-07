import "server-only";
import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError } from "@/shared/lib/api";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";
import { readShopDraft, withShopDraft, type ShopDraft, type ShopProductAdmin } from "@/modules/ecommerce/lib/productAdmin";
import { shopProductInclude, updateShopProduct, type ShopProductPatch } from "@/modules/ecommerce/lib/updateShopProduct";

/**
 * The draft copy of a product (owner, 2026-11-07): "we need draft, so we can
 * start working on it even if its published … it need to stay separate". Any
 * edit on the product page — and Claude's Verified copy — waits in
 * InvProduct.shopDraftJson; the shop keeps showing the last finished version.
 *
 * - save    — merge these fields into the draft; the product is untouched.
 * - ready   — "Save as ready": draft + these fields go on the product through
 *             the one write path (updateShopProduct) and the draft closes. A
 *             Published (or Pending) product stays Published — it was never
 *             taken off; any other stage becomes READY.
 * - discard — drop the draft; the product and its stage stay as they were.
 */

/** Keys that steer the save, never stored in the draft. */
const CONTROL_KEYS = ["draft", "shopStatus", "isListedInShop"] as const;

function fieldsOf(b: ShopProductPatch): ShopDraft["patch"] {
    const out: Record<string, unknown> = { ...b };
    for (const k of CONTROL_KEYS) delete out[k];
    return out as ShopDraft["patch"];
}

async function adminRow(pid: number): Promise<ShopProductAdmin> {
    const [p, bands] = await Promise.all([
        prisma.invProduct.findUniqueOrThrow({ where: { id: pid }, include: shopProductInclude }),
        loadBarcodeBands(),
    ]);
    return withShopDraft(p, bands);
}

/** Draft fields that change inventory masters — need the product-masters tick to apply. */
const MASTER_KEYS = ["groupId", "brandId", "collectionIds"] as const;

export async function runDraftAction(
    pid: number,
    b: ShopProductPatch & { draft: "save" | "ready" | "discard" },
    /** The product-masters check — asked only when the draft being applied changes a master. */
    mastersGate: () => Promise<NextResponse | null>,
): Promise<{ product: ShopProductAdmin; response?: undefined } | { response: NextResponse }> {
    try {
        const row = await prisma.invProduct.findUnique({ where: { id: pid }, select: { shopStatus: true, shopDraftJson: true } });
        if (!row) return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
        const open = readShopDraft(row.shopDraftJson);

        if (b.draft === "discard") {
            await prisma.invProduct.update({ where: { id: pid }, data: { shopDraftJson: Prisma.DbNull, shopDraftAt: null } });
            return { product: await adminRow(pid) };
        }

        const fields = fieldsOf(b);
        // The gallery the editing started from stays the base, so photos added
        // from the phone meanwhile survive the apply (mergeGallery.ts).
        const patch = { ...open?.patch, ...fields, ...(open?.patch.galleryBase && { galleryBase: open.patch.galleryBase }) };

        if (b.draft === "save") {
            const draft: ShopDraft = { ...open, patch };
            await prisma.invProduct.update({
                where: { id: pid },
                data: { shopDraftJson: draft as unknown as Prisma.InputJsonValue, shopDraftAt: new Date() },
            });
            return { product: await adminRow(pid) };
        }

        // ready — a brand / group / collection from the draft (Claude's, say) needs the same tick as picking it by hand.
        if (MASTER_KEYS.some((k) => patch[k] !== undefined)) {
            const denied = await mastersGate();
            if (denied) return { response: NextResponse.json({ error: "This draft changes brand / group / collections — needs the product-masters permission. Discard it, or ask someone who has it." }, { status: 403 }) };
        }
        const saved = await updateShopProduct(pid, {
            ...patch,
            shopStatus: row.shopStatus === "PUBLISHED" ? undefined : "READY",
            draft: "ready",
        });
        if (saved.response) return saved;
        return { product: await adminRow(pid) };
    } catch (e) {
        return { response: handleApiError(e, "Failed to save the draft") };
    }
}
