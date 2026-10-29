import { z } from "zod";
import { formatRupees } from "@/shared/lib/format/moneyInr";

/**
 * Posts — one message for everyone, put up on several channels
 * (prisma/schema/campaigns.prisma `Post`). Shared by the API routes and the
 * screens so both read the same rules.
 *
 * WhatsApp has no posting API at all, so Share prepares the photo and caption
 * and opens the app; staff then mark it done, which writes a PostShare line.
 * Google Business Profile posts by itself once connected on Campaigns →
 * Channels (googleBusiness.ts) — Post to Google, or the communications job at
 * the scheduled time — and falls back to the same hand share when it cannot.
 * A Facebook Page works the same way (facebookPage.ts): Post to Facebook, or
 * the job, once the page is connected and picked on Channels — and so does the
 * page's linked Instagram business account (instagram.ts), on the same login.
 */

export const POST_CHANNELS = [
    {
        value: "WA_CHANNEL",
        label: "WhatsApp Channel",
        short: "Channel",
        mode: "PHONE",
        ready: true,
        hint: "Share from any channel admin's phone and pick our channel.",
    },
    {
        value: "GOOGLE_BUSINESS",
        label: "Google Business Profile",
        short: "Google",
        mode: "PHONE",
        ready: true,
        hint: "Posts by itself once connected on Campaigns → Channels. By hand: Share copies the text, saves the photo and opens the Business Profile.",
    },
    {
        value: "WA_STATUS",
        label: "WhatsApp Status",
        short: "Status",
        mode: "PHONE",
        ready: true,
        hint: "Share from the company phone, WhatsApp Business app → My status (after Meta's coexistence approval).",
    },
    {
        value: "FACEBOOK",
        label: "Facebook Page feed",
        short: "FB",
        mode: "AUTO",
        ready: true,
        hint: "Posts by itself once the page is connected on Campaigns → Channels. By hand: Share copies the text, saves the photo and opens the page.",
    },
    {
        value: "FACEBOOK_STORY",
        label: "Facebook Page story",
        short: "FB story",
        mode: "AUTO",
        ready: true,
        hint: "One upright photo or short video, gone after 24 hours; no caption. Posts by itself through the Facebook connection.",
    },
    {
        value: "FACEBOOK_REEL",
        label: "Facebook Page reel",
        short: "FB reel",
        mode: "AUTO",
        ready: true,
        hint: "One upright MP4 video with a short caption. Posts by itself through the Facebook connection.",
    },
    {
        value: "INSTAGRAM",
        label: "Instagram",
        short: "IG",
        mode: "AUTO",
        ready: true,
        hint: "Posts by itself through the Facebook connection on Campaigns → Channels (needs a JPG photo or an MP4). By hand: Share opens Instagram.",
    },
] as const;

export type PostChannel = (typeof POST_CHANNELS)[number]["value"];
const READY_CHANNELS = POST_CHANNELS.filter((c) => c.ready).map((c) => c.value) as [PostChannel, ...PostChannel[]];

export const channelOf = (v: string) => POST_CHANNELS.find((c) => c.value === v);

/** Where Share sends staff for Google — the Business Profile manager, signed in as the shop. */
export const GOOGLE_BUSINESS_URL = "https://business.google.com/";

/** Google's post kinds and its call-to-action buttons, by its own API names. */
export const GOOGLE_POST_TYPES = [
    { value: "UPDATE", label: "Update" },
    { value: "OFFER", label: "Offer" },
    { value: "EVENT", label: "Event" },
] as const;

export const GOOGLE_BUTTONS = [
    { value: "SHOP", label: "Shop" },
    { value: "ORDER", label: "Order online" },
    { value: "CALL", label: "Call now" },
    { value: "LEARN_MORE", label: "Learn more" },
    { value: "BOOK", label: "Book" },
] as const;

/**
 * Why a post cannot go to Google by itself, or null when it can. The API
 * posting covers an Update with a JPG / PNG photo (or none); an Offer or Event
 * needs a title and dates the post does not hold, and Google takes no video or
 * WebP here — those stay "share by hand".
 */
export function googleAutoBlock(p: { googleType: string; mediaType: string | null; mediaSize?: number | null }): string | null {
    if (p.googleType !== "UPDATE") return "Only an Update posts by itself — share an Offer or Event by hand.";
    if (p.mediaType && !["image/jpeg", "image/png"].includes(p.mediaType)) return "Google takes a JPG or PNG photo here — share a video or WebP by hand.";
    if (p.mediaSize && p.mediaSize > GOOGLE_PHOTO_MAX_BYTES) return "Google takes a photo up to 5 MB — use Fit to make a smaller copy.";
    return null;
}

/** Google's own cap on a post photo. */
export const GOOGLE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Does the text carry a phone number? Google may reject a post that does —
 * the Call now button dials the listing's own number instead. Indian mobile
 * and landline shapes, with or without +91 / 0 and spaces or dashes.
 */
export const hasPhoneNumber = (text: string) => /(?:\+91[\s-]?|\b0)?\b(?:[6-9]\d{4}[\s-]?\d{5}|0?\d{2,4}[\s-]\d{6,8})\b/.test(text);

/** Where Share sends staff for Facebook — the shop's page, signed in as one of its admins. */
export const FACEBOOK_PAGE_URL = "https://www.facebook.com/";

/**
 * Why a post cannot go to Facebook by itself, or null when it can. Facebook
 * takes a JPG / PNG photo or an MP4 video (or none) — a WebP is shared by hand.
 */
export function facebookAutoBlock(p: { mediaType: string | null; mediaSize?: number | null; photos?: { type: string; size: number }[] }): string | null {
    const files = p.photos?.length ? p.photos : p.mediaType ? [{ type: p.mediaType, size: p.mediaSize ?? 0 }] : [];
    if (files.some((f) => f.type === "image/webp")) return "Facebook takes a JPG or PNG photo here — share a WebP by hand, or replace it.";
    if (files.length > 1 && files.some((f) => f.type.startsWith("video/")))
        return "Facebook's feed takes several photos or one video, not both — pick one, or share the mix by hand.";
    if (files.some((f) => f.type.startsWith("image/") && f.size > FACEBOOK_PHOTO_MAX_BYTES)) return "Facebook takes photos up to 4 MB — use Fit or Adjust to make a smaller copy.";
    return null;
}

/**
 * Why a post cannot go to the Facebook Page story by itself, or null: one JPG
 * / PNG photo (under 4 MB) or one MP4 video.
 */
export function facebookStoryBlock(p: { mediaType: string | null; mediaSize?: number | null }): string | null {
    if (!p.mediaType) return "A story needs a photo or a video.";
    if (p.mediaType.startsWith("video/")) return p.mediaType === "video/mp4" ? null : "A story video must be an MP4.";
    if (!["image/jpeg", "image/png"].includes(p.mediaType)) return "A story takes a JPG or PNG photo — Fit or Adjust makes one.";
    if (p.mediaSize && p.mediaSize > FACEBOOK_PHOTO_MAX_BYTES) return "A story photo must be under 4 MB — Fit or Adjust makes a smaller copy.";
    return null;
}

/** Why a post cannot go to the Facebook Page reels by itself, or null: one MP4 video. */
export function facebookReelBlock(p: { mediaType: string | null }): string | null {
    if (p.mediaType !== "video/mp4") return "A reel needs one MP4 video — upload it on the reel's card.";
    return null;
}

/** Facebook's own Page docs: photos under 4 MB; a PNG over 1 MB can come out blurry. */
export const FACEBOOK_PHOTO_MAX_BYTES = 4 * 1024 * 1024;
export const FACEBOOK_PNG_SOFT_BYTES = 1024 * 1024;

/** Where Share sends staff for Instagram — the shop's profile. */
export const INSTAGRAM_URL = "https://www.instagram.com/";

/**
 * Why a post cannot go to Instagram by itself, or null when it can. Instagram
 * needs a photo or video (no text-only post), and its API takes a JPG photo
 * (no PNG / WebP) or an MP4, which goes up as a Reel.
 */
export function instagramAutoBlock(p: { mediaType: string | null }): string | null {
    if (!p.mediaType) return "Instagram needs a photo or video — add one, or share by hand.";
    if (p.mediaType !== "image/jpeg" && p.mediaType !== "video/mp4") return "Instagram takes a JPG photo or an MP4 here — share a PNG or WebP by hand, or replace it.";
    return null;
}

/**
 * What each channel takes (owner, 2026-10-29: "same idea, written differently
 * per platform"): text limit, how many photos, and the photo shape that looks
 * best. A per-channel copy is checked against its own channel; the ratio is
 * only advice — a photo of another shape still shares, with a warning.
 */
export const CHANNEL_SPECS: Record<PostChannel, { textMax: number; photosMax: number; ratio: [number, number]; ratioLabel: string }> = {
    WA_CHANNEL: { textMax: 4096, photosMax: 10, ratio: [1, 1], ratioLabel: "square 1:1" },
    GOOGLE_BUSINESS: { textMax: 1500, photosMax: 1, ratio: [4, 3], ratioLabel: "wide 4:3" },
    WA_STATUS: { textMax: 700, photosMax: 10, ratio: [9, 16], ratioLabel: "upright 9:16" },
    FACEBOOK: { textMax: 5000, photosMax: 10, ratio: [1, 1], ratioLabel: "square 1:1" },
    // A story shows no caption — textMax 0 means "no text here".
    FACEBOOK_STORY: { textMax: 0, photosMax: 1, ratio: [9, 16], ratioLabel: "upright 9:16" },
    FACEBOOK_REEL: { textMax: 2200, photosMax: 1, ratio: [9, 16], ratioLabel: "upright 9:16 video" },
    INSTAGRAM: { textMax: 2200, photosMax: 10, ratio: [4, 5], ratioLabel: "portrait 4:5" },
};

/**
 * Channels whose text gets the post's hashtags under it (owner, 2026-10-29).
 * Google treats them as spam and WhatsApp has no use for them.
 */
export const HASHTAG_CHANNELS: readonly string[] = ["INSTAGRAM", "FACEBOOK", "FACEBOOK_REEL"];

/** A channel's text with the hashtags under it, where that channel takes them. */
export function withHashtags(text: string, hashtags: string | null | undefined, channel: string): string {
    const tags = hashtags?.trim();
    return tags && HASHTAG_CHANNELS.includes(channel) ? `${text}\n\n${tags}` : text;
}

/** The main text's own cap — the roomiest channel; each channel's copy is held to its own limit. */
export const POST_CAPTION_MAX = Math.max(...Object.values(CHANNEL_SPECS).map((s) => s.textMax));

/** Is a w×h photo close enough (±6%) to the channel's best shape? */
export function ratioFits(channel: string, w: number, h: number): boolean {
    const spec = CHANNEL_SPECS[channel as PostChannel];
    if (!spec || !w || !h) return true;
    return Math.abs(w / h / (spec.ratio[0] / spec.ratio[1]) - 1) <= 0.06;
}

/** One photo / video of a post in R2, under "posts/<id>/". */
export type PostPhoto = {
    key: string;
    type: string;
    name: string;
    size: number;
    /** A cut copy (Fit / Adjust): the photo it was cut from … */
    from?: string;
    /** … and the part kept, as fractions of that photo (null = the automatic cut). */
    crop?: PhotoCrop | null;
};

/** A frame on a photo, each value a fraction (0–1) of its width or height. */
export type PhotoCrop = { x: number; y: number; w: number; h: number };

const fraction = z.number().min(0).max(1);
/** A frame on a photo, as the Adjust editor and the Google Business API caller send it. */
export const photoCropSchema = z.object({ x: fraction, y: fraction, w: z.number().gt(0).max(1), h: z.number().gt(0).max(1) });
/** The important point of a photo, fractions across and down. */
export const photoFocusSchema = z.object({ x: fraction, y: fraction });

/**
 * A channel's own copy of the post. Any field left null follows the main post:
 * `caption` its text, `scheduledAt` its time (ISO), `photos` its main photo
 * (otherwise the keys, in order, from the main photo and `extraMedia`).
 */
export type PostVariant = { caption: string | null; scheduledAt: string | null; photos: string[] | null };
export type PostVariants = Partial<Record<string, PostVariant>>;

type VariantSource = {
    caption: string;
    hashtags?: string | null;
    scheduledAt: Date | string | null;
    mediaKey: string | null;
    mediaType: string | null;
    mediaName: string | null;
    mediaSize: number | null;
    extraMedia: unknown;
    variants: unknown;
};

/** Every photo of a post: the main one first, then the extras. */
export function postPhotos(p: Pick<VariantSource, "mediaKey" | "mediaType" | "mediaName" | "mediaSize" | "extraMedia">): PostPhoto[] {
    const main = p.mediaKey ? [{ key: p.mediaKey, type: p.mediaType ?? "", name: p.mediaName ?? "post", size: p.mediaSize ?? 0 }] : [];
    return [...main, ...((Array.isArray(p.extraMedia) ? p.extraMedia : []) as PostPhoto[])];
}

export const variantOf = (p: { variants: unknown }, channel: string): PostVariant | null =>
    ((p.variants ?? {}) as PostVariants)[channel] ?? null;

/** When one channel's copy goes out: its own time, else the post's. */
export function channelTime(p: { scheduledAt: Date | string | null; variants: unknown }, channel: string): Date | null {
    const at = variantOf(p, channel)?.scheduledAt ?? p.scheduledAt;
    return at ? new Date(at) : null;
}

/** What actually goes out on one channel: its text, time and photos, falling back to the main post. */
export function channelPost(p: VariantSource, channel: string) {
    const v = variantOf(p, channel);
    const all = postPhotos(p);
    const photos = v?.photos ? v.photos.flatMap((k) => all.filter((f) => f.key === k)) : all.slice(0, 1);
    return {
        caption: withHashtags(v?.caption ?? p.caption, p.hashtags, channel),
        scheduledAt: channelTime(p, channel),
        photos: photos.slice(0, CHANNEL_SPECS[channel as PostChannel]?.photosMax ?? 1),
        /** Own words or photos (a copy with only its own time still reads as the main post). */
        custom: v?.caption != null || v?.photos != null,
    };
}

export const POST_STATUSES = [
    { value: "DRAFT", label: "Draft" },
    { value: "SCHEDULED", label: "Scheduled" },
    { value: "DONE", label: "Done" },
] as const;

/** What WhatsApp Status / Channel and Google posts take: a photo, or an MP4 up to 16 MB. */
export const POST_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "video/mp4"] as const;
export const POST_MEDIA_MAX_BYTES = 16 * 1024 * 1024;

export function checkPostMedia(type: string, size: number): string | null {
    if (!(POST_MEDIA_TYPES as readonly string[]).includes(type)) return "Use a JPG, PNG or WebP photo, or an MP4 video.";
    if (size <= 0) return "Empty file.";
    if (size > POST_MEDIA_MAX_BYTES) return "Too large — keep it under 16 MB.";
    return null;
}

const variantSchema = z.object({
    caption: z.string().trim().min(1).max(POST_CAPTION_MAX).nullable(),
    scheduledAt: z.string().datetime({ offset: true }).nullable(),
    photos: z.array(z.string().min(1).max(300)).max(10).nullable(),
});

export const postSchema = z
    .object({
    // May be empty when every ticked channel has words of its own (owner, 2026-10-29).
    caption: z.string().trim().max(POST_CAPTION_MAX).default(""),
    // A page on the shop site, never another site.
    link: z
        .string()
        .trim()
        .max(300)
        .refine((v) => v === "" || (v.startsWith("/") && !v.startsWith("//")), "Use a shop page path, like /shop")
        .transform((v) => v || null),
    // "#Abhayapuri #CCTV" — under the text on HASHTAG_CHANNELS only.
    hashtags: z
        .string()
        .trim()
        .max(500)
        .default("")
        .transform((v) => v || null),
    channels: z.array(z.enum(READY_CHANNELS)).min(1, "Pick at least one channel"),
    // Null = no time set (a draft, or "share now").
    scheduledAt: z
        .string()
        .datetime({ offset: true })
        .nullable()
        .transform((v) => (v ? new Date(v) : null)),
    googleType: z.enum(GOOGLE_POST_TYPES.map((t) => t.value) as [string, ...string[]]),
    googleButton: z.enum(GOOGLE_BUTTONS.map((b) => b.value) as [string, ...string[]]).nullable(),
    campaignId: z.number().int().positive().nullable(),
    status: z.enum(["DRAFT", "SCHEDULED"]),
    variants: z.partialRecord(z.enum(READY_CHANNELS), variantSchema).default({}),
    })
    .superRefine((p, ctx) => {
        // Each channel's text must fit that channel — the main text included where a channel follows it.
        for (const c of p.channels) {
            if (CHANNEL_SPECS[c].textMax === 0) continue;
            if (!(p.variants[c]?.caption ?? p.caption)) {
                ctx.addIssue({ code: "custom", path: ["caption"], message: `Write the main text, or ${channelOf(c)?.label}'s own text.` });
                continue;
            }
            const text = withHashtags(p.variants[c]?.caption ?? p.caption, p.hashtags, c);
            const max = CHANNEL_SPECS[c].textMax;
            if (text.length > max) {
                ctx.addIssue({ code: "custom", path: ["variants", c], message: `${channelOf(c)?.label} takes ${max} characters — write a shorter copy for it (now ${text.length}).` });
            }
        }
    })
    .transform(normaliseVariants);

/**
 * Store a post so plain queries still work: `scheduledAt` becomes the earliest
 * channel time (what the jobs, calendar and queue sort and filter on), each
 * channel keeps its own time only when it differs from that, a copy with nothing of its
 * own is dropped, copies for unticked channels go, and any time makes it SCHEDULED.
 */
function normaliseVariants<T extends { channels: string[]; scheduledAt: Date | null; status: string; variants: Partial<Record<string, PostVariant>> }>(p: T): T {
    const timeOf = (c: string) => p.variants[c]?.scheduledAt ?? p.scheduledAt?.toISOString() ?? null;
    const times = p.channels.map(timeOf).filter((t): t is string => !!t).map((t) => new Date(t).getTime());
    const first = times.length ? new Date(Math.min(...times)) : null;
    const variants: Record<string, PostVariant> = {};
    for (const c of p.channels) {
        // A channel following the main time keeps it even when another copy is earlier.
        const v = p.variants[c] ?? { caption: null, scheduledAt: null, photos: null };
        const t = timeOf(c);
        const own: PostVariant = { ...v, scheduledAt: t && new Date(t).getTime() !== first?.getTime() ? new Date(t).toISOString() : null };
        if (own.caption !== null || own.scheduledAt !== null || own.photos !== null) variants[c] = own;
    }
    return { ...p, scheduledAt: first, status: first ? "SCHEDULED" : "DRAFT", variants };
}

export type PostInput = z.input<typeof postSchema>;

/** A new post may start from a shop product: on save its main photo is copied in. */
export const newPostSchema = postSchema.and(z.object({ fromProductId: z.number().int().positive().nullish() }));

/** A shop product as the "From a product" picker lists it (GET /api/campaigns/posts/products). */
export type PostProduct = {
    id: number;
    name: string;
    category: string;
    /** Its shop page, like "/hp-15s" — the post's link. */
    path: string;
    pricePaise: number;
    mrpPaise: number | null;
    imageUrl: string | null;
    /** The opening of the shop description, plain text. */
    blurb: string | null;
    inStock: boolean;
};

/**
 * The starting text of a post made from a product: name, a line about it, the
 * price (MRP alongside when the shop sells below it) and "In stock". Staff edit
 * it freely before saving; the link goes under it on its own.
 */
export function productPostCaption(p: PostProduct): string {
    const price =
        p.mrpPaise && p.mrpPaise > p.pricePaise ? `${formatRupees(p.pricePaise / 100)} (MRP ${formatRupees(p.mrpPaise / 100)})` : formatRupees(p.pricePaise / 100);
    return [p.name, p.blurb, `Price: ${price}${p.inStock ? " · In stock" : ""}`].filter(Boolean).join("\n\n").slice(0, POST_CAPTION_MAX);
}

/** The text staff paste: the post, then the shop link it points to. */
export function postCaption(p: { caption: string; link: string | null }, shopSite: string): string {
    return p.link ? `${p.caption}\n\n${shopSite}${p.link}` : p.caption;
}

export const POST_SELECT = {
    id: true,
    caption: true,
    link: true,
    hashtags: true,
    channels: true,
    status: true,
    scheduledAt: true,
    googleType: true,
    googleButton: true,
    mediaKey: true,
    mediaType: true,
    mediaName: true,
    mediaSize: true,
    extraMedia: true,
    variants: true,
    campaignId: true,
    campaign: { select: { id: true, name: true } },
    createdByName: true,
    createdAt: true,
    updatedAt: true,
    shares: { select: { id: true, channel: true, sharedAt: true, sharedByName: true }, orderBy: { sharedAt: "desc" } },
} as const;

export type PostRow = {
    id: number;
    caption: string;
    link: string | null;
    hashtags: string | null;
    channels: string[];
    status: string;
    scheduledAt: string | null;
    googleType: string;
    googleButton: string | null;
    mediaKey: string | null;
    mediaType: string | null;
    mediaName: string | null;
    mediaSize: number | null;
    /** Photos beyond the main one, for channel copies that take more or other photos. */
    extraMedia: PostPhoto[];
    variants: PostVariants;
    campaignId: number | null;
    campaign: { id: number; name: string } | null;
    createdByName: string | null;
    createdAt: string;
    updatedAt: string;
    shares: { id: number; channel: string; sharedAt: string; sharedByName: string | null }[];
    /** Signed links to the file: to show it, and to download it. */
    mediaUrl?: string | null;
    mediaDownloadUrl?: string | null;
    /** View / download links of every photo (main + extras), by key. */
    photoLinks?: Record<string, { url: string | null; downloadUrl: string | null }>;
};

/** Channels of a post still waiting to be shared. */
export const pendingChannels = (p: { channels: string[]; shares: { channel: string }[] }) =>
    p.channels.filter((c) => !p.shares.some((s) => s.channel === c));
