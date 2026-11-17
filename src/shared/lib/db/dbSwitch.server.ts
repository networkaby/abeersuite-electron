/**
 * Switching DB1 / DB2 — the LOCK step, plus the nightly copy's bookkeeping.
 *
 * A switch is two steps (owner, 2026-11-18: "simplify", rare switches, easy to trust):
 *   1. "Lock for switch" here: both databases must answer, the last copy into the
 *      standby must have finished, and every table must match on both (row count and
 *      latest updatedAt). The primary is made READ-ONLY first and compared after, so no
 *      save can slip in between; if they differ the lock is undone.
 *   2. Change NEXT_PUBLIC_DB_PRIMARY on Vercel and redeploy. The deploy's migrate step
 *      (scripts/migrate-primary.mjs) makes the new primary writable before migrating.
 *
 * "Unlock" undoes step 1 if the owner changes their mind before redeploying.
 *
 * When the primary is DEAD there is nothing to lock or compare: change the setting and
 * redeploy. The loss is whatever happened since the last copy.
 */
import "server-only";
import type { PoolClient } from "pg";
import { projectRefFromDbUrl } from "@/shared/lib/backup/dbUrl";
import { dbTarget, isDualDb, otherDb, type DbId } from "./dbTargets";
import { currentPrimary, DB_READ_ONLY_SQL, readSwitchRow, SWITCH_TABLE_SQL, withDb, type SwitchRow } from "./dbPrimary";

/** A copy that has not reported back within this long is treated as dead. */
const COPY_STALE_MS = 2 * 60 * 60 * 1000;

/** Runs `fn` in a transaction that may write even on a read-only database. */
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
    /** The primary is read-only: locked, waiting for the setting change + redeploy. */
    locked: boolean;
    /** Why "Lock for switch" would refuse right now, or null when it may be tried. */
    lockBlocked: string | null;
}

async function probe(id: DbId): Promise<{ reachable: boolean; readOnly: boolean | null }> {
    try {
        const ro = await withDb(id, (c) => c.query<{ ro: boolean }>(DB_READ_ONLY_SQL));
        return { reachable: true, readOnly: ro.rows[0]?.ro === true };
    } catch {
        return { reachable: false, readOnly: null };
    }
}

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

/** Why the last copy is not good enough to switch on, or null. Pure apart from `now`. */
export function copyProblem(row: SwitchRow | null, standby: DbId, now = new Date()): string | null {
    if (!row?.copied_at) return "No copy into the standby has finished yet.";
    // First: after a switch the new primary carries the row it received IN the copy, so
    // anything else it says (even "running") is about the other direction.
    if (row.copy_into !== standby) return `No copy into ${standby} yet since the switch. Tonight's copy will do it.`;
    const copiedAt = new Date(row.copied_at);
    const startedAt = row.copy_started_at ? new Date(row.copy_started_at) : null;
    if (startedAt && startedAt > copiedAt && now.getTime() - startedAt.getTime() < COPY_STALE_MS) {
        return "A copy into the standby is running right now. Wait for it to finish.";
    }
    if (row.copy_failed_at && new Date(row.copy_failed_at) > copiedAt) {
        return "The last copy into the standby failed. Run a copy that succeeds first.";
    }
    return null;
}

export async function dbSwitchStatus(): Promise<DbSwitchStatus> {
    const primary = currentPrimary();
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
    const locked = infos.find((d) => d.id === primary)?.readOnly === true;

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
        locked,
        lockBlocked: !dual ? "Only one database is set up (no DATABASE_URL_2)." : locked ? null : copyProblem(row, staging!),
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

async function differences(a: DbId, b: DbId): Promise<string[]> {
    const [x, y] = await Promise.all([fingerprint(a), fingerprint(b)]);
    const diffs: string[] = [];
    for (const name of new Set([...x.keys(), ...y.keys()])) {
        if (x.get(name) !== y.get(name)) diffs.push(`${name} (${x.get(name) ?? "missing"} vs ${y.get(name) ?? "missing"})`);
    }
    return diffs;
}

// ── Lock / unlock ───────────────────────────────────────────────────────────

export class SwitchRefused extends Error {}

/** Step 1 of a switch: checks, then the primary goes read-only. */
export async function lockForSwitch(): Promise<{ locked: DbId; next: DbId }> {
    if (!isDualDb()) throw new SwitchRefused("Only one database is set up.");
    const from = currentPrimary();
    const to = otherDb(from);

    for (const id of [from, to]) {
        const ok = await withDb(id, (c) => c.query("SELECT 1")).then(() => true, () => false);
        if (!ok) throw new SwitchRefused(`${id} (${id === from ? "primary" : "standby"}) is not answering.`);
    }
    const problem = copyProblem(await readSwitchRow(from), to);
    if (problem) throw new SwitchRefused(problem);

    // Read-only FIRST, then compare: a save made between the two would otherwise slip in
    // after the check. If they differ, the lock is undone and nothing has changed.
    await writeTx(from, (c) => c.query(setReadOnlySql(true)));
    await withDb(from, (c) =>
        c.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
                 WHERE datname = current_database() AND usename = current_user AND pid <> pg_backend_pid()`),
    ).catch((e) => console.warn("[dbSwitch] could not drop open sessions on", from, e));

    let diffs: string[];
    try {
        diffs = await differences(from, to);
    } catch (e) {
        await unlockPrimary().catch(() => {});
        throw new SwitchRefused(`Could not compare the two databases: ${(e as Error).message}`);
    }
    if (diffs.length > 0) {
        await unlockPrimary();
        const shown = diffs.slice(0, 5).join("; ");
        throw new SwitchRefused(
            `The two databases are not the same — something changed after the copy, so ${from} stays unlocked. ${shown}${diffs.length > 5 ? ` and ${diffs.length - 5} more` : ""}.`,
        );
    }
    console.info(`[dbSwitch] ${from} locked for a switch to ${to}`);
    return { locked: from, next: to };
}

/** Undo the lock: the primary is writable again. */
export async function unlockPrimary(): Promise<DbId> {
    const id = currentPrimary();
    await writeTx(id, (c) => c.query(setReadOnlySql(false)));
    console.info(`[dbSwitch] ${id} unlocked`);
    return id;
}

// ── Nightly copy bookkeeping (kept on the primary's row) ────────────────────

/** Called just before the backup run that will copy into the standby is dispatched. */
export async function markCopyStarted(into: DbId, file: string): Promise<void> {
    const primary = currentPrimary();
    if (into === primary) throw new Error(`Refusing to copy into ${into}: it is the primary.`);
    await writeTx(primary, async (c) => {
        await ensureRow(c, primary);
        await c.query(
            `UPDATE "_db_switch" SET copy_started_at = now(), copy_into = $1, copy_file = $2 WHERE only_row`,
            [into, file],
        );
    });
}

/** The backup run reports back after pg_restore into the standby. */
export async function markCopyFinished(into: DbId, ok: boolean): Promise<{ recorded: boolean; reason?: string }> {
    const primary = currentPrimary();
    if (into === primary) {
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
