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
    COUNTER_ENV_CONSTANTS,
    COUNTER_ENV_FILE,
    COUNTER_ENV_REQUIRED,
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

function main(): void {
    const rootDir = process.cwd();
    const outFile = path.join(rootDir, "resources", COUNTER_ENV_FILE);

    // .env.counter is the desktop-variant source of truth — where the owner sets
    // APP_MODE and LANDING_PAGE before an electron build (see scripts/electron-build.ts,
    // which loads it into process.env before this ever runs). Falls back to the root
    // .env, then to the real process environment so a CI runner can inject secrets
    // without writing a file at all.
    const counterEnvPath = path.join(rootDir, ".env.counter");
    const rootEnvPath = path.join(rootDir, ".env");
    const source = fs.existsSync(counterEnvPath)
        ? parseEnvFile(counterEnvPath)
        : fs.existsSync(rootEnvPath)
          ? parseEnvFile(rootEnvPath)
          : new Map<string, string>();
    if (!fs.existsSync(counterEnvPath) && !fs.existsSync(rootEnvPath)) {
        console.warn(
            "[generate-counter-env] No .env.counter or .env on this machine — reading the process environment instead."
        );
    }

    // APP_MODE decides which key set this variant gets (e.g. office additionally gets
    // the backup/restore keys) — resolved the same way electron-build.ts already did
    // when it loaded .env.counter into process.env, so both agree on the variant.
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
    for (const [key, value] of Object.entries(COUNTER_ENV_CONSTANTS)) {
        written.set(key, value);
    }

    const missingRequired = COUNTER_ENV_REQUIRED.filter((key) => !written.has(key));
    if (missingRequired.length > 0) {
        console.error(
            "[generate-counter-env] FATAL: this build would produce counters nobody can use.\n" +
            missingRequired.map((key) => `    ${key} is not set on this machine`).join("\n") +
            "\n\n  Installation is unattended, so there is no later step where an operator\n" +
            "  supplies these. Set them in .env and build again.\n" +
            "  DATABASE_URL absent → every page fails.\n" +
            "  INTERNAL_STAFF_EMAIL_DOMAINS absent → every staff login is refused with\n" +
            "  \"Invalid email or password\", before the password is checked.\n"
        );
        process.exit(1);
    }

    const header = [
        "# AbeerSuite counter configuration — GENERATED, DO NOT EDIT.",
        "#",
        "# Written by scripts/generate-counter-env.ts at build time from .env.counter (or the",
        "# build machine's .env), limited to the allowlist in scripts/counterEnv.ts for this",
        "# variant's APP_MODE. Rebuild to change it.",
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

main();
