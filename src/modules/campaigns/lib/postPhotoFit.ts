import "server-only";
import sharp from "sharp";
// Posts read the server, not a counter's local copy: a post saved a moment ago is not there yet
// ("Post not found" on its photo upload), so it went out text-only.
import { prismaAuthoritative as prisma } from "@/shared/lib/prisma/prismaClient";
import { mediaLink } from "@/modules/message/lib/customerMessages";
import { R2_MESSAGES_BUCKET } from "@/shared/lib/constants/whatsapp";
import { isR2Configured, putR2 } from "@/shared/lib/storage/r2";
import {
    CHANNEL_SPECS,
    checkPostMedia,
    postPhotos,
    ratioFits,
    type PhotoCrop,
    type PostChannel,
    type PostPhoto,
    type PostVariants,
    variantEmpty,
} from "@/modules/campaigns/lib/post";
import { loadPost, postMediaKey } from "@/modules/campaigns/lib/postServer";

/**
 * One photo, shaped for each channel (owner, 2026-10-29): from a post's main
 * photo (or any of its photos), cut a copy in every ticked channel's best shape
 * — Google 4:3, Facebook / WA Channel 1:1, Status 9:16, Instagram 4:5 — and
 * make it that channel's photo. Free: our own sharp, never a paid service.
 *
 *   - No frame given: channels sharing a shape share one copy; a photo already
 *     in shape is used as it is; the cut keeps the busiest part ("attention").
 *   - A frame (`crop`, from the Adjust editor) or a focus point (`focus`, from
 *     the editor or the Google Business API caller) for one channel: exactly that part.
 *
 * Every copy remembers where it came from (`from`, `crop`), so Adjust reopens
 * on the same photo and frame. A copy no channel uses any more is dropped from
 * the post, so adjusting again never fills the photo limit. Always JPEG.
 */

/** At most this many photos per post besides the main one (Instagram's carousel is 10). */
export const EXTRA_MEDIA_MAX = 9;

/** The long side of a fitted copy. */
const FIT_PX = 1350;

export class PhotoFitError extends Error {}

async function readPhoto(key: string): Promise<Buffer> {
    const link = mediaLink(key);
    if (!link) throw new PhotoFitError("File storage (R2) is not set up on this server.");
    const res = await fetch(link);
    if (!res.ok) throw new PhotoFitError(`Could not read the photo (${res.status}).`);
    return Buffer.from(await res.arrayBuffer());
}

const sizeFor = ([w, h]: [number, number]) => (w >= h ? { width: FIT_PX, height: Math.round((FIT_PX * h) / w) } : { width: Math.round((FIT_PX * w) / h), height: FIT_PX });

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The biggest frame of `ratio` that fits a w×h photo, shrunk by `zoom` (1 =
 * biggest), centred on the focus point as far as the edges allow. Fractions.
 */
export function cropAround(focus: { x: number; y: number }, ratio: [number, number], w: number, h: number, zoom = 1): PhotoCrop {
    const want = ratio[0] / ratio[1];
    const fullW = Math.min(1, (h * want) / w); // as a fraction of the width
    const cw = fullW / Math.max(1, zoom);
    const ch = (cw * w) / want / h;
    return { x: clamp(focus.x - cw / 2, 0, 1 - cw), y: clamp(focus.y - ch / 2, 0, 1 - ch), w: cw, h: ch };
}

/** A frame in pixels, the channel's shape exactly, inside the photo. */
function cropPixels(c: PhotoCrop, ratio: [number, number], w: number, h: number) {
    const want = ratio[0] / ratio[1];
    let width = Math.max(1, Math.round(clamp(c.w, 0.01, 1) * w));
    let height = Math.round(width / want);
    if (height > h) {
        height = h;
        width = Math.round(height * want);
    }
    const left = clamp(Math.round(c.x * w), 0, w - width);
    const top = clamp(Math.round(c.y * h), 0, h - height);
    return { left, top, width, height };
}

/** Drop copies no channel and not the main photo use any more (Fit / Adjust leftovers). */
function withoutOrphans(extras: PostPhoto[], variants: PostVariants, mainKey: string | null): PostPhoto[] {
    const used = new Set<string>([...(mainKey ? [mainKey] : []), ...Object.values(variants).flatMap((v) => v?.photos ?? [])]);
    return extras.filter((f) => !f.from || used.has(f.key));
}

/** Photos people added (not Fit / Adjust copies) — what the photo cap counts. */
export const originalsOf = (list: PostPhoto[]) => list.filter((f) => !f.from);

type FitPost = { mediaKey: string | null; extraMedia: unknown; variants: unknown; channels: string[]; mediaType: string | null; mediaName: string | null; mediaSize: number | null };

async function loadForFit(postId: number) {
    if (!isR2Configured()) throw new PhotoFitError("File storage (R2) is not set up on this server.");
    const post = await prisma.post.findUnique({
        where: { id: postId },
        select: { channels: true, mediaKey: true, mediaType: true, mediaName: true, mediaSize: true, extraMedia: true, variants: true },
    });
    if (!post) throw new PhotoFitError("Post not found.");
    return post;
}

/**
 * The cutter for one post: reads each source once, makes a copy of it in a
 * channel's shape (or hands back the source when it already fits and no frame
 * is asked), and keeps every new copy in `extras`. Auto cuts of the same photo
 * and shape are shared between channels.
 */
function cutter(postId: number, extras: PostPhoto[]) {
    const read = new Map<string, Promise<{ bytes: Buffer; w: number; h: number }>>();
    const made = new Map<string, string>(); // `${source}:${shape}` → key, auto cuts only
    const load = (key: string) => {
        let p = read.get(key);
        if (!p) {
            p = (async () => {
                const bytes = await readPhoto(key);
                const meta = await sharp(bytes).rotate().metadata();
                const [w, h] = meta.autoOrient ? [meta.autoOrient.width, meta.autoOrient.height] : [meta.width ?? 0, meta.height ?? 0];
                if (!w || !h) throw new PhotoFitError("Could not read the photo's size.");
                return { bytes, w, h };
            })();
            read.set(key, p);
        }
        return p;
    };
    return async function cut(source: PostPhoto, channel: string, frame: { crop?: PhotoCrop | null; focus?: { x: number; y: number } | null; zoom?: number | null } = {}) {
        if (!source.type.startsWith("image/")) throw new PhotoFitError("A video cannot be cut to shape — pick a photo.");
        const spec = CHANNEL_SPECS[channel as PostChannel];
        const { bytes, w, h } = await load(source.key);
        const crop = frame.crop ?? (frame.focus ? cropAround(frame.focus, spec.ratio, w, h, frame.zoom ?? 1) : null);
        if (!crop && ratioFits(channel, w, h)) return source.key;
        const shape = `${spec.ratio[0]}x${spec.ratio[1]}`;
        const shared = crop ? undefined : made.get(`${source.key}:${shape}`);
        if (shared) return shared;
        const img = sharp(bytes).rotate();
        const out = await (crop ? img.extract(cropPixels(crop, spec.ratio, w, h)).resize(sizeFor(spec.ratio)) : img.resize({ ...sizeFor(spec.ratio), fit: "cover", position: sharp.strategy.attention }))
            .jpeg({ quality: 85, mozjpeg: true })
            .toBuffer();
        const name = `${source.name.replace(/\.[^.]+$/, "").slice(0, 40) || "photo"}-${shape}.jpg`;
        const bad = checkPostMedia("image/jpeg", out.byteLength);
        if (bad) throw new PhotoFitError(bad);
        const key = postMediaKey(postId, name);
        await putR2(R2_MESSAGES_BUCKET, key, out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer, "image/jpeg");
        extras.push({ key, type: "image/jpeg", name, size: out.byteLength, from: source.key, crop });
        if (!crop) made.set(`${source.key}:${shape}`, key);
        return key;
    };
}

async function saveFit(postId: number, post: FitPost, extras: PostPhoto[], picks: Record<string, string[]>) {
    const variants = { ...((post.variants ?? {}) as PostVariants) };
    for (const [c, keys] of Object.entries(picks)) setChannelPhotos(variants, c, keys.length === 1 && keys[0] === post.mediaKey ? null : keys);
    const kept = withoutOrphans(extras, variants, post.mediaKey);
    await prisma.post.update({ where: { id: postId }, data: { extraMedia: kept, variants } });
    return loadPost(postId);
}

/**
 * Fit `sourceKey` (default: the main photo) for `channels` (default: every
 * ticked one), or — with `crop` / `focus` — cut exactly that part for one
 * channel. Each channel keeps its own words and time; only its photos change.
 */
export async function fitPostPhoto(
    postId: number,
    opts: { sourceKey?: string | null; channels?: string[] | null; crop?: PhotoCrop | null; focus?: { x: number; y: number } | null; zoom?: number | null } = {},
) {
    const post = await loadForFit(postId);
    const all = postPhotos(post);
    const source = opts.sourceKey ? all.find((f) => f.key === opts.sourceKey) : all[0];
    if (!source) throw new PhotoFitError("Add a photo to the post first.");
    const channels = (opts.channels?.length ? opts.channels : post.channels).filter((c) => post.channels.includes(c) && c in CHANNEL_SPECS);
    if (!channels.length) throw new PhotoFitError("Tick the channels first.");
    if ((opts.crop || opts.focus) && channels.length !== 1) throw new PhotoFitError("A frame or focus point is for one channel at a time.");

    const extras = (Array.isArray(post.extraMedia) ? post.extraMedia : []) as PostPhoto[];
    const cut = cutter(postId, extras);
    const picks: Record<string, string[]> = {};
    for (const c of channels) picks[c] = [await cut(source, c, opts)];
    const row = await saveFit(postId, post, extras, picks);
    return { post: row, fitted: Object.fromEntries(Object.entries(picks).map(([c, k]) => [c, k[0]])) };
}

/**
 * One channel takes several of the post's photos (`keys`, in order — the
 * Facebook feed's multi-photo post): each cut to its shape (videos kept as
 * they are), up to the channel's count.
 */
export async function fitChannelPhotos(postId: number, channel: string, keys: string[]) {
    const spec = CHANNEL_SPECS[channel as PostChannel];
    if (!spec) throw new PhotoFitError("Unknown channel.");
    const post = await loadForFit(postId);
    const all = postPhotos(post);
    const sources = keys.flatMap((k) => all.filter((f) => f.key === k)).slice(0, spec.photosMax);
    if (!sources.length) throw new PhotoFitError("Those photos are not on this post.");
    const extras = (Array.isArray(post.extraMedia) ? post.extraMedia : []) as PostPhoto[];
    const cut = cutter(postId, extras);
    const out: string[] = [];
    for (const f of sources) out.push(f.type.startsWith("image/") ? await cut(f, channel) : f.key);
    const row = await saveFit(postId, post, extras, { [channel]: out });
    return { post: row, fitted: { [channel]: out[0] } };
}

/** One channel's photos (null = the main photo), dropping a copy left with nothing of its own. */
function setChannelPhotos(variants: PostVariants, channel: string, photos: string[] | null) {
    const v = { ...(variants[channel] ?? { caption: null, scheduledAt: null }), photos };
    if (variantEmpty(v)) delete variants[channel];
    else variants[channel] = v;
}

/**
 * Give one channel a photo already on the post (`key`): its only photo, or —
 * `add` — after the ones it has, up to its count. For a photo uploaded from a
 * platform card, or the Google Business API caller's photo for one channel.
 */
export async function giveChannelPhoto(postId: number, channel: string, key: string, add = false) {
    const spec = CHANNEL_SPECS[channel as PostChannel];
    if (!spec) throw new PhotoFitError("Unknown channel.");
    const row = await prisma.post.findUnique({ where: { id: postId }, select: { variants: true, mediaKey: true, extraMedia: true } });
    if (!row) throw new PhotoFitError("Post not found.");
    const variants = { ...((row.variants ?? {}) as PostVariants) };
    const had = variants[channel]?.photos ?? [];
    setChannelPhotos(variants, channel, key === row.mediaKey && !add ? null : add ? [...had, key].slice(-spec.photosMax) : [key]);
    const extras = withoutOrphans((Array.isArray(row.extraMedia) ? row.extraMedia : []) as PostPhoto[], variants, row.mediaKey);
    await prisma.post.update({ where: { id: postId }, data: { variants, extraMedia: extras } });
}

/**
 * Store a photo the server already holds (the Google Business API caller's upload or its
 * link) under the post: as the main photo, or `extra` beside it.
 */
export async function attachPostPhoto(postId: number, file: { bytes: ArrayBuffer; type: string; name: string }, extra: boolean) {
    const bad = checkPostMedia(file.type, file.bytes.byteLength);
    if (bad) throw new PhotoFitError(bad);
    if (!isR2Configured()) throw new PhotoFitError("File storage (R2) is not set up on this server.");
    const row = await prisma.post.findUnique({ where: { id: postId }, select: { extraMedia: true, mediaKey: true } });
    if (!row) throw new PhotoFitError("Post not found.");
    const list = (Array.isArray(row.extraMedia) ? row.extraMedia : []) as PostPhoto[];
    const asExtra = extra && !!row.mediaKey;
    if (asExtra && originalsOf(list).length >= EXTRA_MEDIA_MAX) throw new PhotoFitError(`A post holds ${EXTRA_MEDIA_MAX + 1} photos at most.`);
    const key = postMediaKey(postId, file.name);
    await putR2(R2_MESSAGES_BUCKET, key, file.bytes, file.type);
    const photo: PostPhoto = { key, type: file.type, name: file.name, size: file.bytes.byteLength };
    await prisma.post.update({
        where: { id: postId },
        data: asExtra ? { extraMedia: [...list, photo] } : { mediaKey: key, mediaType: file.type, mediaName: file.name, mediaSize: photo.size },
    });
    return photo;
}
