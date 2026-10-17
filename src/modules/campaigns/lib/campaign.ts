import { z } from "zod";

/**
 * Campaigns — one message to many customers (prisma/schema/campaigns.prisma).
 * Phase 1 writes and saves them; sending (push, then WhatsApp) comes next.
 * Shared by the API routes and the editor so both read the same rules.
 */

export const CAMPAIGN_CHANNELS = [
    { value: "PUSH", label: "App notification", ready: true },
    { value: "WHATSAPP", label: "WhatsApp", ready: false },
] as const;

export const CAMPAIGN_AUDIENCES = [
    { value: "ALL_PUSH", label: "All customers with notifications on" },
] as const;

/** DRAFT and READY are set by staff; SENT only by the send step (phase 2). */
export const CAMPAIGN_STATUSES = [
    { value: "DRAFT", label: "Draft" },
    { value: "READY", label: "Ready" },
    { value: "SENT", label: "Sent" },
] as const;

/** A notification shows about this much before Android cuts it. */
export const CAMPAIGN_TITLE_MAX = 65;
export const CAMPAIGN_BODY_MAX = 240;

export const campaignSchema = z.object({
    name: z.string().trim().min(1, "Give the campaign a name").max(120),
    // WhatsApp shows in the editor but cannot be chosen until it is wired.
    channel: z.enum(["PUSH"]),
    title: z.string().trim().min(1, "Write the notification title").max(CAMPAIGN_TITLE_MAX),
    body: z.string().trim().min(1, "Write the message").max(CAMPAIGN_BODY_MAX),
    // A page on the shop site the tap opens — a path, never another site.
    url: z
        .string()
        .trim()
        .max(300)
        .refine((v) => v === "" || (v.startsWith("/") && !v.startsWith("//")), "Use a shop page path, like /shop")
        .transform((v) => v || null),
    couponId: z.number().int().positive().nullable(),
    audience: z.enum(["ALL_PUSH"]),
    status: z.enum(["DRAFT", "READY"]),
});

export type CampaignInput = z.infer<typeof campaignSchema>;

export const CAMPAIGN_SELECT = {
    id: true,
    name: true,
    channel: true,
    title: true,
    body: true,
    url: true,
    couponId: true,
    coupon: { select: { id: true, code: true, name: true } },
    audience: true,
    status: true,
    sentAt: true,
    createdAt: true,
    updatedAt: true,
    createdBy: { select: { name: true } },
} as const;

export type CampaignRow = {
    id: number;
    name: string;
    channel: string;
    title: string;
    body: string;
    url: string | null;
    couponId: number | null;
    coupon: { id: number; code: string | null; name: string } | null;
    audience: string;
    status: string;
    sentAt: string | null;
    createdAt: string;
    updatedAt: string;
    createdBy: { name: string } | null;
};
