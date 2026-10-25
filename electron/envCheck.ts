// ── Counter configuration (.env) ────────────────────────────────────────────
// The checks and loaders main.ts runs on a packaged start — see the "Load
// environment variables" note in main.ts for the two sources and their order.

import { app, dialog } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import * as dotenv from "dotenv";
import { writeJsonAtomic } from "./stateFile";

/**
 * Keys the app cannot work without, each with the symptom its absence produces.
 *
 * Inner arrays are alternatives — any one of them satisfies the entry.
 *
 * Why this exists: a half-filled config used to give the worst failure of all. The app
 * started, the login page rendered, and every sign-in was refused with "Invalid email or
 * password" — because the staff domain allowlist fails closed when
 * `INTERNAL_STAFF_EMAIL_DOMAINS` is unset (see
 * src/shared/lib/auth/staffEmailAllowlist.ts), and it is checked before the password is.
 * Nothing in the UI or the server log said which key was missing.
 *
 * `generate-counter-env.ts` already refuses to build without these, so on a normal
 * installer this check never fires. It stays because it covers what that one cannot: a
 * hand-written per-machine override that shadows a good baked value with a blank or
 * placeholder one.
 *
 * AUTH_SECRET is absent from this list on purpose — `ensureAuthSecret` guarantees it.
 */
const REQUIRED_ENV: Array<{ keys: string[]; why: string }> = [
    // DATABASE_URL is not checked here: it is fetched from the office once the app is
    // ready (electron/remoteConfig.ts), which reports its own failure.
    {
        keys: ["INTERNAL_STAFF_EMAIL_DOMAINS", "COMPANY_DOMAIN"],
        why: "staff login refuses every address — the domain allowlist fails closed",
    },
];

/**
 * Example values that are present but worthless, so they count as missing.
 *
 * A copied-verbatim `AUTH_SECRET` is worse than an absent one: it looks configured
 * and it signs real session cookies with a string published in this repository.
 */
const PLACEHOLDER_ENV_VALUES = new Set([
    "replace-me-with-a-generated-secret",
    "your-auth-secret-here",
]);

export function findMissingEnv(): string[] {
    const missing: string[] = [];
    for (const entry of REQUIRED_ENV) {
        const satisfied = entry.keys.some((key) => {
            const value = process.env[key]?.trim();
            return !!value && !PLACEHOLDER_ENV_VALUES.has(value);
        });
        if (!satisfied) missing.push(`${entry.keys.join(" or ")} — ${entry.why}`);
    }
    return missing;
}

/**
 * Name of the baked file, written by `scripts/generate-counter-env.ts`.
 *
 * Repeated rather than imported: this file is compiled by `electron/tsconfig.json`, whose
 * output path assumes `electron/` is the only root. Importing from `scripts/` would emit
 * `dist-electron/electron/main.js` and break the `main` entry in package.json. Change it in
 * `scripts/counterEnv.ts`, here, and in `build.extraResources` — which already spells it
 * out the same way.
 */
const COUNTER_ENV_FILE = "counter.env";

/**
 * Loads the baked configuration, letting a per-machine file override it.
 *
 * Order is the mechanism, not a detail: dotenv skips any variable already present, so the
 * override has to be read first to win.
 */
export function loadCounterEnv(): void {
    const userEnv = path.join(app.getPath("userData"), ".env");
    if (fs.existsSync(userEnv)) {
        dotenv.config({ path: userEnv });
        console.log(`[main] Applied per-machine override: ${userEnv}`);
    }

    const bakedEnv = path.join(process.resourcesPath, COUNTER_ENV_FILE);
    if (fs.existsSync(bakedEnv)) {
        dotenv.config({ path: bakedEnv });
        return;
    }

    // Only reachable if the installer was built without scripts/generate-counter-env.ts
    // having run, or with the extraResources entry for it removed. `verify-package.ts`
    // fails the build for exactly this, so it should never ship — but if it does, the
    // symptom otherwise arrives as an unexplained "every page fails" on the shop floor.
    dialog.showErrorBox(
        "AbeerSuite — installation incomplete",
        `AbeerSuite could not find its bundled configuration:\n\n${bakedEnv}\n\n` +
        "This installer was built incorrectly — the file is generated during packaging " +
        "and should always be present.\n\n" +
        "Report this to whoever built the installer. As a stop-gap, a configuration file " +
        `placed at\n\n${userEnv}\n\nis loaded instead (see '.env.example').`
    );
    app.exit(1);
}

/**
 * Session signing key: one per machine.
 *
 * No build ships `AUTH_SECRET` (scripts/counterEnv.ts), so this generates one: the
 * counter's Next server serves only http://127.0.0.1, so its cookies never cross
 * machines, and a secret read off one PC forges nothing on another or at the office. A
 * `WRITE_MODE=v_live` till signs in at the office with its counter key instead
 * (src/shared/lib/counter/relayKey.ts). A placeholder
 * from .env.example counts as absent — it would sign real cookies with a published string.
 *
 * Stored beside counter-installation-id.json, which survives upgrades, so an update does
 * not sign everybody out.
 */
export function ensureAuthSecret(): void {
    const configured = process.env.AUTH_SECRET?.trim();
    if (configured && !PLACEHOLDER_ENV_VALUES.has(configured)) return;

    const file = path.join(app.getPath("userData"), "auth-secret.json");
    let secret = "";
    try {
        if (fs.existsSync(file)) {
            const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as { authSecret?: unknown };
            if (typeof parsed.authSecret === "string" && parsed.authSecret.length >= 32) {
                secret = parsed.authSecret;
            }
        }
    } catch {
        // Corrupt or unreadable — replaced below rather than failing the launch.
    }

    if (!secret) {
        secret = crypto.randomBytes(32).toString("base64");
        try {
            writeJsonAtomic(file, { authSecret: secret });
            console.log(`[main] Generated this machine's session signing key: ${file}`);
        } catch (err) {
            // Not fatal — the app runs. But a fresh secret on every launch signs everyone
            // out at each restart, which looks like a login bug, so name the real cause.
            console.error(
                `[main] Could not save ${file} — staff will be signed out on every restart:`,
                err
            );
        }
    }

    process.env.AUTH_SECRET = secret;
}
