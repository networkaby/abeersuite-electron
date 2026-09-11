/**
 * Does the migrated result agree with Vyapar? Party by party, product by product,
 * ledger by ledger.
 *
 * This is the only question that matters, and it is asked against figures Vyapar
 * published rather than figures we derived: `kb_names.amount` and
 * `item_stock_quantity` are what its own Party Statement and Stock Summary show,
 * verified earlier against the owner's exports (3,754 parties and 1,437 items, zero
 * differences).
 *
 * The arithmetic under test:
 *     opening at 31-Mar  +  everything the replay posted  =  Vyapar's 10-Sep closing
 *
 * Both halves were built independently — the opening by rolling Vyapar's closing
 * BACK through the window, the movement by replaying each voucher FORWARD through
 * the GL engine. They only agree if both are right, which is what makes this a test
 * rather than a restatement.
 *
 *   pnpm vyapar:reconcile
 *   pnpm vyapar:reconcile -- --all    # list every difference, not just the largest
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { extractItems, extractParties } from "./extract";
import { buildMaps } from "./mapping";
import { openVyb } from "./openVyb";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_VYB = "D:/AbeerSuite/11-09-2026_05.55.41_Network_Service_VypBackup.vyb";
const inr = (n: number) => (n < 0 ? "-" : "") + "₹" + Math.abs(Math.round(n)).toLocaleString("en-IN");
/** Vyapar rounds to paise; anything under a rupee is its noise, not our error. */
const TOL = 1;

async function main(): Promise<void> {
    const showAll = process.argv.includes("--all");
    const url = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
    if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("REFUSING: local copy only, never live.");

    const { db, close } = openVyb(process.argv.find((a) => a.endsWith(".vyb")) ?? DEFAULT_VYB, join(tmpdir(), "vy-recon"));
    const pool = new Pool({ connectionString: url, ssl: false, max: 1 });

    const named = (sql: string) => {
        const m = new Map<number, string>();
        for (const r of db.prepare(sql).all() as Array<Record<string, unknown>>) m.set(Number(r.id), String(r.nm).trim());
        return m;
    };
    const parties = extractParties(db);
    const items = extractItems(db);
    const { maps } = await buildMaps(
        pool, parties, items,
        named(`select paymentType_id id, paymentType_name nm from kb_paymentTypes`),
        named(`select name_id id, full_name nm from kb_names where name_type = 2`),
        named(`select name_id id, full_name nm from kb_names where name_type = 3`),
    );

    // ── Parties ─────────────────────────────────────────────────────────────
    // Closing = the master opening (signed by its Dr/Cr) plus the running balance
    // the engine accumulated from the replayed vouchers.
    //
    // `Account.balance` is kept in the account's NATURAL direction, not as a signed
    // debit. Party ledgers carry a null `normalBalance`, so the GROUP decides: on a
    // Sundry Debtor (ASSET) positive means receivable, but on a Sundry Creditor
    // (LIABILITY) positive means PAYABLE — the opposite of the convention used here
    // and by Vyapar. Reading it raw inverted all 22 creditor balances and produced
    // differences that were exactly double the amount, which is the giveaway.
    const ours = new Map<number, number>();
    for (const r of (await pool.query(`
        select a.id,
               coalesce(case when a."openingBalanceType" = 'CREDIT' then -a."openingBalance" else a."openingBalance" end, 0)
             + coalesce(a.balance, 0) * (case when g.type in ('LIABILITY', 'INCOME') then -1 else 1 end) closing
        from "Account" a left join "AccountGroup" g on g.id = a."groupId"
    `)).rows) ours.set(r.id, Number(r.closing));

    type Diff = { name: string; theirs: number; mine: number; gap: number };
    const pDiffs: Diff[] = [];
    let pOk = 0;
    for (const p of parties) {
        if (!p.include) continue;
        const acc = maps.party.get(p.nameId);
        if (!acc) continue;
        const mine = round2(ours.get(acc.accountId) ?? 0);
        const gap = round2(mine - p.balance);
        if (Math.abs(gap) <= TOL) pOk++;
        else pDiffs.push({ name: p.name, theirs: p.balance, mine, gap });
    }

    // ── Stock ───────────────────────────────────────────────────────────────
    const stockOurs = new Map<number, number>();
    for (const r of (await pool.query(`
        select p.id,
               coalesce(p."openingStock", 0)
             + coalesce((select sum(s."inQty" - s."outQty") from "InvStockLedger" s where s."productId" = p.id), 0) qty
        from "InvProduct" p
    `)).rows) stockOurs.set(r.id, Number(r.qty));

    const sDiffs: Array<{ name: string; theirs: number; mine: number; gap: number }> = [];
    let sOk = 0;
    for (const i of items) {
        // item_type 5 is office equipment, not stock. It lives in the fixed-asset
        // ledgers now (payments.ts moved it there), so counting it here would
        // demand a quantity we deliberately zeroed.
        if (i.itemType === 5) continue;
        const pid = maps.product.get(i.itemId);
        if (pid == null) continue;
        const mine = round2(stockOurs.get(pid) ?? 0);
        const gap = round2(mine - i.qty);
        if (Math.abs(gap) < 0.001) sOk++;
        else sDiffs.push({ name: i.name, theirs: i.qty, mine, gap });
    }

    // ── Report ──────────────────────────────────────────────────────────────
    const show = (rows: Diff[], unit: (n: number) => string) => {
        const list = showAll ? rows : [...rows].sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)).slice(0, 12);
        console.log(`    ${"".padEnd(36)}${"vyapar".padStart(13)}${"ours".padStart(13)}${"gap".padStart(12)}`);
        for (const d of list) {
            console.log(`    ${d.name.slice(0, 34).padEnd(36)}${unit(d.theirs).padStart(13)}${unit(d.mine).padStart(13)}${unit(d.gap).padStart(12)}`);
        }
        if (!showAll && rows.length > 12) console.log(`    … ${rows.length - 12} more (use --all)`);
    };

    const pTotal = pOk + pDiffs.length;
    console.log(`\nPARTY BALANCES as at 10-Sep-2026 — opening(31-Mar) + replayed movement vs Vyapar`);
    console.log(`  agree: ${pOk} of ${pTotal}  (${((pOk / pTotal) * 100).toFixed(1)}%)` +
        `  ·  differ: ${pDiffs.length}, net ${inr(pDiffs.reduce((s, d) => s + d.gap, 0))}`);
    if (pDiffs.length) show(pDiffs, inr);

    const sTotal = sOk + sDiffs.length;
    console.log(`\nSTOCK QUANTITY as at 10-Sep-2026 — opening(31-Mar) + replayed movement vs Vyapar`);
    console.log(`  agree: ${sOk} of ${sTotal}  (${((sOk / sTotal) * 100).toFixed(1)}%)` +
        `  ·  differ: ${sDiffs.length}, net ${sDiffs.reduce((s, d) => s + d.gap, 0).toFixed(2)} units`);
    if (sDiffs.length) show(sDiffs, (n) => n.toFixed(2));

    // ── Money ledgers ───────────────────────────────────────────────────────
    // Added after this file reported 100% while Petty Cash read ₹22.5L against
    // Vyapar's ₹12,479. Parties and products were genuinely right; the ₹22,51,824
    // of till cash banked in the window had simply never been replayed, because a
    // contra touches neither a party nor a product and so appeared in neither check.
    // A reconciliation is only worth what it looks at.
    const mDiffs: Diff[] = [];
    let mOk = 0;
    const V = JSON.parse(readFileSync("prisma/seeds/data/vyapar-opening-31mar2026.json", "utf8")) as {
        money: Array<{ vyapar: string; account: string | null }>;
        loans: Array<{ vyapar: string; account: string | null }>;
        fixedAssets: { byLedger: Record<string, number> };
        closing: { money: Record<string, number>; loans: Record<string, number>; totals: Record<string, number> };
    };
    const byName = new Map<string, number>();
    for (const r of (await pool.query(`
        select a.name,
               coalesce(case when a."openingBalanceType" = 'CREDIT' then -a."openingBalance" else a."openingBalance" end, 0)
             + coalesce(a.balance, 0) * (case when g.type in ('LIABILITY', 'INCOME') then -1 else 1 end) closing
        from "Account" a left join "AccountGroup" g on g.id = a."groupId"
    `)).rows) byName.set(String(r.name), Number(r.closing));

    for (const l of [...V.money, ...V.loans]) {
        if (!l.account) continue;
        const theirs = V.closing.money[l.vyapar] ?? V.closing.loans[l.vyapar];
        if (theirs === undefined) continue;
        const mine = round2(byName.get(l.account) ?? 0);
        const gap = round2(mine - theirs);
        if (Math.abs(gap) <= TOL) mOk++;
        else mDiffs.push({ name: `${l.vyapar} → ${l.account}`, theirs, mine, gap });
    }
    const mTotal = mOk + mDiffs.length;
    console.log(`
MONEY & LOAN LEDGERS as at 11-Sep-2026 — vs Vyapar's own Balance Sheet`);
    console.log(`  agree: ${mOk} of ${mTotal}  (${((mOk / mTotal) * 100).toFixed(1)}%)` +
        `  ·  differ: ${mDiffs.length}, net ${inr(mDiffs.reduce((s, d) => s + d.gap, 0))}`);
    if (mDiffs.length) show(mDiffs, inr);

    // ── Books-level sanity ──────────────────────────────────────────────────
    const imbalance = (await pool.query(
        `select coalesce(round(sum(case when type = 'DEBIT' then amount else -amount end), 2), 0) v from "VoucherGlLine"`,
    )).rows[0].v;
    const posted = (await pool.query(`select count(*)::int n from "UniversalVoucher"`)).rows[0].n;
    console.log(`\n  ${posted} vouchers posted · GL imbalance ${imbalance}`);
    console.log(`\n${pDiffs.length === 0 && sDiffs.length === 0 && mDiffs.length === 0 && Number(imbalance) === 0
        ? "✓ reconciled" : "⚠ differences above — investigate before pushing to live"}\n`);

    await pool.end();
    close();
}

const round2 = (n: number) => Math.round(n * 100) / 100;

main().catch((e: Error) => { console.error(`\n${e.message}\n`); process.exit(1); });
