/**
 * WhatsApp numbers (Meta phone_number_id — not secret; the token stays in .env).
 *
 * OTP always goes from the main number, META_WA_PHONE_NUMBER_ID in .env.
 * Bills, reminders and new staff replies go from WA_CONVERSATION_NUMBER_ID;
 * null = everything on the main number. A reply to a customer always goes back
 * from the number that customer last wrote to, whichever it was.
 *
 * Both numbers sit in the Network Service WABA, so one token and one set of
 * approved templates serve both.
 */

/** +91 88769 96996 — conversation-only number. Its Meta id is 1426171653917236
 *  (re-added 2026-11-12 after the Business-app trial; code-verified, display name in review, not yet registered): set it here only once
 *  WhatsApp Manager shows it Connected, or every bill would fail to send. */
export const WA_CONVERSATION_NUMBER_ID: string | null = null;

/** The "AbeerSuite coexistence" Embedded Signup setup — the Connect-number button
 *  on WhatsApp Templates. Public id, not a secret; META_WA_SIGNUP_CONFIG_ID in .env
 *  overrides it. The Meta app itself is META_APP_ID in .env (metaAppId()). */
export const META_WA_SIGNUP_CONFIG_ID = "1061577020211736";

/** Cloudflare R2 bucket for WhatsApp chat attachments (private; signed links
 *  only). Account id + keys live in .env: CLOUDFLARE_ACCOUNT_ID,
 *  R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY. */
export const R2_MESSAGES_BUCKET = "abeersuite-messages";

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

