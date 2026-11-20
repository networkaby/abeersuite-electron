"use client";

/**
 * Browser copy of the product-prep agent's free cut-out
 * (`.claude/skills/product-prep/photo-edit.mjs cutout`): same model, same numbers,
 * so a photo staff clean up looks like one the agent cleaned up. Change both together.
 *
 *   product cut out → onto white, filling 85% of a 1500 px square, soft shadow.
 *   solid (boxes, cards, packs): fill any hole the model punched through a white panel.
 *
 * Model: onnx-community/ISNet-ONNX (Apache-2.0) through transformers.js, loaded from the
 * CDN only when first used — no npm package, so the counter installer does not grow by
 * the native ONNX runtime. First run downloads the model (176 MB fp32, then browser-cached; ~3 min on the shop line), then ~15 s a photo on WASM.
 */

const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2";
const MODEL = "onnx-community/ISNet-ONNX";
const SIZE = 1500;
const FILL = 0.85;

type Mask = { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number };

/**
 * The model runs in a Web Worker: on the page's own thread it froze the whole
 * product screen for minutes. The worker also does the per-pixel clean-up
 * (speck threshold + hole fill) and returns the cut-out RGBA, transferred, not copied.
 * Tries WebGPU first (much faster where the browser has it), falls back to WASM.
 */
const WORKER_SOURCE = `
let seg = null;
async function load() {
    const { pipeline } = await import(${JSON.stringify(TRANSFORMERS_URL)});
    if (navigator.gpu) {
        try { return await pipeline("background-removal", ${JSON.stringify(MODEL)}, { dtype: "fp32", device: "webgpu" }); }
        catch (e) { /* no usable GPU adapter - fall through to WASM */ }
    }
    return await pipeline("background-removal", ${JSON.stringify(MODEL)}, { dtype: "fp32" });
}
function fillHoles(px, w, h) {
    const clear = (i) => px[i * 4 + 3] < 250;
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h * 4 + 4 * (w + h));
    let top = 0;
    for (let x = 0; x < w; x++) { stack[top++] = x; stack[top++] = (h - 1) * w + x; }
    for (let y = 0; y < h; y++) { stack[top++] = y * w; stack[top++] = y * w + w - 1; }
    while (top) {
        const i = stack[--top];
        if (seen[i] || !clear(i)) continue;
        seen[i] = 1;
        const x = i % w;
        if (x > 0) stack[top++] = i - 1;
        if (x < w - 1) stack[top++] = i + 1;
        if (i >= w) stack[top++] = i - w;
        if (i < w * (h - 1)) stack[top++] = i + w;
    }
    for (let i = 0; i < w * h; i++) if (!seen[i] && clear(i)) px[i * 4 + 3] = 255;
}
self.onmessage = async ({ data: { id, src, solid } }) => {
    try {
        seg ??= load();
        const [cut] = await (await seg)(src);
        const px = new Uint8ClampedArray(cut.data);
        // Faint specks (mask under ~40%) would stop the trim at the edge and leave the product small.
        for (let i = 3; i < px.length; i += 4) if (px[i] < 100) px[i] = 0;
        // Boxes / cards / packs: every see-through pixel the edge cannot reach is inside the product.
        if (solid) fillHoles(px, cut.width, cut.height);
        self.postMessage({ id, data: px, width: cut.width, height: cut.height }, [px.buffer]);
    } catch (e) {
        seg = null;
        self.postMessage({ id, error: String(e && e.message || e) });
    }
};
`;

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (m: Mask) => void; reject: (e: Error) => void }>();

function segment(src: string, solid: boolean): Promise<Mask> {
    if (!worker) {
        const blobUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
        worker = new Worker(blobUrl, { type: "module" });
        worker.onmessage = ({ data }) => {
            const p = pending.get(data.id);
            if (!p) return;
            pending.delete(data.id);
            if (data.error) p.reject(new Error(data.error));
            else p.resolve({ data: data.data, width: data.width, height: data.height });
        };
        worker.onerror = (e) => {
            for (const p of pending.values()) p.reject(new Error(e.message || "Clean-up worker failed"));
            pending.clear();
            worker?.terminate();
            worker = null; // next click starts a fresh worker
        };
    }
    const id = ++nextId;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker!.postMessage({ id, src, solid });
    });
}

function canvas(w: number, h: number) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return [c, c.getContext("2d")!] as const;
}

/** Cut the product out of `src` (any CORS-readable image URL). Resolves to a 1500 px square JPEG. */
export async function cutoutPhoto(src: string, opts: { solid?: boolean } = {}): Promise<Blob> {
    // The worker needs an absolute URL (a blob: worker has no page base).
    const { data: px, width: W, height: H } = await segment(new URL(src, location.href).href, !!opts.solid);

    // Trim to the product.
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++)
            if (px[(y * W + x) * 4 + 3] > 0) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
            }
    if (x1 < 0) throw new Error("No product found in the photo");

    const [full, fctx] = canvas(W, H);
    fctx.putImageData(new ImageData(px, W, H), 0, 0);
    const tw = x1 - x0 + 1, th = y1 - y0 + 1;
    const side = Math.round(SIZE * FILL);
    const scale = Math.min(side / tw, side / th);
    const w = Math.round(tw * scale), h = Math.round(th * scale);
    const left = Math.round((SIZE - w) / 2), top = Math.round((SIZE - h) / 2);

    // Product layer.
    const [prod, pctx] = canvas(w, h);
    pctx.imageSmoothingQuality = "high";
    pctx.drawImage(full, x0, y0, tw, th, 0, 0, w, h);

    // Shadow: the silhouette in black at 22%, blurred, nudged down-right.
    const [sil, sctx] = canvas(w, h);
    sctx.drawImage(prod, 0, 0);
    sctx.globalCompositeOperation = "source-in";
    sctx.fillStyle = "#000";
    sctx.fillRect(0, 0, w, h);

    const [out, octx] = canvas(SIZE, SIZE);
    octx.fillStyle = "#fff";
    octx.fillRect(0, 0, SIZE, SIZE);
    octx.save();
    octx.globalAlpha = 0.22;
    octx.filter = "blur(18px)";
    octx.drawImage(sil, left + 10, top + 14);
    octx.restore();
    octx.drawImage(prod, left, top);

    const blob = await new Promise<Blob | null>((res) => out.toBlob(res, "image/jpeg", 0.92));
    if (!blob) throw new Error("Could not encode the photo");
    return blob;
}
