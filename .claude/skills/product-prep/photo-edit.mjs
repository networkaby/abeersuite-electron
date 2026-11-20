// Product photo edits for product-prep / product-recheck — free, runs where Claude runs.
//
//   node photo-edit.mjs cutout <in> <out> [--solid]   background → white, 85% fill, 1500 square, soft shadow
//                                                      --solid: boxes / packs — fill any hole the model cut inside
//   node photo-edit.mjs blank  <in> <out> x,y,w,h     fill a box with the label colour around it
//                                                      (x,y,w,h = fractions 0–1 of width / height)
//   node photo-edit.mjs crop   <in> <out> [x,y,w,h]   cut away empty space, KEEP the background:
//                                                      no box → finds the product (same model) and crops
//                                                      to it + a 6% margin; a box → crops to that box
//   node photo-edit.mjs straighten <in> <out> <deg>   turn a tilted photo by deg (−15…15, + = clockwise)
//                                                      and crop the empty corners the turn leaves
//
// Setup once per session (deps stay out of the app's package.json):
//   mkdir -p "$PE" && cp .claude/skills/product-prep/photo-edit.mjs "$PE/" && cd "$PE" \
//     && npm init -y >/dev/null && npm i @huggingface/transformers@3.7.2 sharp@0.34.3
//
// Model: onnx-community/ISNet-ONNX (Apache-2.0), ~6 s a photo on CPU. Tested 2026-11-19:
// BiRefNet-lite looked the same at 10x the time; MODNet (people only) and RMBG
// (non-commercial) are not to be used.
import sharp from "sharp";

const SIZE = 1500;
const FILL = 0.85;

const args = process.argv.slice(2);
const solid = args.includes("--solid");
const [mode, input, output, box] = args.filter((a) => a !== "--solid");
if (!mode || !input || !output) {
    console.error("usage: photo-edit.mjs cutout|blank|crop|straighten <in> <out> [x,y,w,h | deg]");
    process.exit(2);
}

/**
 * --solid (boxes, cards, packs — anything with no real see-through gap): the model
 * can take a white panel printed on the box for background and punch a hole through
 * it (SKU 213343, 2026-11-20). Every see-through pixel the photo's edge cannot reach
 * through other see-through pixels is inside the product — make it solid again.
 * Never for a product with a real gap (cable coil, ring, frame).
 */
function fillHoles(px, w, h) {
    const clear = (i) => px[i * 4 + 3] < 250;
    const seen = new Uint8Array(w * h);
    const stack = [];
    for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
    for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
    while (stack.length) {
        const i = stack.pop();
        if (seen[i] || !clear(i)) continue;
        seen[i] = 1;
        const x = i % w;
        if (x > 0) stack.push(i - 1);
        if (x < w - 1) stack.push(i + 1);
        if (i >= w) stack.push(i - w);
        if (i < w * (h - 1)) stack.push(i + w);
    }
    for (let i = 0; i < w * h; i++) if (!seen[i] && clear(i)) px[i * 4 + 3] = 255;
}

/** The product on a see-through background (ISNet), faint specks dropped. */
async function segment(src = input) {
    const { pipeline } = await import("@huggingface/transformers");
    const seg = await pipeline("background-removal", "onnx-community/ISNet-ONNX", { dtype: "fp32" });
    const [cut] = await seg(src);
    // Faint specks (mask under ~40%) would stop trim at the photo's edge and leave the product small.
    for (let i = 3; i < cut.data.length; i += 4) if (cut.data[i] < 100) cut.data[i] = 0;
    return cut;
}

/** x,y,w,h fractions (0–1) → whole pixels inside a W×H photo. */
function parseBox(W, H) {
    const f = (box ?? "").split(",").map(Number);
    if (f.length !== 4 || f.some((v) => !(v >= 0 && v <= 1)) || f[2] <= 0 || f[3] <= 0) throw new Error("box must be x,y,w,h as fractions 0–1");
    const x = Math.round(f[0] * W), y = Math.round(f[1] * H);
    return { x, y, w: Math.max(1, Math.min(W - x, Math.round(f[2] * W))), h: Math.max(1, Math.min(H - y, Math.round(f[3] * H))) };
}

async function cutout() {
    const cut = await segment();
    if (solid) fillHoles(cut.data, cut.width, cut.height);
    const png = await sharp(Buffer.from(cut.data), { raw: { width: cut.width, height: cut.height, channels: 4 } }).png().toBuffer();
    const trimmed = await sharp(png).trim({ threshold: 1 }).toBuffer();
    const side = Math.round(SIZE * FILL);
    const scaled = await sharp(trimmed).resize(side, side, { fit: "inside" }).toBuffer({ resolveWithObject: true });
    const { width: w, height: h } = scaled.info;
    const left = Math.round((SIZE - w) / 2);
    const top = Math.round((SIZE - h) / 2);
    const alpha = await sharp(scaled.data).extractChannel(3).linear(0.22, 0).toBuffer();
    const pad = 40;
    const shadow = await sharp(await sharp({ create: { width: w, height: h, channels: 3, background: "#000" } }).joinChannel(alpha).png().toBuffer())
        .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .blur(18).png().toBuffer();
    await sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: "#ffffff" } })
        .composite([{ input: shadow, left: left - pad + 10, top: top - pad + 14 }, { input: scaled.data, left, top }])
        .jpeg({ quality: 92 }).toFile(output);
}

/** Upright pixels and size — phone photos carry their turn in EXIF. */
async function upright() {
    const data = await sharp(input).rotate().toBuffer();
    const { width, height } = await sharp(data).metadata();
    return { data, W: width, H: height };
}

async function blank() {
    const { W, H } = await upright();
    const { x, y, w, h } = parseBox(W, H);
    // The label colour: median of a thin ring just outside the box.
    const ring = 6;
    const rx = Math.max(0, x - ring), ry = Math.max(0, y - ring);
    const rw = Math.min(W - rx, w + 2 * ring), rh = Math.min(H - ry, h + 2 * ring);
    const { data, info } = await sharp(input).rotate().extract({ left: rx, top: ry, width: rw, height: rh }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const ch = [[], [], []];
    for (let j = 0; j < info.height; j++) for (let i = 0; i < info.width; i++) {
        const inside = i >= x - rx && i < x - rx + w && j >= y - ry && j < y - ry + h;
        if (inside) continue;
        const k = (j * info.width + i) * 3;
        ch[0].push(data[k]); ch[1].push(data[k + 1]); ch[2].push(data[k + 2]);
    }
    // The paper, not the print: the 80th percentile skips the dark text the ring crosses.
    const paper = ch.map((a) => a.sort((p, q) => p - q)[Math.floor(a.length * 0.8)] ?? 255);
    // Feathered edge (alpha ramps over ~3 px) so the patch sits into the paper, not as a hard block.
    const f3 = 3;
    const pw = w + 2 * f3, ph = h + 2 * f3;
    const hard = Buffer.alloc(pw * ph);
    for (let j = f3; j < f3 + h; j++) hard.fill(255, j * pw + f3, j * pw + f3 + w);
    // Ramp only OUTSIDE the box: inside stays fully covered so no marker edge shows through.
    const mask = await sharp(hard, { raw: { width: pw, height: ph, channels: 1 } }).blur(1.5).raw().toBuffer();
    for (let i = 0; i < mask.length; i++) if (hard[i]) mask[i] = 255;
    const patch = await sharp({ create: { width: pw, height: ph, channels: 3, background: { r: paper[0], g: paper[1], b: paper[2] } } })
        .joinChannel(mask, { raw: { width: pw, height: ph, channels: 1 } }).png().toBuffer();
    const px = Math.max(0, x - f3), py = Math.max(0, y - f3);
    await sharp(input).rotate().composite([{ input: patch, left: px, top: py }]).jpeg({ quality: 92 }).toFile(output);
}

/**
 * Cut away empty space round the product but keep the real background (a desk, our
 * shop) — the photos the rules say never to cut out. Product found by the same model
 * as cutout; a box given by the caller wins (for a product the model misses).
 */
async function crop() {
    const { data, W, H } = await upright();
    let r;
    if (box) r = parseBox(W, H);
    else {
        // The model reads the file as stored, without the EXIF turn — give it the upright copy.
        const tmp = `${output}.upright.png`;
        await sharp(data).png().toFile(tmp);
        const cut = await segment(tmp);
        (await import("node:fs")).unlinkSync(tmp);
        // Map the mask's bounds to the photo in case the model resized it.
        let x0 = cut.width, y0 = cut.height, x1 = -1, y1 = -1;
        for (let y = 0; y < cut.height; y++) for (let x = 0; x < cut.width; x++) {
            if (cut.data[(y * cut.width + x) * 4 + 3] < 128) continue;
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        if (x1 < 0) throw new Error("no product found — pass a box");
        const sx = W / cut.width, sy = H / cut.height;
        const m = 0.06 * Math.max((x1 - x0) * sx, (y1 - y0) * sy);
        const left = Math.max(0, Math.floor(x0 * sx - m)), top = Math.max(0, Math.floor(y0 * sy - m));
        r = { x: left, y: top, w: Math.min(W, Math.ceil(x1 * sx + m)) - left, h: Math.min(H, Math.ceil(y1 * sy + m)) - top };
    }
    if (r.w * r.h > 0.92 * W * H) console.log("crop: product already fills the photo — nothing worth cutting; keep the original");
    await sharp(data).extract({ left: r.x, top: r.y, width: r.w, height: r.h }).jpeg({ quality: 92 }).toFile(output);
}

/** Turn by a small angle, then keep the largest same-shape rectangle with no empty corner. */
async function straighten() {
    const deg = Number(box);
    if (!Number.isFinite(deg) || deg === 0 || Math.abs(deg) > 15) throw new Error("deg must be −15…15 and not 0");
    const { data, W, H } = await upright();
    const turned = await sharp(data).rotate(deg, { background: "#ffffff" }).toBuffer();
    const { width: TW, height: TH } = await sharp(turned).metadata();
    const a = (Math.abs(deg) * Math.PI) / 180;
    // Same-aspect rectangle inside a W×H frame turned by a.
    const s = 1 / (Math.cos(a) + Math.max(W / H, H / W) * Math.sin(a));
    const w = Math.floor(W * s), h = Math.floor(H * s);
    await sharp(turned).extract({ left: Math.floor((TW - w) / 2), top: Math.floor((TH - h) / 2), width: w, height: h }).jpeg({ quality: 92 }).toFile(output);
}

const t = Date.now();
if (mode === "cutout") await cutout();
else if (mode === "blank") await blank();
else if (mode === "crop") await crop();
else if (mode === "straighten") await straighten();
else { console.error(`unknown mode ${mode}`); process.exit(2); }
console.log(`${mode}: ${output} in ${((Date.now() - t) / 1000).toFixed(1)}s`);
