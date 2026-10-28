/**
 * Secrets a counter fetches from the office at start instead of carrying them in its
 * installer (owner, 2026-10-28: "move every secret out of counter.env").
 *
 * `POST /api/counter/config` answers with these from Vercel's own env to a caller
 * holding `COUNTER_INSTALL_SECRET`; `electron/remoteConfig.ts` keeps them locked to that
 * PC (Windows encryption) so a counter with no internet still starts. A key changed on
 * Vercel reaches every counter at its next start.
 *
 * Pure — no Next, Prisma or `server-only` — so `scripts/counterEnv.ts` can read it too.
 * That file keeps only what is not secret, or what must work before the office answers.
 *
 * One install secret for every desktop build: the `APP_MODE=counter` variant is retired
 * (docs/vocabulary.md). If it is ever revived, it must not get the office-only groups —
 * gate them before building it.
 *
 * Never list `DIRECT_URL`, `AUTH_SECRET` or `COUNTER_INSTALL_SECRET` here.
 */

/** Every counter needs it to start at all. */
export const COUNTER_CONFIG_REQUIRED = ["DATABASE_URL"] as const;

/** Backup/restore — Dropbox listing + GitHub-Actions dump/restore (`backupAvailability()`
 *  turns the feature off when absent). */
const BACKUP_KEYS = [
    "DROPBOX_APP_KEY",
    "DROPBOX_APP_SECRET",
    "DROPBOX_REFRESH_TOKEN",
    "DROPBOX_FOLDER",
    "GITHUB_DISPATCH_TOKEN",
    "GITHUB_REPO",
    "GITHUB_WORKFLOW_REF",
    // Workflow file names; unset, both sides fall back to backup.yml / restore.yml.
    "GITHUB_BACKUP_WORKFLOW",
    "GITHUB_RESTORE_WORKFLOW",
];

/** Image upload — `GET /api/upload-signature` (a read, so it runs on the counter). */
const CLOUDINARY_KEYS = ["CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"];

/** Me → Security → Forward Email, and R2 storage for WhatsApp attachments. */
const CLOUDFLARE_KEYS = [
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_ZONE_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
];

/** Change courier prices — Shiprocket/Shipway through a GET. */
const COURIER_KEYS = [
    "SHIPROCKET_EMAIL",
    "SHIPROCKET_PASSWORD",
    "SHIPWAY_USERNAME",
    "SHIPWAY_LICENSE",
    "SHIPWAY_TOKEN",
    "SHIPWAY_API_BASE",
];

/** The env super admin login (`checkSuperAdminEnv`) — the way in when no staff login works. */
const SUPER_ADMIN_KEYS = ["SUPER_ADMIN_EMAIL", "SUPER_ADMIN_PASSWORD"];

/** Campaigns → Channels: connection status and the listing picker are GETs, so they run
 *  on the counter and need the OAuth client. The redirect URL keeps sign-in on the office. */
const GOOGLE_BUSINESS_KEYS = ["GOOGLE_BUSINESS_CLIENT_ID", "GOOGLE_BUSINESS_CLIENT_SECRET", "GOOGLE_BUSINESS_REDIRECT_URL"];

/** Settings → WhatsApp Templates: approval status and test sends run on the counter. */
const WHATSAPP_KEYS = ["META_WA_ACCESS_TOKEN", "META_WA_PHONE_NUMBER_ID", "META_WA_BUSINESS_ACCOUNT_ID"];

/** Opens the keys pasted on Settings → AI Setup. The `.env` keys the AI Setup rows name
 *  are added at answer time from `ai_keys.envName`, so a new one needs no code change. */
const AI_KEYS = ["AI_KEY_SECRET"];

/** Fixed keys handed out besides the required ones. Optional: a key Vercel lacks is
 *  simply not sent, and that one feature stays off on the counter, as before. */
export const COUNTER_CONFIG_OPTIONAL: readonly string[] = [
    ...BACKUP_KEYS,
    ...CLOUDINARY_KEYS,
    ...CLOUDFLARE_KEYS,
    ...COURIER_KEYS,
    ...SUPER_ADMIN_KEYS,
    ...GOOGLE_BUSINESS_KEYS,
    ...WHATSAPP_KEYS,
    ...AI_KEYS,
];

/** An AI Setup row's `.env` name is handed out only if it looks like an AI key
 *  (GOOGLE_AI_SEARCH_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY3 …) — so a row naming, say, a
 *  payment salt cannot carry that secret to every counter. */
export const AI_ENV_NAME = /^[A-Z][A-Z0-9_]*_API_KEY\d*$/;

/** Never handed out, whatever an AI Setup row names. */
export const COUNTER_CONFIG_NEVER: ReadonlySet<string> = new Set([
    "DIRECT_URL",
    "AUTH_SECRET",
    "COUNTER_INSTALL_SECRET",
    "NEXTAUTH_SECRET",
]);
