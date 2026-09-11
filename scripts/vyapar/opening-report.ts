/**
 * What the 1-Apr-2026 opening actually contains, for the owner to check.
 *
 * Every figure against the Vyapar report it came from, then the mapping decisions
 * that were judgement rather than transcription — which is the part that needs a
 * human. A total that agrees proves the arithmetic; it does not prove that
 * "Aegis RG FCT" belongs in Office Equipment.
 *
 *   pnpm vyapar:opening-report
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { Pool } from "pg";
import { readFileSync } from "node:fs";

const inr = (n: number) => (n < 0 ? "-" : "") + "₹" + Math.abs(Math.round(n)).toLocaleString("en-IN");

async function main(): Promise<void> {
    const url = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
    const pool = new Pool({ connectionString: url, ssl: false, max: 1 });
    const V = JSON.parse(readFileSync("prisma/seeds/data/vyapar-opening-31mar2026.json", "utf8"));

    const ob = new Map<string, number>();
    for (const r of (await pool.query(
        `select name, coalesce(case when "openingBalanceType" = 'CREDIT' then -"openingBalance" else "openingBalance" end, 0) v
         from "Account"`)).rows) ob.set(String(r.name), Number(r.v));

    console.log(`\n══ LEDGER OPENINGS AT 1-APR-2026 ═══════════════════════════════════\n`);
    const show = (title: string, rows: Array<{ vyapar: string; account: string | null; amount: number }>) => {
        console.log(`${title}`);
        for (const m of rows) {
            if (!m.account) { console.log(`  ${m.vyapar.padEnd(34)}${inr(m.amount).padStart(14)}   not migrated`); continue; }
            const mine = ob.get(m.account);
            const ok = mine != null && Math.abs(mine - m.amount) <= 1;
            console.log(`  ${m.vyapar.padEnd(34)}${inr(m.amount).padStart(14)}  →  ${m.account.padEnd(36)}${ok ? "✓" : "⚠ " + (mine == null ? "NO LEDGER" : inr(mine))}`);
        }
        console.log("");
    };
    show("MONEY   vyapar ledger → ours", V.money.filter((m: { amount?: number }) => typeof m.amount === "number"));
    show("LOANS", V.loans.filter((l: { amount?: number }) => typeof l.amount === "number"));

    console.log(`FIXED ASSETS   20 Vyapar items → 6 of our ledgers  (the grouping is MY judgement)`);
    for (const f of V.fixedAssets.items)
        console.log(`  ${String(f.name).slice(0, 34).padEnd(34)}${inr(f.amount).padStart(14)}  →  ${f.ledger}`);
    console.log(`  ${"".padEnd(34)}${inr(Object.values(V.fixedAssets.byLedger).reduce((s: number, v) => s + Number(v), 0)).padStart(14)}   total = Vyapar's ₹4,83,396\n`);

    // ── The FIX: rows ───────────────────────────────────────────────────────
    const fixParties = (await pool.query(
        `select a.name, coalesce(case when a."openingBalanceType" = 'CREDIT' then -a."openingBalance" else a."openingBalance" end, 0) v
         from "Account" a where a.name like 'FIX:%' and (a."personId" is not null or a."companyId" is not null)
         order by abs(coalesce(a."openingBalance", 0)) desc, a.name`)).rows;
    const fixItems = (await pool.query(
        `select name, sku, "openingStock" q, "openingRate" r from "InvProduct" where name like 'FIX:%'
         order by coalesce("openingStock", 0) * coalesce("openingRate", 0) desc, name`)).rows;

    console.log(`══ RECORDS I REPAIRED — search "FIX:" in the app ════════════════════\n`);
    console.log(`${fixParties.length} parties · ${fixItems.length} products\n`);
    const withMoney = fixParties.filter((p) => Math.abs(Number(p.v)) > 0);
    console.log(`Of the repaired parties, ${withMoney.length} carry an opening balance — check these first:`);
    for (const p of withMoney.slice(0, 25)) console.log(`  ${inr(Number(p.v)).padStart(13)}   ${p.name}`);
    console.log("");
    const itemsWithValue = fixItems.filter((i) => Number(i.q) * Number(i.r) !== 0);
    console.log(`Of the repaired products, ${itemsWithValue.length} carry stock value — check these first:`);
    for (const i of itemsWithValue.slice(0, 25))
        console.log(`  ${inr(Number(i.q) * Number(i.r)).padStart(13)}   qty ${String(i.q).padStart(8)}  ${String(i.name).slice(0, 54)}`);

    // ── Totals ──────────────────────────────────────────────────────────────
    const g = (await pool.query(`
        select g.name grp, sum(coalesce(case when a."openingBalanceType" = 'CREDIT' then -a."openingBalance" else a."openingBalance" end, 0)) v
        from "Account" a join "AccountGroup" g on g.id = a."groupId"
        where coalesce(a."openingBalance", 0) <> 0 group by 1 order by 1`)).rows;
    console.log(`\n══ EVERY GROUP HOLDING AN OPENING ══════════════════════════════════\n`);
    let net = 0;
    for (const r of g) { net += Number(r.v); console.log(`  ${String(r.grp).padEnd(26)}${inr(Number(r.v)).padStart(15)}`); }
    const st = (await pool.query(
        `select coalesce(sum(coalesce("openingStock", 0) * coalesce("openingRate", 0)), 0) v from "InvProduct"`)).rows[0];
    console.log(`  ${"Opening stock (inventory)".padEnd(26)}${inr(Number(st.v)).padStart(15)}   ⓘ derived — awaiting the 31-Mar stock summary`);
    console.log(`  ${"".padEnd(26)}${inr(net + Number(st.v)).padStart(15)}   net assets before the capital/plug entry\n`);

    await pool.end();
}

main().catch((e: Error) => { console.error(`\n${e.message}\n`); process.exit(1); });
