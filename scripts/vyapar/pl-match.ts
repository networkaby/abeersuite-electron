/**
 * Expenses, income and fixed assets, against Vyapar — the last untested ledgers.
 *
 * Every check so far has tested a BALANCE SHEET position: parties, cash, banks,
 * stock. A misrouted expense head is invisible to all of them, because a wrong
 * ledger still balances. So this compares head by head.
 *
 * There is no Vyapar P&L export for this window, so the comparison is built from
 * Vyapar's own transaction rows: type 7 expenses grouped by `txn_category_id`, type
 * 29 other income, and sales and purchases from their line totals. That is a sum of
 * source rows rather than a reconstruction of Vyapar's internal logic — the thing
 * that went wrong with the bank ledgers was inventing sign rules for undocumented
 * adjustment codes, and none of that is happening here.
 *
 * Fixed assets are a straight position check: the 31-Mar opening plus whatever the
 * window bought should be Vyapar's 11-Sep figure.
 *
 *   pnpm vyapar:pl-match
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { FY_START, extractItems, extractParties } from "./extract";
import { buildMaps } from "./mapping";
import { openVyb } from "./openVyb";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_VYB = "D:/AbeerSuite/11-09-2026_05.55.41_Network_Service_VypBackup.vyb";
const inr = (n: number) => (n < 0 ? "-" : "") + "₹" + Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const TOL = 2;

async function main(): Promise<void> {
    const url = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
    if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("REFUSING: local copy only, never live.");
    console.log(`\ntarget: ${url.replace(/^.*@/, "")}`);

    const { db, close } = openVyb(process.argv.find((a) => a.endsWith(".vyb")) ?? DEFAULT_VYB, join(tmpdir(), "vy-pl"));
    const pool = new Pool({ connectionString: url, ssl: false, max: 1 });

    const named = (sql: string) => {
        const m = new Map<number, string>();
        for (const r of db.prepare(sql).all() as Array<Record<string, unknown>>) m.set(Number(r.id), String(r.nm).trim());
        return m;
    };
    const headNames = named(`select name_id id, full_name nm from kb_names where name_type = 2`);
    const { maps } = await buildMaps(
        pool, extractParties(db), extractItems(db),
        named(`select paymentType_id id, paymentType_name nm from kb_paymentTypes`),
        headNames,
        named(`select name_id id, full_name nm from kb_names where name_type = 3`),
    );

    // Our side: movement only. Expense and income ledgers carry no opening.
    const ours = new Map<number, number>();
    for (const r of (await pool.query(`
        select a.id, coalesce(sum(case when l.type = 'DEBIT' then l.amount else -l.amount end), 0) v
        from "Account" a left join "VoucherGlLine" l on l."accountId" = a.id group by a.id`)).rows)
        ours.set(Number(r.id), Number(r.v));
    const nameOf = new Map<number, string>();
    for (const r of (await pool.query(`select id, name from "Account"`)).rows) nameOf.set(Number(r.id), String(r.name));

    // ── Expense heads ───────────────────────────────────────────────────────
    // Vyapar's expense total is cash + credit; the head is txn_category_id.
    const theirs = new Map<number, number>();
    for (const r of db.prepare(`
        select txn_category_id cat, sum(coalesce(txn_cash_amount, 0) + coalesce(txn_balance_amount, 0)) amt
        from kb_transactions where txn_type = 7 and date(txn_date) >= ? group by 1`)
        .all(FY_START) as Array<Record<string, unknown>>) {
        if (r.cat == null) continue;
        theirs.set(Number(r.cat), Number(r.amt));
    }

    type Row = { head: string; ledger: string; vy: number; us: number };
    const rows: Row[] = [];
    const merged = new Map<number, { vy: number; heads: string[] }>();
    for (const [cat, amt] of theirs) {
        const acc = maps.expenseHead.get(cat);
        if (acc == null) { console.log(`  ⚠ expense head "${headNames.get(cat) ?? cat}" ${inr(amt)} is not mapped`); continue; }
        const m = merged.get(acc) ?? { vy: 0, heads: [] };
        m.vy += amt; m.heads.push(headNames.get(cat) ?? String(cat));
        merged.set(acc, m);
    }
    for (const [acc, m] of merged)
        rows.push({ head: m.heads.join(" + "), ledger: nameOf.get(acc) ?? String(acc), vy: m.vy, us: ours.get(acc) ?? 0 });

    console.log(`\nEXPENSE HEADS — Vyapar type-7 totals for the window vs our ledgers\n`);
    console.log(`  ${"vyapar head".padEnd(34)}${"vyapar".padStart(13)}${"ours".padStart(13)}${"gap".padStart(12)}`);
    let ok = 0;
    const bad: Row[] = [];
    for (const r of rows.sort((a, b) => b.vy - a.vy)) {
        const gap = Math.round((r.us - r.vy) * 100) / 100;
        if (Math.abs(gap) <= TOL) ok++; else bad.push(r);
        console.log(`  ${r.head.slice(0, 32).padEnd(34)}${inr(r.vy).padStart(13)}${inr(r.us).padStart(13)}` +
            `${inr(gap).padStart(12)}   ${Math.abs(gap) <= TOL ? "✓" : "⚠ → " + r.ledger}`);
    }
    console.log(`\n  ${ok} of ${rows.length} heads agree` +
        `${bad.length ? ` · ${bad.length} differ, net ${inr(bad.reduce((s, r) => s + (r.us - r.vy), 0))}` : " · net ₹0"}`);

    // ── Income and trading ──────────────────────────────────────────────────
    const one = (sql: string, ...a: unknown[]) => Number((db.prepare(sql).get(...a as never[]) as { v: number }).v ?? 0);
    const sales = one(`select coalesce(sum(l.total_amount - coalesce(l.lineitem_tax_amount, 0)), 0) v
        from kb_lineitems l join kb_transactions t on t.txn_id = l.lineitem_txn_id
        where t.txn_type = 1 and date(t.txn_date) >= ?`, FY_START);
    const purch = one(`select coalesce(sum(l.total_amount - coalesce(l.lineitem_tax_amount, 0)), 0) v
        from kb_lineitems l join kb_transactions t on t.txn_id = l.lineitem_txn_id
        where t.txn_type = 2 and date(t.txn_date) >= ?`, FY_START);
    const otherInc = one(`select coalesce(sum(coalesce(txn_cash_amount, 0) + coalesce(txn_balance_amount, 0)), 0) v
        from kb_transactions where txn_type = 29 and date(txn_date) >= ?`, FY_START);

    const byName = new Map<string, number>();
    for (const [id, v] of ours) byName.set(nameOf.get(id) ?? "", v);
    console.log(`\nTRADING AND OTHER INCOME — line totals net of GST\n`);
    console.log(`  ${"".padEnd(34)}${"vyapar".padStart(13)}${"ours".padStart(13)}${"gap".padStart(12)}`);
    const cmp = (label: string, vy: number, us: number) => {
        const gap = Math.round((us - vy) * 100) / 100;
        console.log(`  ${label.padEnd(34)}${inr(vy).padStart(13)}${inr(us).padStart(13)}${inr(gap).padStart(12)}` +
            `   ${Math.abs(gap) <= TOL ? "✓" : "⚠"}`);
    };
    cmp("Sales (net of GST)", sales, -(byName.get("Sales A/c") ?? 0));
    cmp("Purchases (net of GST)", purch, byName.get("Purchase A/c") ?? 0);
    cmp("Other income", otherInc, -(byName.get("income Other Revenue") ?? 0) - (byName.get("Interest Received") ?? 0));

    // ── Fixed assets ────────────────────────────────────────────────────────
    const fa = (await pool.query(`
        select coalesce(sum(coalesce(case when a."openingBalanceType" = 'CREDIT' then -a."openingBalance" else a."openingBalance" end, 0)), 0) ob,
               coalesce(sum(coalesce(a.balance, 0)), 0) mv
        from "Account" a join "AccountGroup" g on g.id = a."groupId" where g.name = 'Fixed Assets'`)).rows[0];
    console.log(`\nFIXED ASSETS\n`);
    console.log(`  opening 31-Mar ${inr(Number(fa.ob)).padStart(14)}   + window ${inr(Number(fa.mv)).padStart(10)}` +
        `   = ${inr(Number(fa.ob) + Number(fa.mv))}`);
    const want = 486094.95;
    const gap = Math.round((Number(fa.ob) + Number(fa.mv) - want) * 100) / 100;
    console.log(`  vyapar 11-Sep Balance Sheet ${inr(want).padStart(14)}   gap ${inr(gap)}   ${Math.abs(gap) <= TOL ? "✓" : "⚠"}`);

    await pool.end();
    close();
}

main().catch((e: Error) => { console.error(`\n${e.message}\n`); process.exit(1); });
