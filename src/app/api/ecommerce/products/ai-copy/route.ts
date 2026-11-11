import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { AiDataCheckError, aiErrorMessage, generateProductCopy, isAiConfigured, type ProductCopy } from "@/modules/ecommerce/lib/aiProductCopy";
import { parkInAttention } from "@/modules/ecommerce/lib/shopAttention";
import { generatePhotoAdvice, generateVerifiedCopy } from "@/modules/ecommerce/lib/aiVerifiedCopy";
import { type AiCopyFlow } from "@/shared/lib/constants/ai";
import { loadAiSetup } from "@/shared/lib/ai/aiKeys";
import { productGalleryUrls } from "@/shared/lib/shop/productPublic";
import { photosForAi } from "@/shared/lib/shop/photoMark";
import { pickableMasters } from "@/modules/ecommerce/lib/agentProductCopy";

// AI product copy (keys and order from Settings → AI Setup). Nothing is written here — the
// caller shows the draft and saves through the normal product PATCH, so staff
// always review before a customer sees it.
//
// The bulk screen lists its backlog from GET /api/ecommerce/products (shared
// filters and cache with Products), so this route only drafts.
// POST { productId, name?, imageUrls?, flow: direct|verified } → one draft (photos marked "Skip for AI" are not sent).
// photosOnly: Verified's Photo AI alone — reuses the run's saved search (R2), returns photo advice only.
// Verified answers 422 when the photo check finds our own data disagreeing with itself.

async function guard() {
    // Anyone who can open E-Commerce may use it — owner's call, no tick of its own.
    const { response } = await requireModuleAccess("e-commerce");
    if (response) return { response };
    if (!(await isAiConfigured())) {
        return { response: NextResponse.json({ error: "AI is not set up here — add a key on Settings → AI Setup." }, { status: 503 }) };
    }
    return { response: null };
}

const postSchema = z.object({
    productId: z.number().int().positive(),
    // Unsaved edits from the form win over the saved row.
    name: z.string().trim().min(1).max(500).optional(),
    // The form's current (possibly unsaved) gallery, skip marks included.
    imageUrls: z.array(z.string().url()).max(30).optional(),
    // Direct AI or Verified (AI_COPY_FLOWS). An old tab still sends `search` — ignored.
    flow: z.enum(["direct", "verified"] satisfies AiCopyFlow[]).optional(), // left out → the shop-wide default
    // Bulk screen: may wait a few seconds for a free key rather than use the paid one.
    bulk: z.boolean().default(false),
    // "Use Premium API" — off (default, also for an old tab) never touches the paid key.
    premium: z.boolean().default(false),
    // Product page's Photo AI switch; left out (an old tab, bulk) → AI Setup's switch.
    photoAi: z.boolean().optional(),
    // "Photos only" — step 5 of Verified on its own; flow and photoAi are ignored.
    photosOnly: z.boolean().default(false),
});

// GET → the option the product page opens on and the Photo AI switch (the admin's picks on AI Setup; cached server-side).
export async function GET() {
    const { response } = await requireModuleAccess("e-commerce");
    if (response) return response;
    try {
        const { copyFlow, photoCheck } = await loadAiSetup();
        return NextResponse.json({ defaultFlow: copyFlow, photoCheck });
    } catch (e) {
        return handleApiError(e, "Failed to load the default option");
    }
}

export async function POST(req: Request) {
    const { response } = await guard();
    if (response) return response;
    const { data, error } = await validateRequest(req, postSchema);
    if (error) return error;
    try {
        const p = await prisma.invProduct.findUnique({
            where: { id: data.productId },
            select: {
                name: true, imageUrl: true, galleryJson: true, shopCategory: true, modelNo: true, specsJson: true,
                codes: { where: { kind: { in: ["EAN", "UPC"] } }, select: { value: true } },
                brand: { select: { name: true } }, category: { select: { name: true } },
                warrantyTerm: { select: { durationDays: true } },
            },
        });
        if (!p) return NextResponse.json({ error: "Product not found" }, { status: 404 });
        // Bulk and Photos only skip the extras — no one is there to review them.
        const inApp = !data.photosOnly && !data.bulk;
        const masters = inApp ? await pickableMasters() : null;
        const base = {
            name: data.name ?? p.name,
            brand: p.brand?.name,
            category: p.shopCategory ?? p.category?.name,
            imageUrls: photosForAi(data.imageUrls ?? productGalleryUrls(p.galleryJson, p.imageUrl)),
            bulk: data.bulk,
            premium: data.premium,
            // Offers are set by staff, never by the AI. Cached 5 min (pickableMasters).
            collections: inApp ? masters!.collections.filter((c) => !/^offers\b/i.test(c.path)) : [],
            // Brand list → brand pick, staff notes, shipping and label codes (in-app runs only).
            brands: inApp ? masters!.brands : undefined,
        };
        const flow = data.photosOnly ? "verified" : data.flow ?? (await loadAiSetup()).copyFlow;
        const run = data.photosOnly ? generatePhotoAdvice : generateVerifiedCopy;
        const copy = flow === "verified"
            ? await run({
                ...base,
                productId: data.productId,
                modelNo: p.modelNo,
                // Our own shop barcodes (BARCODE) are not the maker's — only EAN / UPC are matched.
                codes: p.codes.map((c) => c.value),
                typedSpecs: specsOf(p.specsJson),
                shopWarrantyDays: p.warrantyTerm?.durationDays,
                photoAi: data.photoAi,
            })
            : await generateProductCopy(base);
        if (inApp && "notes" in copy) await applyInAppExtras(data.productId, copy as ProductCopy);
        return NextResponse.json(copy);
    } catch (e) {
        // A clash parks the product in Attention, the same as Claude's (owner,
        // 2026-11-11: both AIs give the same result) — any stage, off the shop
        // until someone checks the real unit. Never blocks the answer.
        if (e instanceof AiDataCheckError) {
            const parked = await parkInAttention([data.productId], e.flags.join("\n"), "In-app AI", "any")
                .then((r) => r.parked > 0)
                .catch(() => false);
            return NextResponse.json(
                { error: parked ? `Parked in Attention — ${e.message}` : e.message, flags: e.flags, parked },
                { status: 422 },
            );
        }
        const reason = aiErrorMessage(e);
        if (reason) return NextResponse.json({ error: reason }, { status: 503 });
        return handleApiError(e, "AI could not write this product");
    }
}

/**
 * The in-app AI's server-side writes (owner, 2026-11-11 — staff still review
 * before Save as ready): Model No. / barcode read off the label go straight
 * onto the product when ours are empty — the form has no box for them. A
 * barcode already on another product, or a known brand missing from the
 * master, parks the product in Attention instead. Mutates `copy` (notes, parked).
 */
async function applyInAppExtras(productId: number, copy: ProductCopy) {
    const notes = (copy.notes ??= []);
    const attention = [...(copy.attention ?? [])];
    const pick = copy.codePick;
    if (pick?.modelNo) {
        const n = await prisma.invProduct.updateMany({ where: { id: productId, OR: [{ modelNo: null }, { modelNo: "" }] }, data: { modelNo: pick.modelNo } });
        if (n.count) notes.push(`Model No. set to "${pick.modelNo}" — printed on the box.`);
    }
    if (pick?.barcode) {
        const owner = await prisma.invProductCode.findUnique({ where: { value: pick.barcode }, select: { productId: true, product: { select: { sku: true } } } });
        if (owner && owner.productId !== productId) {
            attention.push(`Barcode ${pick.barcode} printed on the box is already on SKU ${owner.product.sku} — same product twice?`);
        } else if (!owner) {
            await prisma.invProductCode.create({ data: { productId, kind: pick.barcode.length === 12 ? "UPC" : "EAN", value: pick.barcode } });
            notes.push(`Barcode ${pick.barcode} added — printed on the box.`);
        }
    }
    if (attention.length) {
        copy.parked = await parkInAttention([productId], attention.join("\n"), "In-app AI", "any")
            .then((r) => r.parked > 0)
            .catch(() => false);
        notes.unshift(...attention.map((a) => `ATTENTION — ${a}`));
    }
}

/** InvProduct.specsJson as label → text, or null. */
function specsOf(raw: unknown): Record<string, string> | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v)]));
}
