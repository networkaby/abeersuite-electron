/**
 * Every outside program that calls into the app — Settings → Incoming API.
 * Plain data, shared by the server check (incomingApi.ts) and the page.
 */

export type IncomingId = "COWORK" | "PRODUCT_COPY" | "CRON" | "CALLS" | "SHIPROCKET" | "META_WA_VERIFY" | "META_WA_APP";

export type IncomingDef = {
    label: string;
    /** Who calls, and what for — shown on the page. */
    about: string;
    /** Where the other program must put it. */
    howSent: string;
    /** The env var it used before this page; still accepted. */
    envVar: string | null;
    /** With no secret anywhere: true = refuse every call (new callers), false = let it in as before. */
    closedWhenUnset: boolean;
    /** We make the key ("Make new key"), or it comes from the other side (Meta's app secret) and is pasted. */
    canGenerate: boolean;
    /** The doors this caller knocks on. */
    paths: string[];
};

export const INCOMING_APIS: Record<IncomingId, IncomingDef> = {
    COWORK: {
        label: "Google Business API",
        about: "Reads Google reviews and writes the shop's reply, makes social posts (text per channel, photos, time). Replies and posts follow the settings below; 1–2 star reviews are always saved as Draft for staff to check.",
        howSent: "Header  x-api-key: <key>",
        envVar: null,
        closedWhenUnset: true,
        canGenerate: true,
        paths: [
            "GET /api/agent/reviews",
            "POST /api/agent/reviews/{id}/reply",
            "GET /api/agent/posts",
            "POST /api/agent/posts",
            "PATCH /api/agent/posts/{id}",
            "DELETE /api/agent/posts/{id}",
            "POST /api/agent/posts/{id}/photos",
            "POST /api/agent/posts/{id}/photos/fit",
        ],
    },
    // Its own key (owner, 2026-11-07: "dont mix all"): a product-copy key can
    // neither reply to reviews nor post, and is switched off on its own.
    PRODUCT_COPY: {
        label: "Claude — Product copy",
        about: "Claude (Cowork / chat, the /product-copy skill) reads products waiting for shop copy and sends Verified copy. The server re-reads Claude's pages and checks every fact; the copy goes into the product's draft for staff — it never changes the live product or publishes.",
        howSent: "Header  x-api-key: <key>",
        envVar: null,
        closedWhenUnset: true,
        canGenerate: true,
        paths: [
            "GET /api/agent/products",
            "GET /api/agent/products/{id}",
            "POST /api/agent/products/{id}/copy",
            "POST /api/agent/read-page",
        ],
    },
    CRON: {
        label: "cron-job.org (timed jobs)",
        about: "Wakes the app for due reminders, email reminders, posts, Google reviews and the backup check. Vercel's own nightly backup still sends the CRON_SECRET env var, which keeps working.",
        howSent: "Header  Authorization: Bearer <key>",
        envVar: "CRON_SECRET",
        closedWhenUnset: false,
        canGenerate: true,
        paths: ["GET /api/cron/communications", "GET /api/cron/due-reminders", "GET /api/cron/email-reminders", "GET /api/cron/backup-due", "GET /api/cron/backup"],
    },
    CALLS: {
        label: "Phone system (call log)",
        about: "The PBX pushes every call record to CRM → Call Log.",
        howSent: "Header  x-api-key: <key>",
        envVar: "CALLS_API_KEY",
        closedWhenUnset: false,
        canGenerate: true,
        paths: ["POST /api/calls"],
    },
    SHIPROCKET: {
        label: "Shiprocket (delivery updates)",
        about: "Shiprocket tells us when a parcel moves. In Shiprocket: Settings → Webhooks, token type x-api-key.",
        howSent: "Header  x-api-key: <key>",
        envVar: "SHIPROCKET_WEBHOOK_TOKEN",
        closedWhenUnset: false,
        canGenerate: true,
        paths: ["POST /api/shop/delivery-updates"],
    },
    META_WA_VERIFY: {
        label: "WhatsApp webhook — verify token",
        about: "Any word you choose; type the same into Meta's webhook form. Meta checks it once when the webhook is set up.",
        howSent: "Meta sends it as hub.verify_token",
        envVar: "META_WA_VERIFY_TOKEN",
        closedWhenUnset: true,
        canGenerate: true,
        paths: ["GET /api/whatsapp/webhook"],
    },
    META_WA_APP: {
        label: "WhatsApp webhook — app secret",
        about: "Meta app → Settings → Basic → App secret. Meta signs every message with it; WhatsApp Connect uses it too. Comes from Meta — paste it, never make one.",
        howSent: "Meta signs each call (X-Hub-Signature-256)",
        envVar: "META_WA_APP_SECRET",
        closedWhenUnset: false,
        canGenerate: false,
        paths: ["POST /api/whatsapp/webhook"],
    },
};

/** Google Business API reply mode: DRAFT waits for staff; POST goes live (except 1–2 stars). */
export type GoogleReplyMode = "DRAFT" | "POST";
export const googleReplyMode = (s: Record<string, unknown>): GoogleReplyMode => (s.replyMode === "POST" ? "POST" : "DRAFT");
export const googleRules = (s: Record<string, unknown>): string => (typeof s.rules === "string" ? s.rules : "");

/** Google Business API posts: DRAFT waits for staff to check and schedule; SCHEDULE lets its times stand, and the post goes out by itself. */
export type GooglePostMode = "DRAFT" | "SCHEDULE";
export const googlePostMode = (s: Record<string, unknown>): GooglePostMode => (s.postMode === "SCHEDULE" ? "SCHEDULE" : "DRAFT");
export const googlePostRules = (s: Record<string, unknown>): string => (typeof s.postRules === "string" ? s.postRules : "");
