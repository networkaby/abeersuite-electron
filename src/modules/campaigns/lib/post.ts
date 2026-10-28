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
        label: "Facebook Page",
        short: "FB",
        mode: "AUTO",
        ready: true,
        hint: "Posts by itself once the page is connected on Campaigns → Channels. By hand: Share copies the text, saves the photo and opens the page.",
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
export function googleAutoBlock(p: { googleType: string; mediaType: string | null }): string | null {
    if (p.googleType !== "UPDATE") return "Only an Update posts by itself — share an Offer or Event by hand.";
    if (p.mediaType && !["image/jpeg", "image/png"].includes(p.mediaType)) return "Google takes a JPG or PNG photo here — share a video or WebP by hand.";
    return null;
}

/** Where Share sends staff for Facebook — the shop's page, signed in as one of its admins. */
export const FACEBOOK_PAGE_URL = "https://www.facebook.com/";

/**
 * Why a post cannot go to Facebook by itself, or null when it can. Facebook
 * takes a JPG / PNG photo or an MP4 video (or none) — a WebP is shared by hand.
 */
export function facebookAutoBlock(p: { mediaType: string | null }): string | null {
    if (p.mediaType === "image/webp") return "Facebook takes a JPG or PNG photo here — share a WebP by hand, or replace it.";
    return null;
}

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

/** Google allows 1,500 characters; WhatsApp more — the stricter one wins. */
export const POST_CAPTION_MAX = 1500;

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

export const postSchema = z.object({
    caption: z.string().trim().min(1, "Write the post").max(POST_CAPTION_MAX),
    // A page on the shop site, never another site.
    link: z
        .string()
        .trim()
        .max(300)
        .refine((v) => v === "" || (v.startsWith("/") && !v.startsWith("//")), "Use a shop page path, like /shop")
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
});

export type PostInput = z.input<typeof postSchema>;

/** A new post may start from a shop product: on save its main photo is copied in. */
export const newPostSchema = postSchema.extend({ fromProductId: z.number().int().positive().nullish() });

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
    channels: true,
    status: true,
    scheduledAt: true,
    googleType: true,
    googleButton: true,
    mediaKey: true,
    mediaType: true,
    mediaName: true,
    mediaSize: true,
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
    channels: string[];
    status: string;
    scheduledAt: string | null;
    googleType: string;
    googleButton: string | null;
    mediaKey: string | null;
    mediaType: string | null;
    mediaName: string | null;
    mediaSize: number | null;
    campaignId: number | null;
    campaign: { id: number; name: string } | null;
    createdByName: string | null;
    createdAt: string;
    updatedAt: string;
    shares: { id: number; channel: string; sharedAt: string; sharedByName: string | null }[];
    /** Signed links to the file: to show it, and to download it. */
    mediaUrl?: string | null;
    mediaDownloadUrl?: string | null;
};

/** Channels of a post still waiting to be shared. */
export const pendingChannels = (p: { channels: string[]; shares: { channel: string }[] }) =>
    p.channels.filter((c) => !p.shares.some((s) => s.channel === c));
