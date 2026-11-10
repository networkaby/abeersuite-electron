import type { ImageLoaderProps } from "next/image";

// Client-safe Cloudinary delivery helpers. Kept apart from `cloudinary.ts`
// (which signs uploads with node:crypto and must stay server-only).
//
// Cost split: images we ship in /public are resized by Next/Vercel's own
// optimizer; user-uploaded images live on Cloudinary and are resized by
// Cloudinary itself, so neither bill picks up the other's traffic.
//
// Everything here uses STANDARD transformations only (1 transformation each,
// CDN-cached after the first request; the fix effects e_trim / e_improve /
// e_auto_contrast / e_sharpen / e_auto_color / e_auto_brightness / e_vibrance
// and the a_ rotation are standard too). Generative AI params (b_gen_fill,
// e_gen_remove, …) cost 50-230x per use and are deliberately not offered.

const UPLOAD_MARKER = "/image/upload/";

/** True for a Cloudinary delivery URL we can safely inject transformations into. */
export function isCloudinaryUrl(src: string): boolean {
    return /^https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(src);
}

// --- Per-image adjustment -------------------------------------------------
// The adjustment is stored IN THE URL (the transformation segment right after
// /image/upload/), not in a database column. So `galleryJson` stays a plain
// string[], every existing reader keeps working, and the framing travels with
// the image wherever it is copied.

/** Crop modes offered in the adjust dialog. All standard, all free. */
export const CROP_MODES = ["pad", "fill", "fit", "thumb"] as const;
export type CropMode = (typeof CROP_MODES)[number];

/** Focus (gravity) modes offered in the adjust dialog. All standard, all free. */
export const GRAVITY_MODES = [
    "auto",
    "auto:subject",
    "face",
    "faces",
    "center",
    "north",
    "south",
    "east",
    "west",
] as const;
export type GravityMode = (typeof GRAVITY_MODES)[number];

/**
 * Free look fixes (standard effects, not generative), in the order Cloudinary
 * applies them: trim the empty border first, then tone, then sharpen. Each is
 * its own chained component — Cloudinary takes one effect per component.
 */
export const IMAGE_FIXES = {
    trim: "Trim empty border",
    auto_color: "Fix colour tint (yellow / blue light)",
    auto_brightness: "Brighten a dark photo",
    improve: "Auto-improve colour & light",
    auto_contrast: "Auto-contrast",
    vibrance: "Livelier colours",
    sharpen: "Sharpen",
} as const;
export type ImageFix = keyof typeof IMAGE_FIXES;
export const IMAGE_FIX_KEYS = Object.keys(IMAGE_FIXES) as ImageFix[];

/** Quarter turns for a sideways phone photo — applied first, before the fixes. */
export const IMAGE_ROTATIONS = [0, 90, 180, 270] as const;
export type ImageRotation = (typeof IMAGE_ROTATIONS)[number];

/** Pad's gap colour: matched to the photo's edge, or plain white (marketplace look). */
export const PAD_BACKGROUNDS = { auto: "Matching background", white: "Plain white" } as const;
export type PadBackground = keyof typeof PAD_BACKGROUNDS;

export type ImageAdjust = {
    crop: CropMode;
    gravity: GravityMode;
    /** Manual focal point in ORIGINAL-image pixels; overrides `gravity` when set. */
    focal?: { x: number; y: number } | null;
    /** Look fixes, applied before the crop. */
    fixes?: ImageFix[];
    /** Clockwise quarter turn; 0 / unset = as uploaded. */
    rotate?: ImageRotation;
    /** Pad only: the gap colour (unset = auto). */
    padBg?: PadBackground;
};

/** No adjustment chosen yet: pad to the frame, never crop, auto-matched background. */
export const DEFAULT_ADJUST: ImageAdjust = { crop: "pad", gravity: "auto", focal: null };

/** Frames the storefront actually renders in — must match the CSS aspect classes. */
export const IMAGE_FRAMES = {
    /** ProductCard tile — `aspect-4/3`. */
    card: "4:3",
    /** Product page main image + thumbs — `aspect-square`. */
    square: "1:1",
} as const;
export type ImageFrame = keyof typeof IMAGE_FRAMES;

type SplitUrl = { head: string; transform: string | null; fixes: ImageFix[]; rotate: ImageRotation; tail: string };

/**
 * Split a Cloudinary URL into `<…/image/upload/>`, its leading transformation
 * segments (rotation, fix effects, then the crop) and the rest. A bare secure_url starts
 * at the version segment (`v1712345678/`), which never contains an underscore —
 * that is how we tell "already transformed" from "untouched".
 */
function split(src: string): SplitUrl | null {
    const at = src.indexOf(UPLOAD_MARKER);
    if (at === -1) return null;
    const head = src.slice(0, at + UPLOAD_MARKER.length);
    let rest = src.slice(at + UPLOAD_MARKER.length);
    let transform: string | null = null;
    const fixes: ImageFix[] = [];
    let rotate: ImageRotation = 0;
    for (;;) {
        const slash = rest.indexOf("/");
        const first = slash === -1 ? "" : rest.slice(0, slash);
        // A transformation segment is comma-joined `x_y` params.
        if (!first || !/^[a-z]{1,3}_/.test(first)) break;
        const fix = first.startsWith("e_") ? first.slice(2) : "";
        const turn = /^a_(90|180|270)$/.exec(first);
        if (fix in IMAGE_FIXES) fixes.push(fix as ImageFix);
        else if (turn) rotate = Number(turn[1]) as ImageRotation;
        else transform = first;
        rest = rest.slice(slash + 1);
    }
    return { head, transform, fixes, rotate, tail: rest };
}

/** The rotation and fix effects as chained components, in Cloudinary's order. */
const fixSegments = (a: Pick<ImageAdjust, "fixes" | "rotate">) =>
    (a.rotate ? `a_${a.rotate}/` : "") + IMAGE_FIX_KEYS.filter((f) => a.fixes?.includes(f)).map((f) => `e_${f}/`).join("");

/** Read the adjustment baked into a URL; DEFAULT_ADJUST when there is none. */
export function readAdjust(src: string): ImageAdjust {
    const parts = split(src);
    if (!parts?.transform) {
        return parts?.fixes.length || parts?.rotate
            ? { ...DEFAULT_ADJUST, fixes: parts.fixes, ...(parts.rotate ? { rotate: parts.rotate } : {}) }
            : DEFAULT_ADJUST;
    }

    const params = new Map<string, string>();
    for (const p of parts.transform.split(",")) {
        const us = p.indexOf("_");
        if (us > 0) params.set(p.slice(0, us), p.slice(us + 1));
    }

    const crop = params.get("c");
    const gravity = params.get("g");
    const x = Number(params.get("x"));
    const y = Number(params.get("y"));

    return {
        crop: (CROP_MODES as readonly string[]).includes(crop ?? "") ? (crop as CropMode) : DEFAULT_ADJUST.crop,
        gravity: (GRAVITY_MODES as readonly string[]).includes(gravity ?? "")
            ? (gravity as GravityMode)
            : DEFAULT_ADJUST.gravity,
        focal: gravity === "xy_center" && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null,
        fixes: parts.fixes,
        ...(parts.rotate ? { rotate: parts.rotate } : {}),
        ...(params.get("b") === "white" ? { padBg: "white" as const } : {}),
    };
}

/**
 * Which gravity a crop mode actually accepts — verified against Cloudinary, not
 * guessed. Sending an unsupported combination returns HTTP 400, not a fallback:
 *  - `c_fill` / `c_thumb` (true crops): any gravity, including `auto*` and a
 *    manual `xy_center` point.
 *  - `c_pad`: positional gravity only (it positions the image inside the pad);
 *    `g_auto` and `g_xy_center` are rejected.
 *  - `c_fit`: no gravity at all, and it rejects `ar_` — it takes w/h only.
 */
const POSITIONAL_GRAVITY: readonly GravityMode[] = ["center", "north", "south", "east", "west"];

/** The adjustment params, without any frame or delivery params. */
function adjustParams(adjust: ImageAdjust): string[] {
    const out = [`c_${adjust.crop}`];

    if (adjust.crop === "pad") {
        // Auto-matched letterbox background (or plain white, staff/AI pick), so a padded tile doesn't show as
        // a grey bar against the card.
        out.push(adjust.padBg === "white" ? "b_white" : "b_auto");
        if ((POSITIONAL_GRAVITY as readonly string[]).includes(adjust.gravity)) {
            out.push(`g_${adjust.gravity}`);
        }
        return out;
    }

    if (adjust.crop === "fit") return out; // gravity is meaningless when nothing is cut

    if (adjust.focal) {
        out.push("g_xy_center", `x_${Math.round(adjust.focal.x)}`, `y_${Math.round(adjust.focal.y)}`);
    } else {
        out.push(`g_${adjust.gravity}`);
    }
    return out;
}

/** Pixel height of `frame` at `width`. */
function frameHeight(frame: ImageFrame, width: number): number {
    const [w, h] = IMAGE_FRAMES[frame].split(":").map(Number);
    return Math.round((width * h) / w);
}

/**
 * Write an adjustment into a URL, replacing any adjustment already there.
 * Non-Cloudinary sources are returned untouched.
 */
export function withAdjust(src: string, adjust: ImageAdjust): string {
    const parts = split(src);
    if (!parts || !isCloudinaryUrl(src)) return src;
    return `${parts.head}${fixSegments(adjust)}${adjustParams(adjust).join(",")}/${parts.tail}`;
}

/** Strip any stored adjustment — used to preview the untouched original. */
export function withoutAdjust(src: string): string {
    const parts = split(src);
    if (!parts) return src;
    return `${parts.head}${parts.tail}`;
}

// --- Delivery -------------------------------------------------------------

/**
 * Build the delivered URL: the stored adjustment (plus the frame's aspect
 * ratio) as one transformation component, then format/quality/width as a
 * chained second component. Chaining keeps the crop decision independent of
 * the responsive width next/image asks for.
 */
export function buildUrl(
    src: string,
    { width, quality, frame }: { width: number; quality?: number; frame?: ImageFrame }
): string {
    const parts = split(src);
    if (!parts) return src;

    const adjust = readAdjust(src);
    const delivery = ["f_auto", `q_${quality ?? "auto"}`];

    if (!frame) {
        // Nothing to crop to — just cap the width.
        return `${parts.head}${fixSegments(adjust)}${[...delivery, `w_${width}`, "c_limit"].join(",")}/${parts.tail}`;
    }

    const shape = adjustParams(adjust);
    // `c_fit` rejects ar_, so it is sized with an explicit width/height pair.
    shape.push(
        ...(adjust.crop === "fit"
            ? [`w_${width}`, `h_${frameHeight(frame, width)}`]
            : [`ar_${IMAGE_FRAMES[frame]}`, `w_${width}`])
    );

    return `${parts.head}${fixSegments(adjust)}${shape.join(",")}/${delivery.join(",")}/${parts.tail}`;
}

/**
 * `<Image>` loader for Cloudinary uploads. `frame` makes Cloudinary crop/pad to
 * the exact shape the surface renders in, so the browser never has to.
 */
export function cloudinaryLoaderFor(frame?: ImageFrame) {
    return function cloudinaryLoader({ src, width, quality }: ImageLoaderProps): string {
        return buildUrl(src, { width, quality: quality ?? undefined, frame });
    };
}

/** The loader to hand `<Image>`: Cloudinary's for uploads, Next's default otherwise. */
export function imageLoaderFor(src: string, frame?: ImageFrame) {
    return isCloudinaryUrl(src) ? cloudinaryLoaderFor(frame) : undefined;
}

/**
 * For plain `<img>` tags (no next/image srcset): a Cloudinary URL capped at
 * `width` px. Non-Cloudinary sources (blob: previews, local paths) pass through.
 */
export function cloudinaryThumb(src: string, width: number, frame?: ImageFrame): string {
    return isCloudinaryUrl(src) ? buildUrl(src, { width, frame }) : src;
}

/** Full-screen viewer copy: sharp enough to zoom, capped so it never pulls the raw original. */
export function viewerPhotoUrl(src: string): string {
    return cloudinaryThumb(src, 2000);
}
