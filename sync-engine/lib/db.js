"use strict";

/**
 * Connections, identifier quoting, and the two facts about writing to a replica.
 */

const { Pool } = require("pg");

function isLocal(url) {
    return /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url || "");
}

/**
 * Drop `sslmode` from the URL and let the explicit `ssl` option below decide.
 *
 * pg-connection-string now maps sslmode=require onto verify-full, so leaving it in
 * makes the driver reject Supabase's certificate chain ("self-signed certificate in
 * certificate chain") no matter what `ssl` says. The app's own prismaClient.ts
 * strips it for exactly the same reason.
 */
function stripSslMode(url) {
    return (url || "").replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
}

/**
 * `opts.idleTimeoutMillis`: how long an unused connection stays open (pg's default, 10s,
 * when absent; 0 keeps it). sync-once.js `--serve` passes 0 to hold its connections
 * between cycles.
 */
function pool(url, max, opts = {}) {
    const p = new Pool({
        connectionString: stripSslMode(url),
        ssl: isLocal(url) ? false : { rejectUnauthorized: false },
        max: max || 4,
        idleTimeoutMillis: opts.idleTimeoutMillis ?? 10000,
        keepAlive: true,
        connectionTimeoutMillis: 15000,
        // Both sides render time the same way. The full-table content hash
        // (reconcile.js) compares `to_jsonb(row)::text` across the two servers, and a
        // timestamptz renders in the SESSION zone — Supabase sits in UTC, a counter
        // in IST. Pinned rather than assumed.
        options: "-c timezone=UTC",
    });
    // An idle connection the server or the network dropped. pg discards it and opens a
    // new one when next needed; without a listener the event would crash the process.
    p.on("error", (e) => console.error(`pool: idle connection lost (${e.message})`));
    return p;
}

/**
 * Quote an identifier. Every table and column name in this worker comes from the
 * generated registry rather than user input, but these names are interpolated into
 * SQL text (a parameter cannot stand in for an identifier), so they are quoted
 * properly rather than trusted.
 */
function q(name) {
    return `"${String(name).replace(/"/g, '""')}"`;
}

/**
 * Run a function inside a transaction with foreign keys suspended.
 *
 * Replaying a 'full' table is DELETE then INSERT, and refreshing a child set is the
 * same. Either trips a foreign key unless every table is written in perfect
 * dependency order - and one new relation added later would silently invalidate
 * that order, producing a failure far from its cause.
 *
 * 'session_replication_role = replica' turns off FK triggers for this session only,
 * which is exactly what the setting is for: this IS a replica, and the source has
 * already enforced every constraint. They stay in force for the app's own reads.
 *
 * Requires GRANT SET ON PARAMETER session_replication_role (PostgreSQL 15+);
 * seed-replica.ps1 grants it, and scripts/retrofit-grants.sql retrofits it.
 */
async function inReplicaTransaction(client, fn) {
    await client.query("BEGIN");
    try {
        await client.query("SET LOCAL session_replication_role = replica");
        const out = await fn();
        await client.query("COMMIT");
        return out;
    } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
    }
}

/**
 * Can this connection actually suspend foreign keys?
 *
 * Checked once at startup rather than discovered mid-write: without the grant the
 * first 'full' table fails on a constraint, which reads like a data problem and is
 * not one.
 */
async function canSuspendForeignKeys(client) {
    try {
        await client.query("BEGIN");
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query("ROLLBACK");
        return true;
    } catch {
        await client.query("ROLLBACK").catch(() => {});
        return false;
    }
}

module.exports = { pool, q, inReplicaTransaction, canSuspendForeignKeys, isLocal, stripSslMode };
