/**
 * The settings Vercel (and GitHub) need for DB1 / DB2, as a red / amber / green list for
 * Settings → Backup & Restore (owner, 2026-11-17: "list the env we need … with red green
 * light so i know its set or need to set"). Names and set / not set only — never a value.
 *
 * Grouped DB1 / DB2 / Vercel cron / GitHub / Dropbox (owner, same day). GitHub secrets
 * cannot be read without a Secrets-read token, so a recent nightly copy stands as proof
 * instead (owner: "nightly backup running so we can say git and drop box is ok"):
 *   copy started  → Vercel cron reached the app and the app reached GitHub;
 *   copy reported → GitHub ran, the Dropbox upload passed (the copy step runs only after
 *                   it), and APP_BASE_URL + CRON_SECRET reached the app.
 */
import "server-only";
import { listActionSecretNames } from "@/shared/lib/backup/githubDispatch";

export type EnvLight = "green" | "amber" | "red" | "grey";
export type EnvGroup = "DB1" | "DB2" | "Vercel cron" | "GitHub" | "Dropbox";

export interface EnvRow {
    group: EnvGroup;
    key: string;
    what: string;
    neededFor: string;
    where: "Vercel" | "GitHub";
    /** null = could not check from here. */
    set: boolean | null;
    /** What the Status column says. */
    note: string;
    light: EnvLight;
}

/** The nightly copy's times, from `_db_switch` (dbSwitchStatus().copy). */
export interface CopyProof {
    startedAt: string | null;
    copiedAt: string | null;
}

/** A nightly run older than this proves nothing about tonight. */
const PROOF_MS = 26 * 3600_000;

const has = (k: string) => !!process.env[k]?.trim();

type Need = "required" | "db2" | "recommended";

function light(set: boolean | null, need: Need, db2: boolean): EnvLight {
    if (set === null) return "grey";
    if (set) return "green";
    if (need === "required") return "red";
    if (need === "db2") return db2 ? "red" : "amber";
    return "amber";
}

const fmt = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

export async function envChecklist(copy?: CopyProof): Promise<EnvRow[]> {
    const db2 = has("DATABASE_URL_2");
    const rows: EnvRow[] = [];
    const add = (group: EnvGroup, key: string, what: string, neededFor: string, need: Need, set: boolean | null, where: EnvRow["where"] = "Vercel", note?: string) =>
        rows.push({
            group, key, what, neededFor, where, set,
            note: note ?? (set === null ? "Cannot check here" : set ? "Set" : "Not set"),
            light: light(set, need, db2),
        });

    for (const n of [1, 2] as const) {
        const g: EnvGroup = n === 1 ? "DB1" : "DB2";
        const need: Need = n === 1 ? "required" : "db2";
        const why = n === 1 ? "Required" : "Switch + nightly copy";
        const rt = n === 1 ? "Required — live updates" : "Live updates when DB2 is primary";
        add(g, `DATABASE_URL_${n}`, `${g} pooled connection (6543)`, why, need, has(`DATABASE_URL_${n}`));
        add(g, `DIRECT_URL_${n}`, `${g} direct connection (5432)`, n === 1 ? "Required — backups, migrations" : why, need, has(`DIRECT_URL_${n}`));
        add(g, `NEXT_PUBLIC_SUPABASE_URL_${n}`, `${g} realtime project URL`, rt, need, has(`NEXT_PUBLIC_SUPABASE_URL_${n}`));
        add(g, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY_${n}`, `${g} realtime publishable key`, rt, need, has(`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY_${n}`));
    }

    // ── Proof from the nightly run ──
    const now = Date.now();
    const recent = (iso: string | null | undefined) => (iso && now - new Date(iso).getTime() < PROOF_MS ? new Date(iso) : null);
    const started = recent(copy?.startedAt);
    const copied = recent(copy?.copiedAt);
    // A copy report only counts for the run that was started last.
    const ran = copied && (!started || copied >= started) ? copied : null;
    const ranNote = ran ? `Working — nightly copy ${fmt(ran)}` : undefined;

    const cronSet = has("CRON_SECRET");
    add("Vercel cron", "CRON_SECRET", "Key for the backup / copy-done calls", "Recommended — else those calls need the Incoming API cron key", "recommended", cronSet);
    rows.push({
        group: "Vercel cron",
        key: "Nightly cron (vercel.json)",
        what: "Starts the backup every night",
        neededFor: "Every nightly backup + copy",
        where: "Vercel",
        set: started ? true : copy ? false : null,
        note: started ? `Ran ${fmt(started)}` : copy ? "No run in the last 26 hours" : "Cannot check here",
        light: started ? "green" : copy && db2 ? "red" : "grey",
    });

    // GitHub Actions secrets the workflows read. Names if the token may list them, else
    // the nightly copy vouches for the ones it used.
    const secrets = await listActionSecretNames();
    const gh = (group: EnvGroup, key: string, what: string, neededFor: string, need: Need, provenByRun: boolean) => {
        if (secrets) return add(group, key, what, neededFor, need, secrets.has(key), "GitHub");
        if (provenByRun && ran) return add(group, key, what, neededFor, need, true, "GitHub", ranNote);
        add(group, key, what, neededFor, need, null, "GitHub");
    };
    gh("GitHub", "APP_BASE_URL", "Office address, e.g. https://office…", "Hourly gate + copy-done report", "required", true);
    gh("GitHub", "CRON_SECRET", "Same value as on Vercel", "Hourly gate + copy-done report", "recommended", true);
    gh("GitHub", "DIRECT_DATABASE_URL", "Direct URL of the primary", "Sunday safety-net backup only", "recommended", false);
    gh("Dropbox", "DROPBOX_APP_KEY", "Dropbox app key", "Every backup", "required", true);
    gh("Dropbox", "DROPBOX_APP_SECRET", "Dropbox app secret", "Every backup", "required", true);
    gh("Dropbox", "DROPBOX_REFRESH_TOKEN", "Dropbox refresh token", "Every backup", "required", true);

    return rows;
}
