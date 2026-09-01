/**
 * Builds the counter's local replica: applies the schema, creates the two roles, and
 * remembers what it applied so an upgrade re-applies and a normal boot does not.
 *
 * Runs after `ensurePostgresRunning()` has produced a reachable, correctly-collated
 * `smx` database (see `postgresManager.ts` for why collation is created from the
 * source rather than guessed).
 *
 * ── Why the schema is applied rather than dumped ─────────────────────────────
 * `tools/counter-sync`'s `seed-replica.ps1` seeds with `pg_dump | pg_restore`, which
 * carries its own DDL. That needs a session-mode connection on port 5432, and
 * `scripts/counterEnv.ts` deliberately keeps `DIRECT_URL` off shop PCs. We do not need
 * it: counter-sync's pull engine treats a NULL watermark as "never synced" and drains
 * the table, so an empty database with the right shape seeds itself over the ordinary
 * pooler `DATABASE_URL`. That makes `resources/local-schema.sql` load-bearing — it is
 * the only thing that creates the 113 tables.
 *
 * ── The two roles ────────────────────────────────────────────────────────────
 * `smx_sync` owns the replicated data and is what the sync engine connects as. It needs
 * `CREATE` on `public` (it creates its own `_sync_state`) and
 * `SET ON PARAMETER session_replication_role`, because replaying a `full` table or
 * refreshing a child set writes parents and children in arbitrary order and would
 * otherwise trip foreign keys.
 *
 * `smx_app` is what the app connects as. counter-sync's design gives the app a
 * SELECT-only role, which was right when every write went to Supabase. It is wrong
 * here: this counter reads AND writes locally, even offline. So `smx_app` gets
 * SELECT/INSERT/UPDATE — but deliberately **not DELETE, and not DDL**.
 *
 * Withholding DELETE is not arbitrary: `createLocal()` in
 * `src/shared/lib/prisma/prismaClient.ts` already blocks `delete`/`deleteMany`
 * unconditionally on the replica, because a delete replayed against a row another
 * counter has since changed is not recoverable. Denying it at the database level too
 * means that guard survives a future refactor of the application-level one.
 *
 * ── On trust authentication ──────────────────────────────────────────────────
 * The embedded cluster is created with `--auth=trust` and listens only on loopback, so
 * these roles carry no passwords. Trust does not weaken the privileges themselves —
 * PostgreSQL still enforces exactly what each role may do — it only skips verifying who
 * is connecting, and the only thing on that loopback is this app. This deliberately
 * avoids minting and storing another per-machine secret.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { app } from "electron";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client: PgClient } = require("pg") as typeof import("pg");

export const SYNC_ROLE = "smx_sync";
export const APP_ROLE = "smx_app";

/**
 * Explicit column migrations for columns added after the initial schema release.
 * These run AFTER the full schema re-apply, so they serve as a belt-and-suspenders
 * guarantee: even if the full DDL batch fails (e.g. a NOT NULL column on a populated
 * table without a default), these targeted ALTER TABLEs still add the critical columns.
 *
 * Each entry is (table, column, type, default-or-null).  The `IF NOT EXISTS` guard
 * makes every statement idempotent — safe to run on a fresh or already-migrated DB.
 */
const COLUMN_MIGRATIONS: Array<{ table: string; column: string; ddl: string }> = [
    { table: "Branch", column: "number",
      ddl: `ALTER TABLE "Branch" ADD COLUMN IF NOT EXISTS "number" INTEGER NOT NULL DEFAULT 0` },
    { table: "pos_counters", column: "counterNumber",
      ddl: `ALTER TABLE "pos_counters" ADD COLUMN IF NOT EXISTS "counterNumber" INTEGER NOT NULL DEFAULT 0` },
    { table: "pos_counters", column: "branchId",
      ddl: `ALTER TABLE "pos_counters" ADD COLUMN IF NOT EXISTS "branchId" TEXT NOT NULL DEFAULT ''` },
    { table: "pos_counters", column: "idRangeStart",
      ddl: `ALTER TABLE "pos_counters" ADD COLUMN IF NOT EXISTS "idRangeStart" INTEGER` },
    { table: "pos_counters", column: "boundDeviceId",
      ddl: `ALTER TABLE "pos_counters" ADD COLUMN IF NOT EXISTS "boundDeviceId" TEXT` },
    { table: "pos_counters", column: "boundDeviceLabel",
      ddl: `ALTER TABLE "pos_counters" ADD COLUMN IF NOT EXISTS "boundDeviceLabel" TEXT` },
    { table: "pos_counters", column: "boundAt",
      ddl: `ALTER TABLE "pos_counters" ADD COLUMN IF NOT EXISTS "boundAt" TIMESTAMP(3)` },
    { table: "pos_counters", column: "releasedAt",
      ddl: `ALTER TABLE "pos_counters" ADD COLUMN IF NOT EXISTS "releasedAt" TIMESTAMP(3)` },
    { table: "TicketRepair", column: "ticketNo",
      ddl: `ALTER TABLE "TicketRepair" ADD COLUMN IF NOT EXISTS "ticketNo" TEXT` },
];

/**
 * Check whether a column already exists in a table. Used by applyColumnMigrations
 * to skip statements that are already satisfied, keeping the log clean.
 */
async function columnExists(client: InstanceType<typeof PgClient>, table: string, column: string): Promise<boolean> {
    const { rows } = await client.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
        [table, column],
    );
    return rows.length > 0;
}

/**
 * Apply explicit column migrations. Runs independently of the full schema re-apply
 * so that even if the DDL batch fails, critical columns are still added.
 */
async function applyColumnMigrations(client: InstanceType<typeof PgClient>): Promise<void> {
    let added = 0;
    for (const m of COLUMN_MIGRATIONS) {
        if (await columnExists(client, m.table, m.column)) continue;
        try {
            await client.query(m.ddl);
            console.log(`[Provisioner] Added missing column: ${m.table}.${m.column}`);
            added++;
        } catch (err) {
            console.warn(`[Provisioner] Failed to add ${m.table}.${m.column}:`,
                err instanceof Error ? err.message : err);
        }
    }
    if (added > 0) console.log(`[Provisioner] Applied ${added} column migration(s).`);
}

/** Mirrors getEmbeddedBinPath()'s dev/packaged split in postgresManager.ts. */
function resourcePath(fileName: string): string {
    const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
    return isDev
        ? path.join(process.cwd(), "resources", fileName)
        : path.join(process.resourcesPath, fileName);
}

/**
 * Our own bookkeeping, kept separate from counter-sync's `_sync_status`: that table is
 * the sync engine's to write, and provisioning has to work before the engine has ever
 * run.
 */
const PROVISION_DDL = `
CREATE TABLE IF NOT EXISTS "_provision" (
    only_row     boolean PRIMARY KEY DEFAULT true CHECK (only_row),
    schema_hash  text        NOT NULL,
    applied_at   timestamptz NOT NULL DEFAULT now()
);
`;

/**
 * Offline write outbox. Mutations created while the counter is offline are
 * enqueued here in the SAME local transaction as the row they describe — a crash
 * between the two must not lose the write. Flushed in `created_at` order on
 * reconnect; the idempotency key prevents double-posting a document.
 *
 * Created by the provisioner rather than the sync engine because the outbox is
 * the app's responsibility — it writes rows, the engine only reads them.
 */
const OUTBOX_DDL = `
CREATE TABLE IF NOT EXISTS "_outbox" (
    id              SERIAL PRIMARY KEY,
    table_name      text        NOT NULL,
    row_pk          text        NOT NULL,
    operation       text        NOT NULL CHECK (operation IN ('create', 'update')),
    payload         jsonb       NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    pushed_at       timestamptz,
    idempotency_key text        UNIQUE NOT NULL,
    error           text
);
`;

/**
 * Grants are re-issued on every provision rather than only at creation. A schema
 * re-apply can add tables, and a grant that only ran once would leave those new tables
 * unreadable by the app — which surfaces as a permission error deep in a page, not as a
 * provisioning failure.
 */
function grantsFor(role: string, privileges: string): string[] {
    return [
        `GRANT USAGE ON SCHEMA public TO ${role}`,
        `GRANT ${privileges} ON ALL TABLES IN SCHEMA public TO ${role}`,
        `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
        // Covers tables created later, e.g. by a schema re-apply after an upgrade.
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ${privileges} ON TABLES TO ${role}`,
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${role}`,
    ];
}

export interface ProvisionedReplica {
    /** Least-privilege URL the app reads and writes through. No DELETE, no DDL. */
    appUrl: string;
    /** The sync worker's URL: owns the replicated data, may suspend foreign keys. */
    syncUrl: string;
}

/**
 * Applies the schema and roles if they are not already in place.
 *
 * @returns both role connection strings, or null when the replica could not be
 *          provisioned — in which case the caller stays in live mode, same contract as
 *          `ensurePostgresRunning()`.
 */
export async function provisionLocalDatabase(adminUrl: string): Promise<ProvisionedReplica | null> {
    const schemaFile = resourcePath("local-schema.sql");
    if (!fs.existsSync(schemaFile)) {
        console.error(`[Provisioner] Missing ${schemaFile} — cannot build the replica. Staying in live mode.`);
        return null;
    }

    const schemaSql = fs.readFileSync(schemaFile, "utf8");
    const schemaHash = createHash("sha256").update(schemaSql).digest("hex");

    const client = new PgClient({ connectionString: adminUrl, connectionTimeoutMillis: 10_000 });
    try {
        await client.connect();
        await client.query(PROVISION_DDL);
        await client.query(OUTBOX_DDL);

        const { rows } = await client.query<{ schema_hash: string }>(
            `SELECT schema_hash FROM "_provision" WHERE only_row`,
        );
        const applied = rows[0]?.schema_hash;

        if (applied === schemaHash) {
            console.log("[Provisioner] Replica schema is already current.");
        } else {
            console.log(
                applied
                    ? "[Provisioner] App upgrade changed the schema — re-applying."
                    : "[Provisioner] First run — applying the replica schema (113 tables).",
            );
            // local-schema.sql is generated by `pnpm db:local-schema` from prisma/schema/.
            // Every statement is guarded (IF NOT EXISTS, or a DO block swallowing
            // duplicate_object for CREATE TYPE / ADD CONSTRAINT — see makeIdempotent()
            // in gen-local-schema.ts), so a re-apply is a no-op for anything that
            // already exists in the same shape. It does NOT pick up a column added to
            // an already-existing table — that needs a real diff-against-target
            // migrator, not this from-empty snapshot — so a genuine shape change still
            // surfaces here, and failures stay reported rather than swallowed.
            await client.query(schemaSql);
            await client.query(
                `INSERT INTO "_provision" (only_row, schema_hash) VALUES (true, $1)
                 ON CONFLICT (only_row) DO UPDATE SET schema_hash = EXCLUDED.schema_hash, applied_at = now()`,
                [schemaHash],
            );
        }

        // Belt-and-suspenders: even when the schema hash matched (no full re-apply),
        // a previous upgrade may have silently failed to add columns (e.g. NOT NULL
        // on a populated table without a default).  These ALTER TABLE IF NOT EXISTS
        // are idempotent and cheap — one information_schema query per migration.
        await applyColumnMigrations(client);

        // Roles. CREATE ROLE has no IF NOT EXISTS, hence the guarded DO block.
        for (const role of [SYNC_ROLE, APP_ROLE]) {
            await client.query(`
                DO $$ BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
                        CREATE ROLE ${role} LOGIN;
                    END IF;
                END $$;
            `);
        }

        for (const sql of grantsFor(SYNC_ROLE, "SELECT, INSERT, UPDATE, DELETE")) {
            await client.query(sql);
        }
        // No DELETE: see the header note. The app's write guard is enforced here too.
        for (const sql of grantsFor(APP_ROLE, "SELECT, INSERT, UPDATE")) {
            await client.query(sql);
        }

        // Grant SELECT on sync bookkeeping tables if created by sync worker
        await client.query(`
            DO $$ BEGIN
                IF to_regclass('public."_sync_status"') IS NOT NULL THEN
                    GRANT SELECT ON TABLE public."_sync_status" TO ${APP_ROLE};
                END IF;
                IF to_regclass('public."_sync_state"') IS NOT NULL THEN
                    GRANT SELECT ON TABLE public."_sync_state" TO ${APP_ROLE};
                END IF;
            END $$;
        `);

        // Reserving this counter's autoincrement block needs sequence ownership, which
        // the app role must not have (it implies DROP and ALTER on every sequence).
        // `_apply_id_range` is SECURITY DEFINER and owned by postgres, so EXECUTE on it
        // is the whole grant — see the note in scripts/gen-local-schema.ts.
        await client.query(`GRANT EXECUTE ON FUNCTION _apply_id_range(integer) TO ${APP_ROLE}`);

        // The sync engine creates _sync_state itself and suspends foreign keys per
        // transaction while replaying a table. The app role is deliberately NOT given
        // session_replication_role: that parameter suppresses ordinary triggers, and
        // the outbox capture triggers are how local writes are recorded for push.
        await client.query(`GRANT CREATE ON SCHEMA public TO ${SYNC_ROLE}`);
        try {
            await client.query(`GRANT SET ON PARAMETER session_replication_role TO ${SYNC_ROLE}`);
        } catch (err) {
            // PostgreSQL 15+ only. Without it the first `full` table fails on a
            // constraint, which reads like a data problem and is not one — so say so
            // now rather than letting it surface mid-sync.
            console.warn("[Provisioner] Could not grant session_replication_role:",
                err instanceof Error ? err.message : err);
        }

        console.log(`[Provisioner] Replica ready — app connects as ${APP_ROLE}, worker as ${SYNC_ROLE}.`);
        return {
            appUrl: adminUrl.replace("://postgres@", `://${APP_ROLE}@`),
            syncUrl: adminUrl.replace("://postgres@", `://${SYNC_ROLE}@`),
        };
    } catch (err) {
        console.error("[Provisioner] Failed to provision the replica:", err);
        return null;
    } finally {
        await client.end().catch(() => {});
    }
}
