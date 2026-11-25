/**
 * WhatsApp number ids, WABA id, the Meta app id and the Connect-number setup id
 * live on Settings → App Settings (DB first, then .env) — see
 * constants/appSettings.ts. Numbers (owner, 2026-11-12): 96977 = OTP + fallback,
 * cloud only; 96996 = bills & replies (id 1426171653917236, set it there once
 * WhatsApp Manager shows it Connected); 96988 = AbeerSoft's own number.
 * The token stays in Vercel (META_WA_ACCESS_TOKEN).
 */

/** Largest file staff may attach in a Team chat (direct or group). */
export const TEAM_FILE_MAX_BYTES = 25 * 1024 * 1024;
/** File types a Team chat refuses — programs and scripts, nothing else. */
export const TEAM_FILE_BLOCKED_EXT = ["exe", "msi", "bat", "cmd", "com", "scr", "ps1", "vbs", "js", "jar", "apk"] as const;

/** Largest attachment staff may send, per WhatsApp type (Meta's own limits). */
export const WA_SEND_LIMIT_BYTES = {
    image: 5 * 1024 * 1024,
    video: 16 * 1024 * 1024,
    audio: 16 * 1024 * 1024,
    document: 100 * 1024 * 1024,
} as const;
/** A customer file bigger than this is not copied to R2 (row says "[too large]"). */
export const WA_KEEP_INBOUND_MAX_BYTES = 100 * 1024 * 1024;
/** How long a signed view / download link to an attachment stays valid. */
export const WA_MEDIA_LINK_SECONDS = 60 * 60;
/**
 * A customer conversation ends after this long with no message either way; the
 * next message opens a fresh one (and the selection menu is asked again).
 * Tune from how customers actually write.
 */
export const WA_CONVERSATION_TIMEOUT_MS = 2 * 60 * 60 * 1000;
/** A customer message that is exactly one of these (any case) ends the current
 *  conversation and starts a new one. */
export const WA_CONVERSATION_NEW_COMMANDS = ["/new", "#new", "/start", "new"] as const;

/** How long one message call to Meta may take. After it the result is "unclear"
 *  and nothing is sent again by itself (waSendOutcome.ts). */
export const WA_SEND_TIMEOUT_MS = 20_000;
/** A bill message still "pending" after this shows as not confirmed. */
export const WA_PENDING_STALE_MS = 5 * 60_000;

