"use strict";

/**
 * The engine's own tables (`_sync_state`, `_sync_status`, `_sync_dirty`) — created
 * and kept in shape by the engine, from ONE column list per table.
 *
 * Why the engine and not resources/local-schema.sql: the provisioner applies that
 * file as the database owner BEFORE the sync role exists, so a table created there
 * would belong to the owner — and the engine, which must be able to add a column to
 * its own table, could not. The engine creates them as `smx_sync` (the provisioner
 * grants it CREATE), which is who has always owned them on every till.
 *
 * Why one list: `CREATE TABLE IF NOT EXISTS` skips the whole statement once the table
 * exists, so a column added later never reaches a till that already has the table —
 * and the first statement that names it fails. Every column here is therefore also
 * re-declared with `ADD COLUMN IF NOT EXISTS` on each cycle. Adding a column is one
 * line in the list; it must be nullable or carry a DEFAULT, since existing rows get it.
 */

const { q } = require("./db");

/**
 * @param {import("pg").ClientBase} client
 * @param {string} table
 * @param {Array<[string, string]>} columns `[name, definition]`; the first may carry
 *        PRIMARY KEY, every other one is backfilled.
 * @param {string[]} [extra] trailing CREATE TABLE clauses (e.g. a compound primary key)
 */
async function ensureTable(client, table, columns, extra = []) {
    const defs = columns.map(([name, def]) => `${q(name)} ${def}`).concat(extra);
    await client.query(`CREATE TABLE IF NOT EXISTS ${q(table)} (\n  ${defs.join(",\n  ")}\n)`);
    for (const [name, def] of columns) {
        if (/PRIMARY KEY/i.test(def)) continue;
        await client.query(`ALTER TABLE ${q(table)} ADD COLUMN IF NOT EXISTS ${q(name)} ${def}`);
    }
}

module.exports = { ensureTable };
