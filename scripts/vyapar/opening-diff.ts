/**
 * Compare the clean-room opening against the one the old route built.
 *
 * The two were made from the same source by different methods, which is what makes
 * this worth running:
 *
 *   abeersuite_migrate     party openings DERIVED — Vyapar's 10-Sep closing rolled
 *                          back through the window; ledgers patched onto a restored
 *                          copy of the live database.
 *   abeersuite_migrate-v1  party openings READ from Vyapar's 31-Mar Trial Balance;
 *                          everything built from empty.
 *
 * Where they agree, two methods agree. Where they differ, one of them is wrong — and
 * the known ₹1,040 party gap should show up here named, party by party, instead of
 * as a total nobody could explain.
 *
 *   pnpm vyapar:opening-diff
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { Pool } from "pg";

const OLD_DB = "abeersuite_migrate";
const inr = (n: number) => (n < 0 ? "-" : "") + "₹" + Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
/** v1 marks repaired records with a FIX: tag; the old route never did. */
const bare = (s: string) => s.replace(/^FIX:[A-Z+]+\s+/, "").trim().toLowerCase();

type Bal = Map<string, number>;

async function openings(pool: Pool, party: boolean): Promise<Bal> {
    const m: Bal = new Map();
    for (const r of (await pool.query(`
        select a.name,
               coalesce(case when a."openingBalanceType" = 'CREDIT' then -a."openingBalance" else a."openingBalance" end, 0) v
        from "Account" a
        where coalesce(a."openingBalance", 0) <> 0
          and (a."personId" is not null or a."companyId" is not null) = $1`, [party])).rows) {
        const k = bare(String(r.name));
        m.set(k, (m.get(k) ?? 0) + Number(r.v));
    }
    return m;
}

async function stock(pool: Pool): Promise<Bal> {
    const m: Bal = new Map();
    for (const r of (await pool.query(`
        select name, coalesce("openingStock", 0) q from "InvProduct" where coalesce("openingStock", 0) <> 0`)).rows) {
        const k = bare(String(r.name));
        m.set(k, (m.get(k) ?? 0) + Number(r.q));
    }
    return m;
}

function compare(title: string, unit: (n: number) => string, a: Bal, b: Bal, tol: number, limit = 20): void {
    const keys = new Set([...a.keys(), ...b.keys()]);
    const diffs: Array<[string, number, number]> = [];
    let same = 0;
    for (const k of keys) {
        const x = a.get(k) ?? 0, y = b.get(k) ?? 0;
        if (Math.abs(x - y) <= tol) same++;
        else diffs.push([k, x, y]);
    }
    const net = diffs.reduce((s, [, x, y]) => s + (x - y), 0);
    console.log(`\n${title}`);
    console.log(`  ${keys.size} name(s) · agree ${same} · differ ${diffs.length} · net ${unit(net)}`);
    if (!diffs.length) return;
    console.log(`    ${"".padEnd(42)}${"clean room".padStart(14)}${"old route".padStart(14)}${"gap".padStart(13)}`);
    for (const [k, x, y] of diffs.sort((p, q) => Math.abs(q[1] - q[2]) - Math.abs(p[1] - p[2])).slice(0, limit))
        console.log(`    ${k.slice(0, 40).padEnd(42)}${unit(x).padStart(14)}${unit(y).padStart(14)}${unit(x - y).padStart(13)}`);
    if (diffs.length > limit) console.log(`    … ${diffs.length - limit} more`);
}

async function main(): Promise<void> {
    const url = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
    if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("REFUSING: local only.");
    if (!/migrate-v1/.test(url)) throw new Error(`expected .env.local to point at the clean room, got ${url.replace(/^.*@/, "")}`);

    const nw = new Pool({ connectionString: url, ssl: false, max: 1 });
    const od = new Pool({ connectionString: url.replace(/\/[^/?]+(\?|$)/, `/${OLD_DB}$1`), ssl: false, max: 1 });

    console.log(`\nclean room  abeersuite_migrate-v1   — openings READ from the 31-Mar Trial Balance`);
    console.log(`old route   ${OLD_DB}      — party openings DERIVED by rolling back from 10-Sep`);

    compare("LEDGERS (non-party)", inr, await openings(nw, false), await openings(od, false), 1);
    compare("PARTY OPENINGS", inr, await openings(nw, true), await openings(od, true), 1, 25);
    compare("OPENING STOCK (quantity)", (n) => n.toFixed(2), await stock(nw), await stock(od), 0.001, 15);

    await nw.end();
    await od.end();
}

main().catch((e: Error) => { console.error(`\n${e.message}\n`); process.exit(1); });
