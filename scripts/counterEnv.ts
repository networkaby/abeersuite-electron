/**
 * The contract for the configuration baked into a counter build.
 *
 * Shared by the two sides that have to agree about it:
 *   - `generate-counter-env.ts` writes `resources/counter.env` from these keys
 *   - `verify-package.ts` fails the build if the packaged file holds anything else
 *
 * ── Why anything is baked in at all ──────────────────────────────────────────
 * This variant is internal only — company-owned counters, staff-operated, never sold and
 * never handed to a customer. Installation therefore has to be unattended, so the
 * credentials travel inside the installer instead of being copied onto each machine by
 * hand.
 *
 * The 0.1.0 build already did that, by ACCIDENT, with the build machine's entire ~60-key
 * `.env`: payment-gateway salts, Cloudinary, Firebase, WhatsApp, Resend, Sentry and a
 * GitHub token, in plaintext outside the asar. This list is the whole difference between
 * that and a deliberate, reviewed set. A counter gets what a counter uses and nothing
 * else — and the packaging gate enforces it, rather than trusting whoever next edits an
 * `extraResources` filter to remember why it was written that way.
 *
 * `AUTH_SECRET` is NOT here (since 2026-10-13). Every machine generates its own
 * (`ensureAuthSecret` in electron/main.ts), so a till's staff cookie is good on that till
 * only. A `WRITE_MODE=v_live` till signs in at the office with its own revocable counter
 * key instead (`src/shared/lib/counter/relayKey.ts`); before that it shipped the office's
 * secret, which let anyone holding an installer mint an office session for any user.
 *
 * NOT here, on purpose:
 *   - `DIRECT_URL` — only seeds and maintenance scripts read it, so the direct 5432
 *     connection string has no reason to sit on a shop PC.
 *   - `SUPER_ADMIN_PASSWORD` on the `counter` variant — see `COUNTER_ENV_SUPER_ADMIN_KEYS`:
 *     only the `office` build carries the super admin login.
 *   - Payments, Firebase, Meta WA, Resend, Sentry — no counter surface uses them, and
 *     each one is a credential that cannot be un-shipped once installed.
 *   - Cloudinary on the `counter` variant — see `COUNTER_ENV_CLOUDINARY_KEYS`: only the
 *     `office` build uploads images.
 *   - Cloudflare on the `counter` variant — see `COUNTER_ENV_CLOUDFLARE_KEYS`: only the
 *     `office` build edits mail forwarding.
 */

import * as fs from "fs";
import type { AppMode } from "../src/shared/lib/appModeCore";

/** File name, both at `resources/<name>` in the build and next to the packaged app. */
export const COUNTER_ENV_FILE = "counter.env";

/**
 * Copied verbatim from the build machine's `.env` (see
 * `generate-counter-env.ts`), on every desktop variant regardless of `APP_MODE`.
 *
 * A key missing there is reported by name and skipped, so a build is never silently
 * configured with a stale value.
 */
export const COUNTER_ENV_COPIED: readonly string[] = [
    // ── Data path ────────────────────────────────────────────────────────────
    // Everything the app reads or writes goes through Prisma over this connection.
    "DATABASE_URL",

    // ── Realtime nudges ──────────────────────────────────────────────────────
    // Next inlines NEXT_PUBLIC_* into the bundles at build time, so the browser half
    // already has these. They are copied for the server half in
    // shared/lib/realtime/serverPublish.ts, which reads process.env at runtime.
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",

    // ── Staff login ──────────────────────────────────────────────────────────
    // Absent, the domain allowlist fails closed and every sign-in is refused with
    // "Invalid email or password" before the password is even looked at.
    "INTERNAL_STAFF_EMAIL_DOMAINS",

    // ── Operating mode ───────────────────────────────────────────────────────
    "APP_MODE",
    // Two independent dials. READ_MODE (live|shadow|local) decides where reads are
    // served from; WRITE_MODE (live|local|v_live) decides where writes land, and picks
    // the client the other rides on. Both default to `live`, so a counter that sets
    // neither behaves exactly as it did before either existed.
    "READ_MODE",
    "WRITE_MODE",
    // v_live only: the office origin the till relays its writes to.
    "WRITE_API_URL",
    // Electron window's start URL — see src/shared/lib/appModeCore.ts's
    // resolveLandingPage(). A path only, validated at load time; not a credential.
    "LANDING_PAGE",

    // ── Auto-update ──────────────────────────────────────────────────────────
    // GITHUB_DOWNLOAD_UPDATE_REPO ("owner/repo") deliberately points at a separate,
    // private, release-artifacts-only repo — not the source repo.
    // GITHUB_DOWNLOAD_UPDATE_PAT_TOKEN is a fine-grained PAT, "Contents: Read-only",
    // scoped to ONLY that repo, so a leaked installer exposes at most the release
    // artifacts every counter already has on disk, never the private codebase. Both
    // optional: absent here, setupAutoUpdater() logs and skips update checks rather
    // than failing the boot (electron/main.ts).
    "GITHUB_DOWNLOAD_UPDATE_REPO",
    "GITHUB_DOWNLOAD_UPDATE_PAT_TOKEN",
];

/**
 * Backup/restore keys — Dropbox-listing + GitHub-Actions-triggered dump/restore.
 *
 * Withheld from the `counter` variant on purpose: a till has no business triggering a
 * database restore (the most destructive call in the app — see the comment in
 * `src/app/api/settings/restore/route.ts`), and `backupAvailability()`
 * (`src/shared/lib/backup/availability.ts`) already turns the whole feature off
 * everywhere, with a gentle in-app message, purely from these keys being absent — see
 * `BackupRestorePanel.tsx`. Granted to `office`, since admin/management is exactly who
 * should be able to run a backup or restore from the desktop app.
 */
export const COUNTER_ENV_BACKUP_KEYS: readonly string[] = [
    "DROPBOX_APP_KEY",
    "DROPBOX_APP_SECRET",
    "DROPBOX_REFRESH_TOKEN",
    "DROPBOX_FOLDER",
    "GITHUB_DISPATCH_TOKEN",
    "GITHUB_REPO",
    "GITHUB_WORKFLOW_REF",
];

/**
 * Image-upload keys — `GET /api/upload-signature` signs every upload with them
 * (`src/shared/lib/cloudinary.ts`): product photos (Add and From URL) and staff avatars.
 *
 * That route is a read, so `WRITE_MODE=v_live` never relays it — it runs on this PC,
 * and without these keys it answers "Cloudinary not configured". Granted to `office`
 * on the owner's call (2026-09-27), over relaying the signature to the office. The cost:
 * whoever holds an office installer can upload to and delete from the Cloudinary
 * account. The `counter` variant has no upload screen, so it keeps going without.
 */
export const COUNTER_ENV_CLOUDINARY_KEYS: readonly string[] = [
    "NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
];

/**
 * Cloudflare keys — Me → Security → Forward Email (`src/shared/lib/email/cloudflareRouting.ts`)
 * and Cloudflare R2 bucket storage for WhatsApp attachments (`src/shared/lib/storage/r2.ts`).
 *
 * Mail forwarding and attachment signing/viewing are reads, so `v_live` never relays them — without
 * these keys the desktop app says "Attachment not saved".
 * Granted to `office` desktop variant; cost: puts R2 storage keys on every office till.
 */
export const COUNTER_ENV_CLOUDFLARE_KEYS: readonly string[] = [
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_ZONE_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
];

/**
 * Which keys `generate-counter-env.ts` copies, per desktop variant. `full`/`public`
 * are Vercel modes in practice — if a desktop build is ever made with one of them
 * (allowed, just unusual — see `electron-build.ts`), it gets the same minimal set as
 * `counter`: withholding backup, upload and mail keys by default is the safer failure mode.
 */
export function counterEnvCopiedFor(mode: AppMode): readonly string[] {
    return mode === "office"
        ? [...COUNTER_ENV_COPIED, ...COUNTER_ENV_BACKUP_KEYS, ...COUNTER_ENV_CLOUDINARY_KEYS,
        ...COUNTER_ENV_CLOUDFLARE_KEYS, ...COUNTER_ENV_COURIER_KEYS, ...COUNTER_ENV_SUPER_ADMIN_KEYS,
        ...COUNTER_ENV_WHATSAPP_KEYS, ...COUNTER_ENV_AI_KEYS]
        : COUNTER_ENV_COPIED;
}

/**
 * Keys whose absence produces a working-looking app that fails later, in a way that
 * points at something else entirely. Missing either one fails the build.
 */
export const COUNTER_ENV_REQUIRED: readonly string[] = [
    "DATABASE_URL",
    "INTERNAL_STAFF_EMAIL_DOMAINS",
];

/** Every key the packaged file is allowed to contain, for the given variant. Used by
 *  `verify-package.ts`'s packaging gate. */
export function counterEnvAllowedFor(mode: AppMode): ReadonlySet<string> {
    return new Set(counterEnvCopiedFor(mode));
}

/**
 * Parses a `.env`-style file into key/value pairs, the way dotenv itself would.
 *
 * The inline-comment rule is the part that matters, and it is not cosmetic. dotenv
 * captures an unquoted value with `[^#\r\n]+` — it stops at the FIRST `#` and trims — but
 * a quoted value keeps everything inside the quotes. This repo's `.env` really does write
 * `DROPBOX_FOLDER=name        # empty = app-folder root`, so a parser that kept the tail
 * would hand the generator a folder name with an English sentence stuck to it, and the
 * generator quotes every value it writes — which would make dotenv preserve the sentence on
 * the counter. Backup listing would then point at a folder that does not exist, on every
 * machine, with nothing in the logs naming the cause.
 *
 * It also makes `verify-package.ts`'s value scan honest: searching the package for a secret
 * with a comment glued to it would never match, and the gate would report PASS over a real
 * leak.
 *
 * Empty values are dropped — a bare `KEY=` configures nothing, and treating it as present
 * would let a build pass its required-key check with no credential in it.
 */
export function parseEnvFile(file: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();

        const quote = value[0];
        if ((quote === '"' || quote === "'") && value.lastIndexOf(quote) > 0) {
            value = value.slice(1, value.lastIndexOf(quote));
        } else {
            const hash = value.indexOf("#");
            if (hash >= 0) value = value.slice(0, hash).trim();
        }

        if (value) out.set(key, value);
    }
    return out;
}


/**
 * Courier keys — Change courier prices Shiprocket/Shipway through a GET, which v_live
 * never relays. Office only; the desktop app is private (2026-09-28).
 * REMOVE before any public desktop release.
 */
export const COUNTER_ENV_COURIER_KEYS: readonly string[] = [
    "SHIPROCKET_EMAIL",
    "SHIPROCKET_PASSWORD",
    "SHIPWAY_USERNAME",
    "SHIPWAY_LICENSE",
    "SHIPWAY_TOKEN",
    "SHIPWAY_API_BASE",
];

/**
 * The env super admin login (`checkSuperAdminEnv` in authorizeStaff.ts) — the way into a
 * till when no staff login works. The email alone only let Permissions show the super
 * admin as full access; the password was added on the owner's call (2026-09-30), office
 * only like the rest. The cost: a full-authority login in plaintext on every till and in
 * every installer. REMOVE before any public desktop release.
 */
export const COUNTER_ENV_SUPER_ADMIN_KEYS: readonly string[] = ["SUPER_ADMIN_EMAIL", "SUPER_ADMIN_PASSWORD"];

/**
 * Meta WhatsApp keys — Settings → WhatsApp Templates reads approval status and sends a
 * test through GETs / local calls that v_live never relays (`metaTemplates.ts`), so without
 * them the page says "Sending for approval is not set up". Office only (2026-10-07), same
 * cost as the rest: whoever holds an office installer can send as the business number.
 */
export const COUNTER_ENV_WHATSAPP_KEYS: readonly string[] = [
    "META_WA_ACCESS_TOKEN",
    "META_WA_PHONE_NUMBER_ID",
    "META_WA_BUSINESS_ACCOUNT_ID",
];
/**
 * AI keys for product copy. With them the till calls the AI itself instead of
 * relaying through the office (`relayPolicy.ts` LOCAL_WHEN_KEYED) — one hop faster.
 * Office only, like the rest: a counter build without them simply keeps relaying.
 */
export const COUNTER_ENV_AI_KEYS: readonly string[] = [
    // Opens the keys pasted on Settings → AI Setup (ai_keys.secretEnc). Must match Vercel's.
    "AI_KEY_SECRET",
    // The .env names today's AI Setup rows point at (migration 20261021120000_ai_setup) —
    // a till missing one skips that key.
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY1",
    "GOOGLE_GENERATIVE_AI_API_KEY2",
    "GOOGLE_GENERATIVE_AI_API_KEY3",
    "GOOGLE_GENERATIVE_AI_API_KEY4",
    "GOOGLE_GENERATIVE_AI_API_KEY5",
    "GOOGLE_AI_SEARCH_API_KEY",
];
