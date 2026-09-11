/**
 * The half of the books nothing has ever checked: GST, income and expenses.
 *
 * Every check written so far tests a BALANCE SHEET line — parties, stock, banks,
 * loans. All of them could pass while an expense head points at the wrong ledger,
 * because a misposting still balances. And GST is the one figure here with a filing
 * consequence, so being quietly wrong about it costs more than being wrong about a
 * drawer float.
 *
 * ── GST ─────────────────────────────────────────────────────────────────────
 * Vyapar never clears its GST ledgers when a return is filed, so both exports show a
 * running total since 2023 — ₹21,97,846 of Output at 31-Mar is tax charged over three
 * years, not tax owed. Ours open at NIL by the owner's decision, which makes the test
 * exact rather than approximate: our balance must equal the DIFFERENCE between the two
 * published figures, and nothing else.
 *
 * One wrinkle that is presentation, not disagreement, and it cost an hour to pin down:
 * Vyapar keeps Input and Output as separate ledgers and folds a RETURN back into the
 * bucket it came from. We keep one ledger per tax and post the return to the other
 * side of it. Read raw, that makes both our halves look ₹5,270 too big while the net
 * is right — a compensating error, which is exactly the shape worth being suspicious
 * of. So input is taken as (purchase − purchase return) and output as (sale − sale
 * return), matching Vyapar's presentation, and both halves are shown rather than only
 * the net.
 *
 * ── Income and expenses ─────────────────────────────────────────────────────
 * A Balance Sheet carries only one P&L number — Net Income — so that is the only
 * figure available to test against until a Trial Balance for 1-Apr→11-Sep exists.
 * Ledger-by-ledger comparison needs that export; this prints our own P&L in full so
 * the two can be read side by side, and says plainly that it is unverified rather
 * than implying otherwise.
 *
 *   pnpm vyapar:pl-check
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { Pool } from "pg";
import { readFileSync } from "node:fs";

const OPENINGS = "prisma/seeds/data/vyapar-opening-31mar2026.json";
const TOL = 1;
const inr = (n: number) => (n < 0 ? "-" : "") + "₹" + Math.abs(Math.round(n)).toLocaleString("en-IN");

type V = {
    gst: { window: Record<string, number>; netByTax: Record<string, number> };
    profit: { netIncome11Sep: number };
};

async function main(): Promise<void> {
    const url = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
    if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("REFUSING: local copy only, never live.");

    const V = JSON.parse(readFileSync(OPENINGS, "utf8")) as V;
    const pool = new Pool({ connectionString: url, ssl: false, max: 1 });
    let bad = 0;

    // ── GST ─────────────────────────────────────────────────────────────────
    // Read the movement off the GL lines rather than Account.balance, so the debit
    // and credit halves stay visible. A net that is right because two errors cancel
    // is the failure this is guarding against.
    const gl = await pool.query(`
        select a.name,
               coalesce(sum(case when v.type = 'PURCHASE'        then l.amount
                                 when v.type = 'PURCHASE_RETURN' then -l.amount else 0 end), 0) input,
               coalesce(sum(case when v.type = 'SALE'            then l.amount
                                 when v.type = 'SALE_RETURN'     then -l.amount else 0 end), 0) output,
               coalesce(sum(case when v.type not in ('PURCHASE','PURCHASE_RETURN','SALE','SALE_RETURN')
                                 then l.amount else 0 end), 0) other
        from "VoucherGlLine" l
        join "Account" a on a.id = l."accountId"
        join "UniversalVoucher" v on v.id = l."universalVoucherId"
        where a.name in ('CGST', 'SGST', 'IGST') group by a.name`);
    const ours = new Map(gl.rows.map((r) =>
        [String(r.name), { input: Number(r.input), output: Number(r.output), other: Number(r.other) }]));

    console.log(`\nGST for 1-Apr → 11-Sep-2026 — our ledgers open at nil, so this is the whole window\n`);
    console.log(`  ${"tax".padEnd(7)}${"our input".padStart(14)}${"vyapar".padStart(14)}` +
        `${"our output".padStart(14)}${"vyapar".padStart(14)}${"gap in / out".padStart(18)}`);
    // ₹5 across 3,539 vouchers is Vyapar rounding each invoice to paise; anything
    // larger is a modelling difference and must be explained, not absorbed.
    const GST_TOL = 10;
    for (const tax of ["CGST", "SGST", "IGST"]) {
        const o = ours.get(tax) ?? { input: 0, output: 0, other: 0 };
        const wIn = V.gst.window[`Input ${tax}`] ?? 0;
        const wOut = V.gst.window[`Output ${tax}`] ?? 0;
        const gIn = o.input - wIn, gOut = o.output - wOut;
        const off = Math.abs(gIn) > GST_TOL || Math.abs(gOut) > GST_TOL || Math.abs(o.other) > TOL;
        if (off) bad++;
        console.log(`  ${tax.padEnd(7)}${inr(o.input).padStart(14)}${inr(wIn).padStart(14)}` +
            `${inr(o.output).padStart(14)}${inr(wOut).padStart(14)}` +
            `${(inr(gIn) + " / " + inr(gOut)).padStart(18)}${off ? "  ⚠" : "  ✓"}`);
        if (Math.abs(o.other) > TOL)
            console.log(`         ⚠ ${inr(o.other)} of ${tax} posted by a voucher that is not a sale or purchase`);
    }

    // ── P&L ─────────────────────────────────────────────────────────────────
    const pl = await pool.query(`
        select g.name grp, g.type gt, a.name,
               coalesce(sum(case when l.type = 'CREDIT' then l.amount else -l.amount end), 0) net
        from "Account" a join "AccountGroup" g on g.id = a."groupId"
        left join "VoucherGlLine" l on l."accountId" = a.id
        where g.type in ('INCOME', 'EXPENSE')
        group by g.name, g.type, a.name having coalesce(sum(l.amount), 0) <> 0
        order by g.type, abs(coalesce(sum(case when l.type = 'CREDIT' then l.amount else -l.amount end), 0)) desc`);

    let income = 0, expense = 0;
    console.log(`\nINCOME`);
    for (const r of pl.rows.filter((r) => r.gt === "INCOME")) {
        income += Number(r.net);
        console.log(`  ${String(r.name).slice(0, 40).padEnd(42)}${inr(Number(r.net)).padStart(14)}   [${r.grp}]`);
    }
    console.log(`  ${"".padEnd(42)}${inr(income).padStart(14)}   total`);

    console.log(`\nEXPENSES`);
    for (const r of pl.rows.filter((r) => r.gt === "EXPENSE")) {
        expense += -Number(r.net);
        console.log(`  ${String(r.name).slice(0, 40).padEnd(42)}${inr(-Number(r.net)).padStart(14)}   [${r.grp}]`);
    }
    console.log(`  ${"".padEnd(42)}${inr(expense).padStart(14)}   total`);

    // Closing stock is a master column here, not a ledger, so gross profit has to
    // pick it up from inventory — see recompute-stock.ts. Opening is what the 31-Mar
    // load put in; closing is what the engine's costing produced.
    const stock = (await pool.query(`
        select coalesce(sum(coalesce("openingStock", 0) * coalesce("openingRate", 0)), 0) open
        from "InvProduct"`)).rows[0];

    console.log(`\n  income ${inr(income)} − expenses ${inr(expense)} = ${inr(income - expense)}`);
    console.log(`  opening stock ${inr(Number(stock.open))} at 31-Mar  (Vyapar: ₹8,58,904)`);
    console.log(`  ⓘ closing stock is NOT a ledger here — the inventory module values it live`);
    console.log(`    from 1,438 products, so profit is only complete on the Balance Sheet`);
    console.log(`    screen. Purchase A/c sits in the expenses above, so the figure on this`);
    console.log(`    line is not gross profit and should not be read as one.`);
    console.log(`\n  vyapar Net Income (Profit) for the same period: ${inr(V.profit.netIncome11Sep)}`);
    console.log(`  ⓘ not a verdict — a Balance Sheet carries one P&L number and no breakdown.`);
    console.log(`    Ledger-by-ledger needs a Vyapar TRIAL BALANCE for 01-04-2026 to 11-09-2026.`);

    console.log(`\n${bad === 0 ? "✓ GST agrees with Vyapar for the window" : `⚠ ${bad} GST line(s) disagree`}`);
    console.log(`  income and expenses above are UNVERIFIED until that trial balance exists\n`);

    await pool.end();
    if (bad) process.exit(1);
}

main().catch((e: Error) => { console.error(`\n${e.message}\n`); process.exit(1); });
