import "server-only";
import sharp from "sharp";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { mediaLink } from "@/modules/message/lib/customerMessages";
import { R2_MESSAGES_BUCKET } from "@/shared/lib/constants/whatsapp";
import { isR2Configured, putR2 } from "@/shared/lib/storage/r2";
import { CHANNEL_SPECS, checkPostMedia, postPhotos, ratioFits, type PostChannel, type PostPhoto, type PostVariants } from "@/modules/campaigns/lib/post";
import { loadPost, postMediaKey } from "@/modules/campaigns/lib/postServer";

/**
 * One photo, shaped for each channel (owner, 2026-10-29): from a post's main
 * photo (or any of its photos), cut a copy in every ticked channel's best shape
 * — Google 4:3, Facebook / WA Channel 1:1, Status 9:16, Instagram 4:5 — and
 * make it that channel's photo. Channels sharing a shape share one copy; a
 * photo already in shape is used as it is. The crop keeps the busiest part of
 * the picture (sharp's "attention"), always JPEG, which every network takes.
 * The office editor's Fit buttons and the Cowork agent both come here.
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

/**
 * Fit `sourceKey` (default: the main photo) for `channels` (default: every
 * ticked one). Each channel's copy keeps its own words and time; only its
 * photos change, to the fitted one. Returns the post as the screens want it.
 */
export async function fitPostPhoto(postId: number, opts: { sourceKey?: string | null; channels?: string[] | null } = {}) {
    if (!isR2Configured()) throw new PhotoFitError("File storage (R2) is not set up on this server.");
    const post = await prisma.post.findUnique({
        where: { id: postId },
        select: { channels: true, mediaKey: true, mediaType: true, mediaName: true, mediaSize: true, extraMedia: true, variants: true },
    });
    if (!post) throw new PhotoFitError("Post not found.");
    const all = postPhotos(post);
    const source = opts.sourceKey ? all.find((f) => f.key === opts.sourceKey) : all[0];
    if (!source) throw new PhotoFitError("Add a photo to the post first.");
    if (!source.type.startsWith("image/")) throw new PhotoFitError("A video cannot be cut to shape — pick a photo.");
    const channels = (opts.channels?.length ? opts.channels : post.channels).filter((c) => post.channels.includes(c) && c in CHANNEL_SPECS);
    if (!channels.length) throw new PhotoFitError("Tick the channels first.");

    const bytes = await readPhoto(source.key);
    const meta = await sharp(bytes).rotate().metadata();
    const [w, h] = meta.autoOrient ? [meta.autoOrient.width, meta.autoOrient.height] : [meta.width ?? 0, meta.height ?? 0];

    const extras = (Array.isArray(post.extraMedia) ? post.extraMedia : []) as PostPhoto[];
    const made = new Map<string, string>(); // "4:5" → key
    const pick: Record<string, string> = {};
    const base = source.name.replace(/\.[^.]+$/, "").slice(0, 40) || "photo";
    for (const c of channels) {
        const spec = CHANNEL_SPECS[c as PostChannel];
        if (ratioFits(c, w, h)) {
            pick[c] = source.key;
            continue;
        }
        const shape = `${spec.ratio[0]}x${spec.ratio[1]}`;
        let key = made.get(shape);
        if (!key) {
            const out = await sharp(bytes)
                .rotate()
                .resize({ ...sizeFor(spec.ratio), fit: "cover", position: sharp.strategy.attention })
                .jpeg({ quality: 85, mozjpeg: true })
                .toBuffer();
            const name = `${base}-${shape}.jpg`;
            const bad = checkPostMedia("image/jpeg", out.byteLength);
            if (bad) throw new PhotoFitError(bad);
            if (extras.length >= EXTRA_MEDIA_MAX) throw new PhotoFitError(`A post holds ${EXTRA_MEDIA_MAX + 1} photos at most — remove some first.`);
            key = postMediaKey(postId, name);
            await putR2(R2_MESSAGES_BUCKET, key, out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer, "image/jpeg");
            extras.push({ key, type: "image/jpeg", name, size: out.byteLength });
            made.set(shape, key);
        }
        pick[c] = key;
    }

    const variants = { ...((post.variants ?? {}) as PostVariants) };
    for (const [c, key] of Object.entries(pick)) {
        // null photos = the main photo, so a main photo already in shape needs no entry.
        const v = { ...(variants[c] ?? { caption: null, scheduledAt: null }), photos: key === post.mediaKey ? null : [key] };
        if (v.caption === null && v.scheduledAt === null && v.photos === null) delete variants[c];
        else variants[c] = v;
    }
    await prisma.post.update({ where: { id: postId }, data: { extraMedia: extras, variants } });
    return { post: await loadPost(postId), fitted: pick };
}

/**
 * Store a photo the server already holds (the Cowork agent's upload or its
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
    if (asExtra && list.length >= EXTRA_MEDIA_MAX) throw new PhotoFitError(`A post holds ${EXTRA_MEDIA_MAX + 1} photos at most.`);
    const key = postMediaKey(postId, file.name);
    await putR2(R2_MESSAGES_BUCKET, key, file.bytes, file.type);
    const photo: PostPhoto = { key, type: file.type, name: file.name, size: file.bytes.byteLength };
    await prisma.post.update({
        where: { id: postId },
        data: asExtra ? { extraMedia: [...list, photo] } : { mediaKey: key, mediaType: file.type, mediaName: file.name, mediaSize: photo.size },
    });
    return photo;
}
