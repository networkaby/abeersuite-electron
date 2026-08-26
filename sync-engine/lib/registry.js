"use strict";

/**
 * Loads prisma/sync-tables.json and works out what order to sync in.
 *
 * The registry is GENERATED from the app's Prisma schema (scripts/gen-sync-registry.ts
 * in the app repo) and ships with the app artifact, so it always describes the schema
 * the counter is actually running. It is never hand-edited here.
 */

const fs = require("node:fs");
const path = require("node:path");

/**
 * @typedef {Object} TableEntry
 * @property {number}   n         stable table number (keys the watermark)
 * @property {string}   table     PHYSICAL table name - 17 models are @@map'd
 * @property {string[]} pk        primary key columns
 * @property {"child"|"watermark"|"append"|"full"} strategy
 * @property {string}  [column]   watermark column (watermark | append)
 * @property {string}  [parent]   parent MODEL name (child)
 * @property {string}  [fk]       local FK column pointing at the parent (child)
 */

/** @returns {{ tables: Record<string, TableEntry>, ignore: string[] }} */
function load(registryPath) {
    const raw = fs.readFileSync(registryPath, "utf8");
    const reg = JSON.parse(raw);
    if (!reg || typeof reg.tables !== "object") {
        throw new Error(`${registryPath} is not a sync registry (no "tables")`);
    }
    return { tables: reg.tables, ignore: reg.ignore || [] };
}

/**
 * How many parents sit above a child, so children are written after the parents
 * whose moved ids they are filtered by.
 *
 * Nesting is real: TicketOrderLine -> TicketOrder -> Ticket. Sorting by depth means
 * TicketOrder has already been written (and its ids collected) before its own
 * children ask which parents moved.
 *
 * A cycle would otherwise hang the sort, so it is capped and reported rather than
 * silently truncated.
 */
function depthOf(model, tables, seen) {
    const t = tables[model];
    if (!t || t.strategy !== "child" || !t.parent) return 0;
    if (seen.has(model)) {
        throw new Error(`cyclic parent chain at ${model}: ${[...seen].join(" -> ")}`);
    }
    seen.add(model);
    return 1 + depthOf(t.parent, tables, seen);
}

/**
 * Sync order: everything that stands alone first, then children shallowest-first.
 *
 * Within a pass the order does not matter - foreign keys are suspended for the
 * session (see db.js) precisely so no dependency ordering has to be maintained by
 * hand and kept correct as the schema grows.
 */
function syncOrder(tables) {
    const names = Object.keys(tables);
    const independent = names.filter((n) => tables[n].strategy !== "child");
    const children = names
        .filter((n) => tables[n].strategy === "child")
        .map((n) => ({ name: n, depth: depthOf(n, tables, new Set()) }))
        .sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name))
        .map((c) => c.name);

    return { independent: independent.sort(), children };
}

/**
 * Where to find the registry, most-specific first.
 *
 * Now that this worker lives inside the app repo, `prisma/sync-tables.json` is the
 * generated original and is what runs in development -- no copy to drift. The packaged
 * app has no `prisma/` directory, so the build drops a copy beside this worker and that
 * is what a counter uses.
 *
 * Earlier this assumed a sibling `counter\app` directory holding a full deployed
 * Next.js artifact. That artifact never landed, so on a real install the file was never
 * there and every cycle failed immediately with "No sync registry", the worker backing
 * off and retrying forever with nothing to show for it. Hence: look in more than one
 * place, and say which places were tried when none of them has it.
 */
function candidateRegistryPaths() {
    return [
        // Packaged: copied next to the worker at build time.
        path.resolve(__dirname, "..", "sync-tables.json"),
        // In the repo: the generated original, one directory up from sync-engine/.
        path.resolve(__dirname, "..", "..", "prisma", "sync-tables.json"),
    ];
}

function defaultRegistryPath() {
    const tried = candidateRegistryPaths();
    const found = tried.find((p) => fs.existsSync(p));
    if (!found) {
        throw new Error(`No sync registry found. Looked in:\n  ${tried.join("\n  ")}`);
    }
    return found;
}

module.exports = { load, syncOrder, depthOf, defaultRegistryPath, candidateRegistryPaths };
