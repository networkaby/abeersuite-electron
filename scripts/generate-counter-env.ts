/**
 * Writes `resources/counter.env` — the configuration baked into a counter build.
 *
 * Runs inside `pnpm electron:build`, so `electron:pack` and `electron:dist` both get a
 * fresh file, and `electron-builder` ships it as `extraResources`. Which keys are written
 * is decided entirely by `counterEnv.ts`; this script only moves values and refuses to
 * produce a useless file.
 *
 * The output is NOT committed (see .gitignore). Note that `.env*` does not match
 * `counter.env` — the basename has to start with `.env` for that pattern — so the ignore
 * rule for it is explicit, and this file's whole reason for existing is that it contains
 * live credentials.
 *
 * Only KEY names are ever printed. Values are never written to the log.
 */
import * as fs from "fs";
import * as path from "path";
import {
    COUNTER_ENV_FILE,
    COUNTER_ENV_REQUIRED,
    counterConfigOrigin,
    counterEnvCopiedFor,
    parseEnvFile,
} from "./counterEnv";
import { parseAppMode } from "../src/shared/lib/appModeCore";

/**
 * Serialises one line, always double-quoted.
 *
 * `DATABASE_URL` carries `?pgbouncer=true&sslmode=require`, and dotenv reads an unquoted
 * value up to the first ` #` — so a value containing a hash would be silently truncated
 * into a connection string that fails at runtime with nothing pointing at the cause.
 * Quoting every value costs nothing and removes the whole class.
 */
function serialise(key: string, value: string): string {
    const escaped = value
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\r?\n/g, "\\n");
    return `${key}="${escaped}"`;
}

function relayTargetIsSafe(raw: string): boolean {
    try {
        const url = new URL(raw);
        if (url.protocol === "https:") return true;
        return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    } catch {
        return false;
    }
}

/**
 * Asks the office for the database settings exactly as a till will on its first start.
 *
 * The installer no longer carries `DATABASE_URL`, so a till that cannot get it from the
 * office has no database at all. Without this check, a build made before Vercel has
 * the secret (or the route) would install fine and break every counter it updates.
 */
async function officeAnswers(origin: string, secret: string): Promise<string | null> {
    try {
        const res = await fetch(new URL("/api/counter/config", origin), {
            method: "POST",
            headers: { Authorization: `Install ${secret}` },
            signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) return `the office answered HTTP ${res.status}`;
        const body = (await res.json()) as Record<string, unknown>;
        if (!(typeof body.DATABASE_URL === "string" && body.DATABASE_URL)) return "the office answered without DATABASE_URL";
        // The realtime pair comes only from the office — without it every till is
        // timer-only and other devices' vouchers reach its Day Book at the 15-minute pull.
        if (!(typeof body.REALTIME_URL === "string" && body.REALTIME_URL && typeof body.REALTIME_KEY === "string" && body.REALTIME_KEY)) {
            return "the office answered without REALTIME_URL / REALTIME_KEY (deploy d_office with this change first)";
        }
        return null;
    } catch (err) {
        return `the office could not be reached (${err instanceof Error ? err.message : String(err)})`;
    }
}

async function main(): Promise<void> {
    const rootDir = process.cwd();
    const outFile = path.join(rootDir, "resources", COUNTER_ENV_FILE);

    // Sourced from root `.env` ONLY.
    //
    // `.env.local` is deliberately NOT read here, even though Next.js layers it over
    // `.env` in dev and this script used to copy that behaviour. The two files mean
    // opposite things in this repo: `.env` holds the counter/office build's real
    // configuration, while `.env.local` holds the web-version dev overrides. Reading
    // both put the DEV file last, so it won — a `READ_MODE`/`WRITE_MODE` (or worse, a
    // `DATABASE_URL`) uncommented for an afternoon of web work would have been baked
    // into the next installer and shipped to every counter, with nothing in the build
    // log naming the cause. A build must not depend on which lines happen to be
    // commented out in a developer-local file.
    const rootEnvPath = path.join(rootDir, ".env");
    const source = new Map<string, string>();
    if (fs.existsSync(rootEnvPath)) {
        for (const [key, value] of parseEnvFile(rootEnvPath)) source.set(key, value);
    }
    if (!fs.existsSync(rootEnvPath)) {
        console.warn(
            "[generate-counter-env] No .env on this machine — reading the process environment instead."
        );
    }

    // APP_MODE decides which key set this variant gets (e.g. office additionally gets
    // the backup/restore keys) — resolved the same way electron-build.ts already did
    // when it loaded .env into process.env, so both agree on the variant.
    const mode = parseAppMode(source.get("APP_MODE") ?? process.env.APP_MODE);
    const keysToConsider = counterEnvCopiedFor(mode);
    console.log(`[generate-counter-env] APP_MODE=${mode} — copying ${keysToConsider.length} allowed key(s).`);

    const written = new Map<string, string>();
    const skipped: string[] = [];

    for (const key of keysToConsider) {
        const value = (source.get(key) ?? process.env[key] ?? "").trim();
        if (value) written.set(key, value);
        else skipped.push(key);
    }

    // The office's session secret never ships. Every machine generates its own
    // (`ensureAuthSecret`): its cookies never leave 127.0.0.1, and a v_live till signs
    // in at the office with its own counter key instead (counter/relayKey.ts).
    if (written.delete("AUTH_SECRET")) {
        console.log("[generate-counter-env] AUTH_SECRET withheld — each machine generates its own.");
    }

    const missingRequired = COUNTER_ENV_REQUIRED.filter((key) => !written.has(key));
    if (missingRequired.length > 0) {
        console.error(
            "[generate-counter-env] FATAL: this build would produce counters nobody can use.\n" +
            missingRequired.map((key) => `    ${key} is not set on this machine`).join("\n") +
            "\n\n  Installation is unattended, so there is no later step where an operator\n" +
            "  supplies these. Set them in .env and build again.\n" +
            "  COUNTER_INSTALL_SECRET absent → the till cannot fetch its database settings.\n" +
            "  INTERNAL_STAFF_EMAIL_DOMAINS absent → every staff login is refused with\n" +
            "  \"Invalid email or password\", before the password is checked.\n"
        );
        process.exit(1);
    }

    // The till fetches DATABASE_URL from the office with the install secret.
    const configOrigin = counterConfigOrigin(written);
    const configProblem = !configOrigin
        ? "COUNTER_CONFIG_URL (or WRITE_API_URL) is not set — the till would not know where to fetch its database settings"
        : !relayTargetIsSafe(configOrigin)
            ? "COUNTER_CONFIG_URL must be https:// (http:// only for localhost) — the request carries the install secret"
            : await officeAnswers(configOrigin, written.get("COUNTER_INSTALL_SECRET")!);
    if (configProblem) {
        console.error(
            "[generate-counter-env] FATAL: a till built now could not get its database settings.\n" +
            `    ${configProblem}\n\n` +
            "  Set COUNTER_INSTALL_SECRET on Vercel (same value as .env), deploy the office,\n" +
            "  and build again. Every till updated by this build fetches DATABASE_URL there.\n"
        );
        process.exit(1);
    }
    console.log(`[generate-counter-env] ${configOrigin} hands out the database settings — OK.`);

    // A v_live till relays its writes to the office, so it needs somewhere safe to send them.
    if (written.get("WRITE_MODE") === "v_live") {
        const problems: string[] = [];
        const apiUrl = written.get("WRITE_API_URL");
        if (!apiUrl) {
            problems.push("WRITE_API_URL is not set — the till would have nowhere to relay to");
        } else if (!relayTargetIsSafe(apiUrl)) {
            // Every relayed write carries the staff session cookie; across the WAN that
            // must be https. Plain http is allowed only for an office on this machine.
            problems.push("WRITE_API_URL must be https:// (http:// only for localhost) — the relay sends this counter's key");
        }
        if (problems.length > 0) {
            console.error(
                "[generate-counter-env] FATAL: WRITE_MODE=v_live is not fully configured.\n" +
                problems.map((p) => `    ${p}`).join("\n") +
                "\n\n  Fix .env and build again, or set WRITE_MODE=local for this build.\n"
            );
            process.exit(1);
        }
    }

    const header = [
        "# AbeerSuite counter configuration — GENERATED, DO NOT EDIT.",
        "#",
        "# Written by scripts/generate-counter-env.ts at build time from the build machine's",
        "# .env, limited to the allowlist in scripts/counterEnv.ts for this variant's APP_MODE.",
        "# .env.local is NOT read — it holds web-version dev overrides. Rebuild to change it.",
        "#",
        "# A counter may override any of these per machine by placing its own .env at",
        "# %APPDATA%/abeersuite-electron/.env — that file is loaded first and wins.",
        "",
    ].join("\n");

    const body = [...written].map(([key, value]) => serialise(key, value)).join("\n");

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, `${header}${body}\n`, "utf8");

    console.log(
        `[generate-counter-env] Wrote resources/${COUNTER_ENV_FILE} — ${written.size} keys ` +
        `(${fs.statSync(outFile).size} bytes):`
    );
    console.log(`    ${[...written.keys()].join(", ")}`);
    if (skipped.length > 0) {
        // Named rather than silent: each of these is a counter feature that will fail at
        // the point of use, and the error it produces ("DROPBOX_APP_KEY is not set.")
        // surfaces to a staff member, not to whoever built the installer.
        console.warn(`[generate-counter-env] Not set on this machine, so not shipped: ${skipped.join(", ")}`);
    }
}

void main();
