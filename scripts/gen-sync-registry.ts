/**
 * Generates `prisma/sync-tables.json` — the counter replica's table registry.
 *
 * The counter's sync worker needs three facts per model that the generated Prisma
 * client does not expose (Prisma 7's `prisma-client` generator ships no DMMF, and
 * `@prisma/internals` is not a dependency): a STABLE table number, the primary key,
 * and how that table can be delta-synced. So we read `prisma/schema/*.prisma`.
 *
 * ── Why the numbers are append-only ──────────────────────────────────────────
 * Table numbers key the worker's watermarks. If numbers were derived from sorted
 * position, adding one model would renumber every model after it and silently
 * re-point every stored watermark at the wrong table — the replica would then skip
 * real changes with no error anywhere. So a number is assigned once and never moves,
 * and a removed model's number is retired, never reused.
 *
 * ── Strategies, in precedence order ──────────────────────────────────────────
 *   child     — has a parent relation with `onDelete: Cascade`. Synced by replacing
 *               the whole child set whenever the parent moves. Chosen ABOVE
 *               watermark even when the model has `updatedAt`, because replacement
 *               is exact for child DELETES and a watermark can never see those.
 *   watermark — has `@updatedAt`. Pull `WHERE updatedAt > $wm`, upsert by pk.
 *   append    — no watermark, but has `createdAt`. Insert-mostly; deletes are left
 *               to the reconciliation sweep.
 *   full      — none of the above. TRUNCATE + COPY; only safe for small tables,
 *               which is why `overrides` exists (see below).
 *
 * `overrides` in the JSON is hand-maintained and survives regeneration — use it to
 * force a table to `full` (small and awkward) or pin anything the parser gets wrong.
 * Nothing here infers row COUNTS; the schema cannot know them.
 *
 * Usage:  pnpm sync:tables          (write)
 *         pnpm sync:tables:check    (verify; non-zero exit on drift — used by precommit)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const SCHEMA_DIR = join(process.cwd(), "prisma", "schema");
const REGISTRY = join(process.cwd(), "prisma", "sync-tables.json");

type Strategy = "child" | "watermark" | "append" | "full";

type TableEntry = {
    n: number;
    /**
     * PHYSICAL table name — what SQL must actually say.
     *
     * Not decorative: 17 models carry `@@map` (`PosShift` -> `pos_shifts`,
     * `InvProductCode` -> `inv_product_codes`, …). A worker building SQL from the
     * model name alone would emit `FROM "PosShift"` and hit a table that does not
     * exist. Verified against a real replica: 113 models, and every mapped name
     * differs from its model.
     */
    table: string;
    /** Primary key columns. Length > 1 for the join tables that use `@@id([a, b])`. */
    pk: string[];
    strategy: Strategy;
    /** watermark column — `watermark` and `append` strategies only. */
    column?: string;
    /** parent model — `child` strategy only. */
    parent?: string;
    /** local FK column pointing at the parent — `child` strategy only. */
    fk?: string;
};

type Registry = {
    $comment: string;
    nextNumber: number;
    /**
     * Physical tables the worker must leave alone.
     *
     * `_prisma_migrations` is present on Supabase even though this project applies
     * schema with `db push` and keeps no migrations directory — a leftover from
     * earlier tooling. It is not a model, nothing reads it, and syncing it would
     * copy one database's migration history onto another. Confirmed against a real
     * replica: it is the ONLY table that is not a model (114 tables, 113 models).
     */
    ignore: string[];
    /** Hand-maintained; survives regeneration. Model → partial entry to force. */
    overrides: Record<string, Partial<TableEntry>>;
    /** Numbers of models that once existed. Never reissued. */
    retired: number[];
    tables: Record<string, TableEntry>;
};

type Field = {
    name: string;
    type: string;
    attrs: string;
};

type Model = {
    name: string;
    fields: Field[];
    /** Block-level attributes (`@@id`, `@@unique`, `@@index`, …), verbatim. */
    blockAttrs: string[];
};

/** Strip `//` line comments (including `///` docs) without touching `//` inside strings. */
function stripComments(src: string): string {
    return src
        .split("\n")
        .map((line) => {
            let inStr = false;
            for (let i = 0; i < line.length; i++) {
                if (line[i] === '"') inStr = !inStr;
                if (!inStr && line[i] === "/" && line[i + 1] === "/") return line.slice(0, i);
            }
            return line;
        })
        .join("\n");
}

function parseModels(src: string): Model[] {
    const out: Model[] = [];
    // `model Foo {` … matching `}` at column 0. Prisma always closes blocks unindented.
    const re = /^model\s+(\w+)\s*\{$([\s\S]*?)^\}$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
        const [, name, body] = m;
        const fields: Field[] = [];
        const blockAttrs: string[] = [];
        for (const raw of body.split("\n")) {
            const line = raw.trim();
            if (!line) continue;
            if (line.startsWith("@@")) {
                blockAttrs.push(line);
                continue;
            }
            // `name  Type?  @attr(...) @attr`
            const fm = /^(\w+)\s+(\S+)\s*(.*)$/.exec(line);
            if (!fm) continue;
            fields.push({ name: fm[1], type: fm[2], attrs: fm[3] ?? "" });
        }
        out.push({ name, fields, blockAttrs });
    }
    return out;
}

/**
 * Primary key columns — a single `@id` field, or the tuple from `@@id([a, b])`.
 * The join tables (RolePermission, UserPosition, …) use the compound form, and the
 * worker needs the full tuple to upsert them.
 */
function primaryKey(model: Model): string[] | null {
    const f = model.fields.find((x) => /@id\b/.test(x.attrs));
    if (f) return [f.name];

    const compound = model.blockAttrs.find((a) => a.startsWith("@@id"));
    if (compound) {
        const cols = /\[([^\]]+)\]/.exec(compound);
        if (cols) return cols[1].split(",").map((s) => s.trim()).filter(Boolean);
    }
    return null;
}

/**
 * Every cascade parent: relation fields carrying `onDelete: Cascade`, paired with
 * the local scalar they point through (`fields: [ticketId]` is the FK the worker
 * filters children by).
 *
 * Nullable FKs are EXCLUDED, and that exclusion is load-bearing. `TicketLog.ticketId`
 * is optional because a log may hang off a Person or Company with no ticket at all
 * (the CRM Reconnect timeline). Treating it as a child of Ticket would sync only the
 * rows that have a ticket and silently never pull the customer-attached ones — a
 * whole feature's data missing from the replica with no error to notice.
 */
function cascadeParents(model: Model): { parent: string; fk: string }[] {
    const out: { parent: string; fk: string }[] = [];
    for (const f of model.fields) {
        if (!/onDelete:\s*Cascade/.test(f.attrs)) continue;
        const fk = /fields:\s*\[([^\]]+)\]/.exec(f.attrs);
        if (!fk) continue;
        const cols = fk[1].split(",").map((s) => s.trim()).filter(Boolean);
        if (cols.length !== 1) continue; // composite FK — worker can't filter simply

        // The FK must be required; an optional one leaves parentless rows unreachable.
        const scalar = model.fields.find((x) => x.name === cols[0]);
        if (!scalar || scalar.type.endsWith("?")) continue;

        out.push({ parent: f.type.replace(/[?[\]]/g, ""), fk: cols[0] });
    }
    return out;
}

/** `@@map("pos_shifts")` when present, else the model name is the table name. */
function physicalTable(model: Model): string {
    const mapped = model.blockAttrs.find((a) => a.startsWith("@@map"));
    if (mapped) {
        const m = /@@map\(\s*"([^"]+)"\s*\)/.exec(mapped);
        if (m) return m[1];
    }
    return model.name;
}

function classify(model: Model): TableEntry | { error: string } {
    const pk = primaryKey(model);
    if (!pk) return { error: `${model.name}: no @id or @@id — the worker cannot key rows` };
    const table = physicalTable(model);

    const cascades = cascadeParents(model);
    // Exactly one parent → replace-by-parent is complete and exact for deletes.
    // Two or more (a join table like RolePermission) → replacing on one parent's
    // movement misses rows added when only the OTHER parent changed, so fall through;
    // these are all small link tables that `full` handles correctly.
    if (cascades.length === 1) {
        return { n: 0, table, pk, strategy: "child", parent: cascades[0].parent, fk: cascades[0].fk };
    }
    const updatedAt = model.fields.find((f) => /@updatedAt\b/.test(f.attrs));
    if (updatedAt) return { n: 0, table, pk, strategy: "watermark", column: updatedAt.name };

    const createdAt = model.fields.find((f) => f.name === "createdAt");
    if (createdAt) return { n: 0, table, pk, strategy: "append", column: createdAt.name };

    return { n: 0, table, pk, strategy: "full" };
}

/**
 * Drop fields the final strategy does not use. An override that forces `full` on a
 * table the parser read as `append` would otherwise leave a stale `column` behind,
 * and a worker reading it could delta off a watermark for a table it means to
 * replace wholesale.
 */
function normalize(t: TableEntry): TableEntry {
    const base = { n: t.n, table: t.table, pk: t.pk, strategy: t.strategy };
    if (t.strategy === "child") return { ...base, parent: t.parent, fk: t.fk };
    if (t.strategy === "watermark" || t.strategy === "append") return { ...base, column: t.column };
    return base;
}

function loadRegistry(): Registry {
    if (!existsSync(REGISTRY)) {
        return {
            $comment:
                "Generated by scripts/gen-sync-registry.ts. Numbers are append-only — see the script header. Edit `overrides` by hand; everything else is regenerated.",
            nextNumber: 1,
            ignore: ["_prisma_migrations"],
            overrides: {},
            retired: [],
            tables: {},
        };
    }
    return JSON.parse(readFileSync(REGISTRY, "utf8")) as Registry;
}

function main(): void {
    const check = process.argv.includes("--check");

    const files = readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".prisma")).sort();
    const models: Model[] = [];
    for (const f of files) {
        models.push(...parseModels(stripComments(readFileSync(join(SCHEMA_DIR, f), "utf8"))));
    }
    models.sort((a, b) => a.name.localeCompare(b.name));

    const prev = loadRegistry();
    const errors: string[] = [];
    const tables: Record<string, TableEntry> = {};
    let nextNumber = prev.nextNumber;

    for (const model of models) {
        const c = classify(model);
        if ("error" in c) {
            errors.push(c.error);
            continue;
        }
        // Number is assigned once, then frozen for the life of the model.
        const existing = prev.tables[model.name];
        c.n = existing ? existing.n : nextNumber++;
        tables[model.name] = normalize({ ...c, ...(prev.overrides[model.name] ?? {}) });
    }

    // A model that disappeared retires its number rather than freeing it for reuse:
    // a reused number would inherit the dead model's watermark.
    const retired = [...prev.retired];
    for (const [name, entry] of Object.entries(prev.tables)) {
        if (!tables[name] && !retired.includes(entry.n)) retired.push(entry.n);
    }

    const next: Registry = {
        $comment: prev.$comment,
        nextNumber,
        ignore: prev.ignore ?? ["_prisma_migrations"],
        overrides: prev.overrides,
        retired: retired.sort((a, b) => a - b),
        tables,
    };

    const counts: Record<Strategy, number> = { child: 0, watermark: 0, append: 0, full: 0 };
    for (const t of Object.values(tables)) counts[t.strategy]++;
    const summary = `${models.length} models — ${counts.watermark} watermark, ${counts.child} child, ${counts.append} append, ${counts.full} full`;

    if (errors.length) {
        console.error("[sync-registry] cannot classify:");
        for (const e of errors) console.error("  " + e);
        process.exit(1);
    }

    const serialized = JSON.stringify(next, null, 2) + "\n";

    if (check) {
        // Compare PARSED content, not raw text. Git normalises line endings on this
        // Windows checkout (a stash round-trip alone rewrites the file to CRLF) while
        // this script always writes \n, so a byte comparison reports drift that isn't
        // there — and would fail differently again on a Linux CI runner.
        let current: unknown = null;
        try {
            current = existsSync(REGISTRY) ? JSON.parse(readFileSync(REGISTRY, "utf8")) : null;
        } catch {
            current = null; // unparseable counts as out of date
        }
        if (JSON.stringify(current) !== JSON.stringify(next)) {
            console.error("[sync-registry] out of date — run `pnpm sync:tables`.");
            console.error("  " + summary);
            process.exit(1);
        }
        console.log(`[sync-registry] ok — ${summary}`);
        return;
    }

    writeFileSync(REGISTRY, serialized);
    console.log(`[sync-registry] wrote ${REGISTRY}`);
    console.log(`  ${summary}`);
    if (retired.length) console.log(`  retired numbers: ${retired.join(", ")}`);
}

main();
