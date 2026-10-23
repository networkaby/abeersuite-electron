import { z } from "zod";

/**
 * Posts — one message for everyone, put up on several channels
 * (prisma/schema/campaigns.prisma `Post`). Shared by the API routes and the
 * screens so both read the same rules.
 *
 * Every channel is "share by hand" for now: WhatsApp has no posting API at all,
 * and Google Business Profile has one only once Google approves our access.
 * Share prepares the photo and caption and opens the right app; staff then mark
 * it done, which writes a PostShare line. When a channel's API arrives its
 * `mode` turns "AUTO" and the same post goes out by itself.
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
        hint: "Share copies the text, saves the photo and opens the Business Profile — click Add update and paste.",
    },
    {
        value: "WA_STATUS",
        label: "WhatsApp Status",
        short: "Status",
        mode: "PHONE",
        ready: true,
        hint: "Share from the company phone, WhatsApp Business app → My status (after Meta's coexistence approval).",
    },
    { value: "FACEBOOK", label: "Facebook Page", short: "FB", mode: "AUTO", ready: false, hint: "Needs Meta's posting approval." },
    { value: "INSTAGRAM", label: "Instagram", short: "IG", mode: "AUTO", ready: false, hint: "Needs Meta's posting approval." },
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
export const pendingChannels = (p: Pick<PostRow, "channels" | "shares">) =>
    p.channels.filter((c) => !p.shares.some((s) => s.channel === c));
