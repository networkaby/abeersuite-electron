/**
 * Switching the primary between DB1 and DB2, and the nightly copy's bookkeeping.
 *
 * The rule (owner, 2026-11-17): a switch is allowed only after a successful nightly
 * copy into staging and before 08:00 IST the next morning. In that window the two
 * databases are the same, so a switch is invisible to everyone. Outside it, a counter
 * could be half a day ahead of the database it would be moved to.
 *
 * Belt and braces, because "the clock says it is safe" is not proof:
 *   1. the window (copied_at → next 08:00 IST), one switch per copy;
 *   2. no copy running right now;
 *   3. both databases answer, and every table has the same row count and latest
 *      "updatedAt" on both — a sale made at 1 AM, or a migration applied to only one,
 *      refuses the switch;
 *   4. staging is READ-ONLY at the database level (`default_transaction_read_only`).
 *      A server or counter still on the old pointer cannot write to it — the write fails
 *      loudly instead of landing in the database that tonight's copy will overwrite.
 */
import "server-only";
import type { PoolClient } from "pg";
import { projectRefFromDbUrl } from "@/shared/lib/backup/dbUrl";
import { dbTarget, isDualDb, otherDb, type DbId } from "./dbTargets";
import { readSwitchRow, refreshPrimary, SWITCH_TABLE_SQL, withDb, type SwitchRow } from "./dbPrimary";

/** A copy that has not reported back within this long is treated as dead. */
const COPY_STALE_MS = 2 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
/** 08:00 IST — the end of the switch window. */
const WINDOW_END_HOUR_IST = 8;
/** A copy finishing from 20:00 IST counts as the night copy. */
const NIGHT_START_HOUR_IST = 20;

/** The first 08:00 IST strictly after `from`. */
export function nextWindowEnd(from: Date): Date {
    const ist = new Date(from.getTime() + IST_OFFSET_MS);
    const end = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), WINDOW_END_HOUR_IST));
    if (end.getTime() <= ist.getTime()) end.setUTCDate(end.getUTCDate() + 1);
    return new Date(end.getTime() - IST_OFFSET_MS);
}

/** Runs `fn` in a transaction that may write even on a read-only (staging) database. */
async function writeTx<T>(id: DbId, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    return withDb(id, async (c) => {
        await c.query("BEGIN READ WRITE");
        try {
            const out = await fn(c);
            await c.query("COMMIT");
            return out;
        } catch (e) {
            await c.query("ROLLBACK").catch(() => {});
            throw e;
        }
    });
}

const setReadOnlySql = (on: boolean) =>
    `DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET default_transaction_read_only = ${on ? "on" : "off"}', current_database()); END $$`;

async function ensureRow(c: PoolClient, primary: DbId): Promise<void> {
    await c.query(SWITCH_TABLE_SQL);
    await c.query(
        `INSERT INTO "_db_switch" (only_row, primary_db, switched_at) VALUES (true, $1, 'epoch') ON CONFLICT (only_row) DO NOTHING`,
        [primary],
    );
}

// ── Status ──────────────────────────────────────────────────────────────────

export interface DbInfo {
    id: DbId;
    role: "primary" | "staging";
    projectRef: string;
    reachable: boolean;
    readOnly: boolean | null;
}

export interface SwitchWindow {
    open: boolean;
    /** When the current window closes (ISO), if a copy opened one. */
    until: string | null;
    /** Why it is closed — plain words for the Settings screen. */
    reason: string | null;
}

export interface DbSwitchStatus {
    dual: boolean;
    primary: DbId;
    staging: DbId | null;
    dbs: DbInfo[];
    copy: {
        startedAt: string | null;
        copiedAt: string | null;
        failedAt: string | null;
        into: string | null;
        file: string | null;
    };
    window: SwitchWindow;
}

async function probe(id: DbId): Promise<{ reachable: boolean; readOnly: boolean | null }> {
    try {
        const ro = await withDb(id, (c) => c.query<{ ro: string }>("SELECT current_setting('default_transaction_read_only') AS ro"));
        return { reachable: true, readOnly: ro.rows[0]?.ro === "on" };
    } catch {
        return { reachable: false, readOnly: null };
    }
}

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

/** The window as the primary's row describes it. Pure apart from `now`. */
export function windowFrom(row: SwitchRow | null, staging: DbId, now = new Date()): SwitchWindow {
    const closed = (reason: string, until: Date | null = null): SwitchWindow => ({ open: false, until: iso(until), reason });
    if (!row?.copied_at) return closed("No nightly copy into staging has finished yet.");

    const copiedAt = new Date(row.copied_at);
    const startedAt = row.copy_started_at ? new Date(row.copy_started_at) : null;
    if (startedAt && startedAt > copiedAt && now.getTime() - startedAt.getTime() < COPY_STALE_MS) {
        return closed("A copy into staging is running right now. Wait for it to finish.");
    }
    if (row.copy_failed_at && new Date(row.copy_failed_at) > copiedAt) {
        return closed("Last night's copy into staging failed. Switching stays locked until a copy succeeds.");
    }
    if (row.copy_into !== staging) {
        return closed("The last copy went into the other database — this one has already been switched. Wait for tonight's copy.");
    }
    // A daytime copy (08:00–20:00 IST) never opens a window: it would stay open through
    // working hours, and the rule is "after the NIGHTLY copy".
    const copyHourIst = new Date(copiedAt.getTime() + IST_OFFSET_MS).getUTCHours();
    if (copyHourIst >= WINDOW_END_HOUR_IST && copyHourIst < NIGHT_START_HOUR_IST) {
        return closed("The last copy ran in the daytime. Switching opens only after a night copy (8 PM to 8 AM).");
    }
    const until = nextWindowEnd(copiedAt);
    if (now >= until) return closed("Switching is allowed only after the nightly copy and before 8 AM.", until);
    return { open: true, until: iso(until), reason: null };
}

export async function dbSwitchStatus(): Promise<DbSwitchStatus> {
    const primary = await refreshPrimary();
    const dual = isDualDb();
    const staging = dual ? otherDb(primary) : null;
    const ids: DbId[] = dual ? ["DB1", "DB2"] : ["DB1"];

    const [infos, row] = await Promise.all([
        Promise.all(ids.map(async (id): Promise<DbInfo> => ({
            id,
            role: id === primary ? "primary" : "staging",
            projectRef: projectRefFromDbUrl(dbTarget(id)?.direct),
            ...(dual ? await probe(id) : { reachable: true, readOnly: null }),
        }))),
        dual ? readSwitchRow(primary).catch(() => null) : Promise.resolve(null),
    ]);

    return {
        dual,
        primary,
        staging,
        dbs: infos,
        copy: {
            startedAt: iso(row?.copy_started_at),
            copiedAt: iso(row?.copied_at),
            failedAt: iso(row?.copy_failed_at),
            into: row?.copy_into ?? null,
            file: row?.copy_file ?? null,
        },
        window: dual
            ? windowFrom(row, staging!)
            : { open: false, until: null, reason: "Only one database is set up (no DB2_DATABASE_URL)." },
    };
}

// ── Same data on both? ──────────────────────────────────────────────────────

const qi = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Every public table's row count and latest updatedAt, in one round trip. */
async function fingerprint(id: DbId): Promise<Map<string, string>> {
    return withDb(id, async (c) => {
        const tables = await c.query<{ table_name: string; has_updated: boolean }>(`
            SELECT t.table_name,
                   EXISTS (SELECT 1 FROM information_schema.columns col
                           WHERE col.table_schema = 'public' AND col.table_name = t.table_name
                             AND col.column_name = 'updatedAt') AS has_updated
            FROM information_schema.tables t
            WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND t.table_name <> '_db_switch'
            ORDER BY t.table_name`);
        const out = new Map<string, string>();
        if (tables.rows.length === 0) return out;
        const cols = tables.rows.map((t, i) =>
            `(SELECT count(*)::text${t.has_updated ? ` || '|' || coalesce(max(${qi("updatedAt")})::text, '-')` : ""} FROM ${qi(t.table_name)}) AS c${i}`,
        );
        const r = await c.query<Record<string, string>>(`SELECT ${cols.join(", ")}`);
        tables.rows.forEach((t, i) => out.set(t.table_name, r.rows[0][`c${i}`]));
        return out;
    });
}

/** Tables that differ, as "name (primary vs staging)" — empty when both are the same. */
async function differences(primary: DbId, staging: DbId): Promise<string[]> {
    const [a, b] = await Promise.all([fingerprint(primary), fingerprint(staging)]);
    const diffs: string[] = [];
    for (const name of new Set([...a.keys(), ...b.keys()])) {
        if (a.get(name) !== b.get(name)) diffs.push(`${name} (${a.get(name) ?? "missing"} vs ${b.get(name) ?? "missing"})`);
    }
    return diffs;
}

// ── Switch ──────────────────────────────────────────────────────────────────

export class SwitchRefused extends Error {}

/**
 * Makes staging the primary. Refuses (SwitchRefused) unless every check above passes.
 * Order matters: the new primary is made writable and named first, then the old one is
 * named and fenced read-only, then its open connections are dropped so the pooler
 * reconnects them under the new setting.
 */
export async function switchPrimary(): Promise<{ primary: DbId; staging: DbId }> {
    if (!isDualDb()) throw new SwitchRefused("Only one database is set up.");
    const from = await refreshPrimary();
    const to = otherDb(from);

    const row = await readSwitchRow(from).catch(() => {
        throw new SwitchRefused(`${from} (primary) is not answering.`);
    });
    const win = windowFrom(row, to);
    if (!win.open) throw new SwitchRefused(win.reason ?? "Switching is locked.");

    let diffs: string[];
    try {
        diffs = await differences(from, to);
    } catch (e) {
        throw new SwitchRefused(`Could not compare the two databases: ${(e as Error).message}`);
    }
    if (diffs.length > 0) {
        const shown = diffs.slice(0, 5).join("; ");
        throw new SwitchRefused(
            `The two databases are not the same — something changed after the nightly copy. ${shown}${diffs.length > 5 ? ` and ${diffs.length - 5} more` : ""}.`,
        );
    }

    const at = new Date();
    await writeTx(to, async (c) => {
        await c.query(setReadOnlySql(false));
        await ensureRow(c, from);
        await c.query(`UPDATE "_db_switch" SET primary_db = $1, switched_at = $2 WHERE only_row`, [to, at]);
    });
    await writeTx(from, async (c) => {
        await ensureRow(c, from);
        await c.query(`UPDATE "_db_switch" SET primary_db = $1, switched_at = $2 WHERE only_row`, [to, at]);
        await c.query(setReadOnlySql(true));
    });
    // Best-effort: open sessions keep the old default until they reconnect.
    await withDb(from, (c) =>
        c.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
                 WHERE datname = current_database() AND usename = current_user AND pid <> pg_backend_pid()`),
    ).catch((e) => console.warn("[dbSwitch] could not drop old sessions on", from, e));

    const now = await refreshPrimary();
    console.info(`[dbSwitch] primary switched ${from} → ${to} (reads ${now})`);
    return { primary: to, staging: from };
}

// ── Nightly copy bookkeeping (kept on the primary's row) ────────────────────

/** Called just before the backup run that will copy into staging is dispatched. */
export async function markCopyStarted(into: DbId, file: string): Promise<void> {
    const primary = await refreshPrimary();
    if (into === primary) throw new Error(`Refusing to copy into ${into}: it is the primary.`);
    await writeTx(primary, async (c) => {
        await ensureRow(c, primary);
        await c.query(
            `UPDATE "_db_switch" SET copy_started_at = now(), copy_into = $1, copy_file = $2 WHERE only_row`,
            [into, file],
        );
    });
}

/** The backup run reports back after pg_restore into staging. */
export async function markCopyFinished(into: DbId, ok: boolean): Promise<{ recorded: boolean; reason?: string }> {
    const primary = await refreshPrimary();
    if (into === primary) {
        // Cannot happen while switching refuses during a copy — but if it ever does, the
        // copy landed on today's primary and nobody must believe it was a clean night.
        console.error(`[dbSwitch] copy reported into ${into}, which is the PRIMARY.`);
        return { recorded: false, reason: `${into} is the primary` };
    }
    await writeTx(primary, async (c) => {
        await ensureRow(c, primary);
        await c.query(
            ok
                ? `UPDATE "_db_switch" SET copied_at = now() WHERE only_row AND copy_into = $1`
                : `UPDATE "_db_switch" SET copy_failed_at = now() WHERE only_row AND copy_into = $1`,
            [into],
        );
    });
    return { recorded: true };
}
