/**
 * The settings Vercel (and GitHub) need for DB1 / DB2, as a red / amber / green list for
 * Settings → Backup & Restore (owner, 2026-11-17: "list the env we need … with red green
 * light so i know its set or need to set"). Names and set / not set only — never a value.
 */
import "server-only";
import { listActionSecretNames } from "@/shared/lib/backup/githubDispatch";

export type EnvLight = "green" | "amber" | "red" | "grey";

export interface EnvRow {
    key: string;
    what: string;
    neededFor: string;
    where: "Vercel" | "GitHub";
    /** null = could not check from here. */
    set: boolean | null;
    light: EnvLight;
}

const has = (k: string) => !!process.env[k]?.trim();

type Need = "required" | "db2" | "recommended";

function light(set: boolean | null, need: Need, db2: boolean): EnvLight {
    if (set === null) return "grey";
    if (set) return "green";
    if (need === "required") return "red";
    if (need === "db2") return db2 ? "red" : "amber";
    return "amber";
}

export async function envChecklist(): Promise<EnvRow[]> {
    const db2 = has("DATABASE_URL_2");
    const rows: EnvRow[] = [];
    const add = (key: string, what: string, neededFor: string, need: Need, set: boolean | null, where: EnvRow["where"] = "Vercel") =>
        rows.push({ key, what, neededFor, where, set, light: light(set, need, db2) });

    add("DATABASE_URL_1", "DB1 pooled connection (6543)", "Required", "required", has("DATABASE_URL_1"));
    add("DIRECT_URL_1", "DB1 direct connection (5432)", "Required — backups, migrations", "required", has("DIRECT_URL_1"));
    add("DATABASE_URL_2", "DB2 pooled connection (6543)", "Switch + nightly copy", "db2", has("DATABASE_URL_2"));
    add("DIRECT_URL_2", "DB2 direct connection (5432)", "Switch + nightly copy", "db2", has("DIRECT_URL_2"));
    add("NEXT_PUBLIC_SUPABASE_URL_1", "DB1 realtime project URL", "Required — live updates", "required", has("NEXT_PUBLIC_SUPABASE_URL_1"));
    add("NEXT_PUBLIC_SUPABASE_ANON_KEY_1", "DB1 realtime anon key", "Required — live updates", "required", has("NEXT_PUBLIC_SUPABASE_ANON_KEY_1"));
    add("NEXT_PUBLIC_SUPABASE_URL_2", "DB2 realtime project URL", "Live updates when DB2 is primary", "db2", has("NEXT_PUBLIC_SUPABASE_URL_2"));
    add("NEXT_PUBLIC_SUPABASE_ANON_KEY_2", "DB2 realtime anon key", "Live updates when DB2 is primary", "db2", has("NEXT_PUBLIC_SUPABASE_ANON_KEY_2"));
    add("CRON_SECRET", "Key for the backup / copy-done calls", "Recommended — else those calls need the Incoming API cron key", "recommended", has("CRON_SECRET"));

    // GitHub Actions secrets the workflows read. Names only, if the token may list them.
    const secrets = await listActionSecretNames();
    const gh = (key: string, what: string, neededFor: string, need: Need) =>
        add(key, what, neededFor, need, secrets ? secrets.has(key) : null, "GitHub");
    gh("APP_BASE_URL", "Office address, e.g. https://office…", "Hourly gate + copy-done report", "required");
    gh("CRON_SECRET", "Same value as on Vercel", "Hourly gate + copy-done report", "recommended");
    gh("DIRECT_DATABASE_URL", "Direct URL of the primary", "Sunday safety-net backup only", "recommended");
    gh("DROPBOX_APP_KEY", "Dropbox app key", "Every backup", "required");
    gh("DROPBOX_APP_SECRET", "Dropbox app secret", "Every backup", "required");
    gh("DROPBOX_REFRESH_TOKEN", "Dropbox refresh token", "Every backup", "required");

    return rows;
}
