import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireIncomingKey } from "@/modules/incoming/lib/incomingApi";
import { editingGallery } from "@/modules/ecommerce/lib/productAdmin";
import { photosForAi } from "@/shared/lib/shop/photoMark";

// GET /api/agent/products/[id]/photos/[n] — photo n (1-based, the order of
// `photos` on GET /api/agent/products/[id]) through our own server. Our photo AI
// reads the gallery from here; Claude's workspace may block the photo host, so it
// gets the same bytes the same way. With a draft open, n counts the draft's
// photos (editingGallery), what staff see. Only this product's own gallery is served —
// never any other URL.

const MAX_BYTES = 10 * 1024 * 1024;

export async function GET(req: Request, ctx: { params: Promise<{ id: string; n: string }> }) {
    if (!(await requireIncomingKey(req, "PRODUCT_COPY"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const { id: rawId, n: rawN } = await ctx.params;
    const id = Number(rawId);
    const n = Number(rawN);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(n) || n <= 0) return NextResponse.json({ error: "Bad product id or photo number" }, { status: 400 });
    const p = await prisma.invProduct.findUnique({ where: { id }, select: { imageUrl: true, galleryJson: true, shopDraftJson: true } });
    if (!p) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    const url = photosForAi(editingGallery(p.galleryJson, p.imageUrl, p.shopDraftJson))[n - 1];
    if (!url) return NextResponse.json({ error: `No photo ${n} — the product has fewer photos` }, { status: 404 });
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        const type = res.headers.get("content-type") ?? "";
        if (!res.ok || !type.startsWith("image/")) return NextResponse.json({ error: `Photo host answered ${res.status}` }, { status: 502 });
        const body = await res.arrayBuffer();
        if (body.byteLength > MAX_BYTES) return NextResponse.json({ error: "Photo too large" }, { status: 502 });
        return new NextResponse(body, { headers: { "content-type": type, "cache-control": "private, max-age=600", "x-photo-url": url } });
    } catch {
        return NextResponse.json({ error: "Could not fetch the photo" }, { status: 502 });
    }
}
