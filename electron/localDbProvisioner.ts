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

/**
 * Applies the schema and roles if they are not already in place.
 *
 * @returns the connection string the app should use, or null when the replica could not
 *          be provisioned — in which case the caller stays in live mode, same contract
 *          as `ensurePostgresRunning()`.
 */
export async function provisionLocalDatabase(adminUrl: string): Promise<string | null> {
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
            // local-schema.sql is generated by `pnpm db:local-schema` from prisma/schema/
            // and is entirely CREATE ... statements, so a re-apply is a no-op for
            // anything that already exists. It is NOT idempotent for enums, which is
            // why failures here are reported rather than swallowed.
            await client.query(schemaSql);
            await client.query(
                `INSERT INTO "_provision" (only_row, schema_hash) VALUES (true, $1)
                 ON CONFLICT (only_row) DO UPDATE SET schema_hash = EXCLUDED.schema_hash, applied_at = now()`,
                [schemaHash],
            );
        }

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

        // The sync engine creates _sync_state itself and suspends foreign keys per
        // transaction while replaying a table.
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

        const appUrl = adminUrl.replace("://postgres@", `://${APP_ROLE}@`);
        console.log(`[Provisioner] Replica ready — app connects as ${APP_ROLE}.`);
        return appUrl;
    } catch (err) {
        console.error("[Provisioner] Failed to provision the replica:", err);
        return null;
    } finally {
        await client.end().catch(() => {});
    }
}
