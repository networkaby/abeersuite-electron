/**
 * PHASE 1 — load the 1-Apr-2026 opening from Vyapar's own year-close file.
 *
 * The owner ran Vyapar's Close Books at 31-Mar-2026, which produced a file where
 * Vyapar itself states the opening: party balances as type 5/6 transactions, stock
 * per item as type-10 adjustments carrying a real unit cost, fixed assets as type
 * 62, and ledger balances on `kb_paymentTypes`. Every figure below is READ from it.
 *
 * That matters because everything it replaces was mine: a transcription of two PDFs
 * for the ledgers and 72 party balances, and a DERIVED stock rate that applied
 * September unit costs to March quantities and was ₹14,396 adrift. Vyapar had the
 * right answer all along; it just had to be asked for it in the right format.
 *
 * ── This is deliberately opening-only ───────────────────────────────────────
 * Closings WILL break, and that is the plan. Four party ledgers carry a fabricated
 * opening that exists purely to cancel a movement we never post — ByteBack shows an
 * opening of ₹2,000 and a payment of ₹2,000 that never happened, which is why its
 * closing looked right. Correcting the opening alone exposes that, which is the
 * point: phase 2 posts the missing vouchers and the closings come back.
 *
 * ── Every opening is cleared first ──────────────────────────────────────────
 * Not only the ones this file names. Six separate residues survived earlier passes
 * because each clear was scoped to ledgers someone had thought of: Counter 21's
 * ₹25,109, the Vault's ₹9,503, Cheques in Hand's ₹2,10,790, Free Carry Bag's
 * ₹10,000, Capital's ₹98,419, Suspense's ₹1,825. Clearing everything makes residue
 * impossible instead of a thing to keep catching.
 *
 *   pnpm vyapar:opening-load              # report only
 *   pnpm vyapar:opening-load -- --apply
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

const YEAR_CLOSE = "D:/AbeerSuite/opeing at 1-4-26 -11-09-2026_23.37.41_Network_Service_VypBackup.vyb";
const OPENINGS = "prisma/seeds/data/vyapar-opening-31mar2026.json";
/** Vyapar's own opening markers, all dated 1-Apr-2026 in the year-close file. */
const RECEIVABLE_OPENING = 5, PAYABLE_OPENING = 6, STOCK_OPENING = 10, ASSET_OPENING = 62;
/** Loans state their opening as a loan_transactions row, not on kb_paymentTypes. */
const LOAN_OPENING = 44;

const inr = (n: number) => (n < 0 ? "-" : "") + "₹" + Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

type Money = { vyapar: string; account: string | null; amount?: number; create?: string };

async function main(): Promise<void> {
    const apply = process.argv.includes("--apply");
    const url = (process.env.DIRECT_URL_1 ?? process.env.DATABASE_URL_1 ?? "").replace(/[?&]sslmode=[^&]*/g, "");
    if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("REFUSING: local copy only, never live.");
    console.log(`\ntarget: ${url.replace(/^.*@/, "")}`);

    const V = JSON.parse(readFileSync(OPENINGS, "utf8")) as {
        money: Money[];
        loans: Array<{ vyapar: string; account: string; create?: string }>;
        interestLedgers: { create: Array<{ account: string; group: string }> };
        fixedAssets: { items: Array<{ itemId: number; ledger: string }> };
    };
    const ledgerFor = new Map(V.fixedAssets.items.map((f) => [f.itemId, f.ledger]));

    const { db, close } = openVyb(process.argv.find((a) => a.endsWith(".vyb")) ?? YEAR_CLOSE, join(tmpdir(), "vy-load"));
    const pool = new Pool({ connectionString: url, ssl: false, max: 1 });

    const named = (sql: string) => {
        const m = new Map<number, string>();
        for (const r of db.prepare(sql).all() as Array<Record<string, unknown>>) m.set(Number(r.id), String(r.nm).trim());
        return m;
    };
    const { maps } = await buildMaps(
        pool, extractParties(db), extractItems(db),
        named(`select paymentType_id id, paymentType_name nm from kb_paymentTypes`),
        named(`select name_id id, full_name nm from kb_names where name_type = 2`),
        named(`select name_id id, full_name nm from kb_names where name_type = 3`),
    );

    // ── 1. Cash, bank, wallet and card ──────────────────────────────────────
    const payAccount = new Map<string, string>();
    for (const m of V.money) if (m.account) payAccount.set(m.vyapar, m.account);
    const ledgers: Array<{ name: string; amount: number }> = [];
    for (const r of db.prepare(
        `select paymentType_name nm, paymentType_opening_balance ob from kb_paymentTypes`).all() as Array<Record<string, unknown>>) {
        const amt = Number(r.ob) || 0;
        if (Math.abs(amt) < 0.005) continue;
        const acc = payAccount.get(String(r.nm).trim());
        if (!acc) { console.log(`  ⚠ Vyapar ledger "${r.nm}" holds ${inr(amt)} and is not mapped`); continue; }
        ledgers.push({ name: acc, amount: amt });
    }

    // ── 1b. Loans ───────────────────────────────────────────────────────────
    // These live in `loan_transactions`, NOT `kb_paymentTypes`, and missing that cost
    // ₹9,78,044: the clear-everything rule wiped their openings and the reload only
    // covered the money ledgers, so all six read as movement with nothing under it.
    // Clearing everything is still right — but it obliges this file to reload
    // everything it clears, and a ledger that lives somewhere unexpected is exactly
    // what slips through.
    const loanAccount = new Map<string, string>();
    for (const l of V.loans) loanAccount.set(l.vyapar, l.account);
    for (const r of db.prepare(`
        select a.loan_account_name nm, t.principal_amount p
        from loan_transactions t join loan_accounts a on a.loan_account_id = t.loan_account_id
        where t.loan_txn_type = ?`).all(LOAN_OPENING) as Array<Record<string, unknown>>) {
        const amt = Number(r.p) || 0;
        // Vyapar leaves floating-point dust (2.5e-12) on settled loans.
        if (Math.abs(amt) < 0.005) continue;
        const acc = loanAccount.get(String(r.nm).trim());
        if (!acc) { console.log(`  ⚠ Vyapar loan "${r.nm}" holds ${inr(amt)} and is not mapped`); continue; }
        ledgers.push({ name: acc, amount: -amt });   // a loan is a liability
    }

    // ── 2. Parties, from Vyapar's own opening transactions ──────────────────
    // Types 31/32 ("Payment In/Out Opening Balance") are deliberately NOT read.
    // They record how much of an opening was already settled, and the same money
    // appears again as a real receipt — proven on "Jahidul junmoni", where counting
    // them moved the gap by ₹5.86 lakh. Types 5 and 6 alone reproduce Vyapar's own
    // Trial Balance exactly, which is the check that they are the whole story.
    const partyOpening = new Map<number, number>();
    for (const r of db.prepare(`
        select txn_name_id nid, txn_type ty, coalesce(txn_balance_amount, 0) + coalesce(txn_cash_amount, 0) amt
        from kb_transactions where txn_type in (?, ?) and txn_name_id is not null`)
        .all(RECEIVABLE_OPENING, PAYABLE_OPENING) as Array<Record<string, unknown>>) {
        const nid = Number(r.nid);
        const sign = Number(r.ty) === RECEIVABLE_OPENING ? 1 : -1;
        partyOpening.set(nid, (partyOpening.get(nid) ?? 0) + sign * Number(r.amt));
    }

    // ── 3. Fixed assets and opening stock, both per item ────────────────────
    const assetByLedger = new Map<string, number>();
    let assetUnmapped = 0;
    for (const r of db.prepare(
        `select item_adj_item_id id, item_adj_quantity q, item_adj_atprice p
         from kb_item_adjustments where item_adj_type = ?`).all(ASSET_OPENING) as Array<Record<string, unknown>>) {
        const led = ledgerFor.get(Number(r.id));
        const val = Number(r.q) * Number(r.p);
        if (!led) { assetUnmapped += val; continue; }
        assetByLedger.set(led, (assetByLedger.get(led) ?? 0) + val);
    }

    const stock: Array<{ productId: number; qty: number; rate: number }> = [];
    let stockUnmapped = 0, stockQty = 0, stockVal = 0;
    for (const r of db.prepare(
        `select item_adj_item_id id, item_adj_quantity q, item_adj_atprice p
         from kb_item_adjustments where item_adj_type = ?`).all(STOCK_OPENING) as Array<Record<string, unknown>>) {
        const pid = maps.product.get(Number(r.id));
        const qty = Number(r.q), rate = Number(r.p);
        if (pid == null) { stockUnmapped++; continue; }
        stock.push({ productId: pid, qty, rate });
        stockQty += qty; stockVal += qty * rate;
    }

    // ── Report ──────────────────────────────────────────────────────────────
    let dr = 0, cr = 0, pUnmapped = 0;
    const partyRows: Array<{ accountId: number; amount: number }> = [];
    for (const [nid, amt] of partyOpening) {
        if (Math.abs(amt) < 0.005) continue;
        const acc = maps.party.get(nid);
        if (!acc) { pUnmapped++; continue; }
        partyRows.push({ accountId: acc.accountId, amount: amt });
        if (amt > 0) dr += amt; else cr += -amt;
    }

    const assetTotal = [...assetByLedger.values()].reduce((s, v) => s + v, 0);
    const line = (l: string, ours: number, pub: number) =>
        console.log(`  ${l.padEnd(28)}${inr(ours).padStart(16)}${inr(pub).padStart(16)}   ${Math.abs(ours - pub) <= 1 ? "✓" : "⚠"}`);

    console.log(`\nOPENING AT 1-APR-2026, read from Vyapar's year-close file\n`);
    console.log(`  ${"".padEnd(28)}${"from vyapar".padStart(16)}${"published".padStart(16)}`);
    line("party receivable", dr, 26678);
    line("party payable", -cr, -254303.20);
    line("fixed assets", assetTotal, 483395.95);
    line("ledger openings (incl. loans)", ledgers.reduce((s, l) => s + l.amount, 0), -484726.45 - 978044);
    console.log(`  ${"opening stock".padEnd(28)}${inr(stockVal).padStart(16)}${inr(858903.96).padStart(16)}` +
        `   ⓘ ${stockQty.toLocaleString("en-IN")} units at Vyapar's own per-item cost`);
    console.log(`\n  ${ledgers.length} ledgers · ${partyRows.length} parties · ${assetByLedger.size} asset ledgers · ${stock.length} products`);
    if (pUnmapped) console.log(`  ⚠ ${pUnmapped} party opening(s) have no account here`);
    if (stockUnmapped) console.log(`  ⚠ ${stockUnmapped} stock opening(s) have no product here`);
    if (assetUnmapped) console.log(`  ⚠ ${inr(assetUnmapped)} of fixed assets not mapped to a ledger`);

    if (!apply) { console.log(`\nNothing written. Re-run with --apply.\n`); await pool.end(); close(); return; }

    // ── Write ───────────────────────────────────────────────────────────────
    const toCreate = [
        ...V.interestLedgers.create,
        ...V.loans.filter((l) => l.create).map((l) => ({ account: l.account, group: l.create! })),
        ...V.money.filter((m) => m.create && m.account).map((m) => ({ account: m.account!, group: m.create! })),
    ];
    for (const c of toCreate) {
        await pool.query(
            `insert into "Account" (name, "groupId", "isActive", "createdAt", "updatedAt")
             select $1, g.id, true, now(), now() from "AccountGroup" g
             where g.name = $2 and not exists (select 1 from "Account" where name = $1)`, [c.account, c.group]);
    }

    console.log(`\nAPPLYING …`);
    const wiped = await pool.query(
        `update "Account" set "openingBalance" = null, "openingBalanceType" = null where coalesce("openingBalance", 0) <> 0`);
    const wipedStock = await pool.query(
        `update "InvProduct" set "openingStock" = 0, "openingRate" = 0, "openingValue" = 0
         where coalesce("openingStock", 0) <> 0 or coalesce("openingRate", 0) <> 0`);
    console.log(`  cleared ${wiped.rowCount} ledger and ${wipedStock.rowCount} product opening(s)`);

    const setLedger = async (name: string, amount: number) => {
        const r = await pool.query(
            `update "Account" set "openingBalance" = $2, "openingBalanceType" = $3::"EntryType" where name = $1`,
            [name, Math.abs(amount).toFixed(2), amount >= 0 ? "DEBIT" : "CREDIT"]);
        if (r.rowCount === 0) console.log(`  ⚠ no ledger named "${name}"`);
    };
    for (const l of ledgers) await setLedger(l.name, l.amount);
    for (const [led, val] of assetByLedger) await setLedger(led, val);
    for (const p of partyRows) {
        await pool.query(
            `update "Account" set "openingBalance" = $2, "openingBalanceType" = $3::"EntryType" where id = $1`,
            [p.accountId, Math.abs(p.amount).toFixed(2), p.amount >= 0 ? "DEBIT" : "CREDIT"]);
    }
    for (const s of stock) {
        await pool.query(
            `update "InvProduct" set "openingStock" = $2, "openingRate" = $3, "openingValue" = $4 where id = $1`,
            [s.productId, s.qty, s.rate.toFixed(2), (s.qty * s.rate).toFixed(2)]);
    }

    console.log(`  wrote ${ledgers.length + assetByLedger.size} ledger · ${partyRows.length} party · ${stock.length} stock opening(s)`);
    console.log(`\nphase 1 done — closings will NOT reconcile until phase 2 posts the missing vouchers\n`);
    await pool.end();
    close();
}

main().catch((e: Error) => { console.error(`\n${e.message}\n`); process.exit(1); });
