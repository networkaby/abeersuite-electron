import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireIncomingKey } from "@/modules/incoming/lib/incomingApi";
import { productGalleryUrls } from "@/shared/lib/shop/productPublic";
import { photosForAi } from "@/shared/lib/shop/photoMark";
import { handleApiError } from "@/shared/lib/api";
import { AgentCopyError } from "@/modules/ecommerce/lib/agentProductCopy";
import { PHOTO_EDITS, replacePhotoWithEdit, type PhotoEdit } from "@/modules/ecommerce/lib/agentProductPrep";

// GET /api/agent/products/[id]/photos/[n] — photo n (1-based, the order of
// `photos` on GET /api/agent/products/[id]) through our own server. Our photo AI
// reads the gallery from here; Claude's workspace may block the photo host, so it
// gets the same bytes the same way. Only this product's own gallery is served —
// never any other URL.

const MAX_BYTES = 10 * 1024 * 1024;

// POST /api/agent/products/[id]/photos/[n] — multipart { file, edit: "cutout" | "blank" }:
// Claude's edited copy of photo n takes its place in the gallery; the original
// stays in our Cloudinary. { edit: "restore", restore: <original link> } (no file)
// puts the original back after a bad edit. Answer: { photo, url, original, edit }.
export async function POST(req: Request, ctx: { params: Promise<{ id: string; n: string }> }) {
    if (!(await requireIncomingKey(req, "PRODUCT_COPY"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const { id: rawId, n: rawN } = await ctx.params;
    const id = Number(rawId);
    const n = Number(rawN);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(n) || n <= 0) return NextResponse.json({ error: "Bad product id or photo number" }, { status: 400 });
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    const edit = form?.get("edit");
    const restore = form?.get("restore");
    if (typeof edit !== "string" || !(edit in PHOTO_EDITS || edit === "restore")) return NextResponse.json({ error: `edit must be one of: ${[...Object.keys(PHOTO_EDITS), "restore"].join(", ")}` }, { status: 400 });
    if (edit !== "restore" && !(file instanceof Blob)) return NextResponse.json({ error: "Send the edited photo as multipart field `file`" }, { status: 400 });
    try {
        return NextResponse.json(await replacePhotoWithEdit(id, n, file instanceof Blob ? file : null, edit as PhotoEdit | "restore", typeof restore === "string" ? restore : undefined));
    } catch (e) {
        if (e instanceof AgentCopyError) return NextResponse.json({ error: e.message }, { status: 422 });
        return handleApiError(e, "Failed to save the edited photo");
    }
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string; n: string }> }) {
    if (!(await requireIncomingKey(req, "PRODUCT_COPY"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const { id: rawId, n: rawN } = await ctx.params;
    const id = Number(rawId);
    const n = Number(rawN);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(n) || n <= 0) return NextResponse.json({ error: "Bad product id or photo number" }, { status: 400 });
    const p = await prisma.invProduct.findUnique({ where: { id }, select: { imageUrl: true, galleryJson: true } });
    if (!p) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    const url = photosForAi(productGalleryUrls(p.galleryJson, p.imageUrl))[n - 1];
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
