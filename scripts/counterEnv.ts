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
 * (`ensureAuthSecret` in electron/envCheck.ts), so a till's staff cookie is good on that till
 * only. A `WRITE_MODE=v_live` till signs in at the office with its own revocable counter
 * key instead (`src/shared/lib/counter/relayKey.ts`); before that it shipped the office's
 * secret, which let anyone holding an installer mint an office session for any user.
 *
 * NOT here, on purpose:
 *   - Every secret (since 2026-10-28; `DATABASE_URL` since 2026-10-24) — database
 *     password, backup, Cloudinary key/secret, Cloudflare/R2, courier, super admin login,
 *     WhatsApp and AI keys. The counter fetches them from the office at start
 *     (`POST /api/counter/config`, answered from Vercel's own env; the list is
 *     src/shared/lib/counter/officeConfigKeys.ts) with `COUNTER_INSTALL_SECRET`, and keeps
 *     a copy locked to that PC for offline starts (electron/remoteConfig.ts). Nothing
 *     secret is inside the installer, and a key changed on Vercel reaches every counter at
 *     its next start.
 *   - `DIRECT_URL` — only seeds and maintenance scripts read it.
 *   - Payments, Firebase, Resend, Sentry — no counter surface uses them.
 *
 * Still baked: the install secret and office address (needed to ask at all), the mode
 * dials, public `NEXT_PUBLIC_*` values, the staff email domain, and the read-only
 * release-download token — so a counter can still update itself to a fix even if the
 * office's config route is broken.
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
    // Not the database password itself — the key the till shows the office to be given
    // it (`/api/counter/config`). Same value as on Vercel. Changing it there stops a
    // leaked installer getting the password; tills already set up keep their copy.
    "COUNTER_INSTALL_SECRET",
    // The office origin that answers it. Optional when WRITE_API_URL is set.
    "COUNTER_CONFIG_URL",

    // ── Realtime ─────────────────────────────────────────────────────────────
    // None baked (owner, 2026-11-18): the office hands the primary's pair at every start
    // (REALTIME_URL / REALTIME_KEY, /api/counter/config), like DATABASE_URL, so a DB
    // switch on Vercel needs no rebuild. generate-counter-env checks the office sends it.

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

/** Office build extras — public only. Cloudinary's cloud name is inlined into the
 *  screens anyway; its key and secret come from the office (officeConfigKeys.ts). */
export const COUNTER_ENV_OFFICE_PUBLIC_KEYS: readonly string[] = ["NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME"];

/**
 * Which keys `generate-counter-env.ts` copies, per desktop variant. Only `office` is
 * built today; the `counter` variant is retired but kept for a possible revival
 * (docs/vocabulary.md). `full`/`public` desktop builds get the minimal set.
 */
export function counterEnvCopiedFor(mode: AppMode): readonly string[] {
    return mode === "office" ? [...COUNTER_ENV_COPIED, ...COUNTER_ENV_OFFICE_PUBLIC_KEYS] : COUNTER_ENV_COPIED;
}

/**
 * Keys whose absence produces a working-looking app that fails later, in a way that
 * points at something else entirely. Missing either one fails the build.
 */
export const COUNTER_ENV_REQUIRED: readonly string[] = [
    "COUNTER_INSTALL_SECRET",
    "INTERNAL_STAFF_EMAIL_DOMAINS",
];

/** Where a till asks for its database settings: `COUNTER_CONFIG_URL`, else the v_live
 *  relay target. electron/remoteConfig.ts resolves it the same way. */
export function counterConfigOrigin(env: ReadonlyMap<string, string>): string | null {
    const raw = env.get("COUNTER_CONFIG_URL") ?? env.get("WRITE_API_URL");
    if (!raw) return null;
    try {
        return new URL(raw).origin;
    } catch {
        return null;
    }
}

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
