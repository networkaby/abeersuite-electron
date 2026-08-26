"use strict";

/**
 * `_sync_status` - one row, the replica's own account of whether it can be trusted.
 *
 * Kept in the local DATABASE rather than a status file on disk. The app already
 * holds a connection to this database, so there is no path to agree on, no file
 * permission to get right between two Windows services, and no chance of the app
 * reading a half-written file. It is also the same transactional store as the data
 * it describes.
 *
 * The app reads this through its SELECT-only role to decide whether local reads are
 * safe -- see `replicaReady` in the app's counterMode.ts.
 */

const { q } = require("./db");

const TABLE = "_sync_status";

const DDL = `
CREATE TABLE IF NOT EXISTS ${q(TABLE)} (
  -- Single row, enforced by the primary key rather than by convention.
  only_row      boolean PRIMARY KEY DEFAULT true CHECK (only_row),
  schema_ok     boolean     NOT NULL DEFAULT false,
  schema_detail text,
  ready         boolean     NOT NULL DEFAULT false,
  ready_detail  text,
  last_cycle_at timestamptz,
  tables_total  integer,
  tables_synced integer,
  worst_lag_sec integer
);
`;

async function ensure(client) {
    await client.query(DDL);
    await client.query(`INSERT INTO ${q(TABLE)} (only_row) VALUES (true) ON CONFLICT DO NOTHING`);
    // The app's role is created before this table exists, and ALTER DEFAULT
    // PRIVILEGES only covers tables created by the role that owns the default. Grant
    // explicitly so a fresh replica does not leave the app unable to read readiness
    // -- which it would interpret as "not ready", permanently.
    await client.query(`GRANT SELECT ON ${q(TABLE)} TO smx_ro`).catch(() => {});
    await client.query(`GRANT SELECT ON ${q("_sync_state")} TO smx_ro`).catch(() => {});
}

/**
 * Decide and record whether the replica may serve reads.
 *
 * Ready means: the schema matches, and EVERY table has been synced at least once.
 * The second half is the one that matters most -- a partially seeded replica does
 * not error, it returns fewer rows, so a report renders successfully with records
 * silently missing. That reads as "those records do not exist" rather than "this
 * database is not ready yet", which is why readiness is proved rather than assumed.
 */
async function publish(client, { schema, totalTables, syncedTables, worstLagSec }) {
    const reasons = [];
    if (!schema.ok) reasons.push(`schema drift: ${schema.detail}`);
    if (syncedTables < totalTables) {
        reasons.push(`${totalTables - syncedTables} of ${totalTables} table(s) never synced`);
    }
    const ready = reasons.length === 0;

    await client.query(
        `UPDATE ${q(TABLE)} SET
           schema_ok = $1, schema_detail = $2,
           ready = $3, ready_detail = $4,
           last_cycle_at = now(),
           tables_total = $5, tables_synced = $6, worst_lag_sec = $7
         WHERE only_row`,
        [
            schema.ok, schema.detail,
            ready, ready ? "replica is in step with the source" : reasons.join("; "),
            totalTables, syncedTables, worstLagSec,
        ],
    );
    return { ready, reasons };
}

async function read(client) {
    const { rows } = await client.query(`SELECT * FROM ${q(TABLE)} WHERE only_row`);
    return rows[0] || null;
}

module.exports = { ensure, publish, read, TABLE };
