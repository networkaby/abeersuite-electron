/**
 * Cash, bank, wallet and card ledgers: zero what was here before, take the
 * 1-Apr-2026 opening from Vyapar.
 *
 * This ran last because nothing was checking it. `reconcile.ts` proved parties and
 * stock against Vyapar's own published figures and reported 100% — but no cash or
 * bank ledger was ever given a 31-Mar-2026 opening, so each one held only the
 * movement since 1-Apr and the whole difference sat quietly in the Trial Balance's
 * "Difference in opening balances". Petty Cash read ₹22.5L against Vyapar's
 * ₹12,479; Counter 23 read −₹81,945. The books balanced the entire time.
 *
 * Two separate corrections, both required by the owner's rule — *any pre-Vyapar
 * opening should be zero; the opening comes from Vyapar at 1-Apr-2026*:
 *
 *   1. CLEAR every opening on a cash / bank / wallet / card ledger. These are
 *      AbeerSuite's own older floats (Counter 21 ₹25,109, the Vault ₹9,503, SBI CC
 *      ₹5,34,077) and they would otherwise sit UNDER the Vyapar figure rather than
 *      be replaced by it. The purge deliberately preserves openings, so nothing
 *      else would ever have removed them.
 *   2. SET the opening from Vyapar, rolled back the same way party balances were:
 *      opening(31-Mar) = closing(10-Sep) − movement in the window. Replaying the
 *      window forward must then land back on Vyapar's closing, which is the check.
 *
 * ── Where a Vyapar balance actually comes from ──────────────────────────────
 * Not from one column. `paymentType_opening_balance` is the 2023 opening, and the
 * movement is in TWO places:
 *
 *   • `txn_payment_mapping` — money in and out against invoices, receipts,
 *     payments, expenses and returns (the tender legs).
 *   • `kb_bank_adjustments` (2,266 rows) — the transfers that never touch a party:
 *     cash banked, bank-to-bank moves, card payments, FD withdrawals. Reading only
 *     the first leaves Cash overstated by ₹1.43 CRORE, because 1,931 deposits out
 *     of the till are recorded nowhere else.
 *
 * The adjustment codes are not documented; these were fixed by solving for the
 * signs that reproduce Vyapar's own published balances, and are held to that:
 *
 *     14  cash banked          Cash → bank_id             (1,931 rows, ₹1.43cr)
 *     25  transfer             bank_id → to_bank_id       (320 rows)
 *     15  reduce balance       bank_id −                  (6 rows)
 *     17  add to balance       bank_id +                  (4 rows, FD withdraw)
 *     18  card payment         bank_id +                  (5 rows)
 *
 * A dry run reproduces every balance and prints it against what Vyapar shows, and
 * --apply refuses to write while any ledger misses it — so a wrong sign is caught
 * before the figures land rather than after.
 *
 *   pnpm vyapar:payments            # report only
 *   pnpm vyapar:payments -- --apply
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { openVyb } from "./openVyb";
import { FY_START } from "./extract";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_VYB = "D:/AbeerSuite/11-09-2026_05.55.41_Network_Service_VypBackup.vyb";
/** The books begin 1-Apr-2026, so the opening is stated as at the day before. */
const OPENING_DATE = "2026-03-31";
/** Which of our ledgers count as money — the ones Vyapar restates. */
const MONEY_GROUPS = "cash|bank|wallet|credit card";

/** Effect on the MONEY ledger of one tender leg, by Vyapar transaction type. */
const TENDER_SIGN: Record<number, number> = {
    1: +1,  // Sale — money in
    2: -1,  // Purchase
    3: +1,  // Payment-In
    4: -1,  // Payment-Out
    7: -1,  // Expense
    21: -1, // Credit Note (sale return) — money back out
    23: +1, // Debit Note (purchase return)
    29: +1, // Other Income
    60: +1, // Sale of fixed asset
    61: -1, // Purchase of fixed asset
    81: -1, 82: +1,
    5: 0, 6: 0, 31: 0, 32: 0,   // opening-balance markers, not postings
    27: 0, 30: 0, 65: 0,        // estimate / challan / cancelled sale
};

const CASH_ID = 1; // kb_paymentTypes.paymentType_id for plain "Cash"
const inr = (n: number) => (n < 0 ? "-" : "") + "₹" + Math.abs(Math.round(n)).toLocaleString("en-IN");

export type Money = { name: string; closing: number; opening: number };

/** Vyapar's closing (10-Sep) and rolled-back opening (31-Mar) for every payment ledger. */
export function vyaparMoney(db: ReturnType<typeof openVyb>["db"]): Map<number, Money> {
    const out = new Map<number, Money>();
    const all = new Map<number, number>();   // movement since the 2023 opening
    const win = new Map<number, number>();   // movement inside the replay window
    const add = (id: number, v: number, inWindow: boolean) => {
        all.set(id, (all.get(id) ?? 0) + v);
        if (inWindow) win.set(id, (win.get(id) ?? 0) + v);
    };

    for (const r of db.prepare(`
        select m.payment_id pid, t.txn_type ty, t.txn_date dt, m.amount amt
        from txn_payment_mapping m join kb_transactions t on t.txn_id = m.txn_id
    `).all() as Array<Record<string, unknown>>) {
        const sign = TENDER_SIGN[Number(r.ty)];
        if (!sign) continue;
        add(Number(r.pid), Number(r.amt) * sign, String(r.dt).slice(0, 10) >= FY_START);
    }

    for (const r of db.prepare(`
        select bank_adj_type ty, bank_adj_bank_id b, bank_adj_to_bank_id tb,
               bank_adj_amount a, bank_adj_date dt from kb_bank_adjustments
    `).all() as Array<Record<string, unknown>>) {
        const ty = Number(r.ty), b = Number(r.b), amt = Number(r.a);
        const w = String(r.dt).slice(0, 10) >= FY_START;
        if (ty === 14) { add(CASH_ID, -amt, w); add(b, +amt, w); }           // banked out of the till
        else if (ty === 25) { add(b, -amt, w); add(Number(r.tb), +amt, w); } // ledger to ledger
        else if (ty === 15) add(b, -amt, w);
        else if (ty === 17) add(b, +amt, w);
        else if (ty === 18) add(b, +amt, w);
    }

    for (const r of db.prepare(`
        select paymentType_id id, paymentType_name nm, paymentType_opening_balance ob from kb_paymentTypes
    `).all() as Array<Record<string, unknown>>) {
        const id = Number(r.id);
        const closing = (Number(r.ob) || 0) + (all.get(id) ?? 0);
        out.set(id, { name: String(r.nm).trim(), closing, opening: closing - (win.get(id) ?? 0) });
    }
    return out;
}

async function main(): Promise<void> {
    const apply = process.argv.includes("--apply");
    const url = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
    if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("REFUSING: local copy only, never live.");

    const { db, close } = openVyb(process.argv.find((a) => a.endsWith(".vyb")) ?? DEFAULT_VYB, join(tmpdir(), "vy-pay"));
    const pool = new Pool({ connectionString: url, ssl: false, max: 1 });

    const money = vyaparMoney(db);
    const map = JSON.parse(readFileSync("prisma/seeds/data/vyapar-ledger-map.json", "utf8")) as
        { mappings: Array<{ vyapar: string; kind: string; action: string; account: string | null }> };
    const target = new Map(map.mappings.filter((m) => m.kind === "payment" && m.action === "map")
        .map((m) => [m.vyapar, m.account!]));

    // ── 1. What is here now, and what Vyapar says it should be ──────────────
    const held = (await pool.query(`
        select a.id, a.name, g.name grp,
               coalesce(a."openingBalance", 0) * (case when a."openingBalanceType" = 'CREDIT' then -1 else 1 end) ob,
               coalesce(a.balance, 0) * (case when g.type in ('LIABILITY','INCOME') then -1 else 1 end) bal
        from "Account" a join "AccountGroup" g on g.id = a."groupId"
        where g.name ~* $1 order by g.name, a.name`, [MONEY_GROUPS])).rows;

    const wanted = new Map<string, Money>();
    for (const [, m] of money) { const acc = target.get(m.name); if (acc) wanted.set(acc, m); }

    console.log(`\nMONEY LEDGERS — opening as at ${OPENING_DATE}, from Vyapar\n`);
    console.log(`  ${"ledger".padEnd(38)}${"opening now".padStart(13)}${"→ vyapar".padStart(13)}` +
        `${"closing".padStart(13)}${"vyapar says".padStart(13)}`);
    let cleared = 0, clearedAmt = 0, bad = 0;
    for (const a of held) {
        const w = wanted.get(a.name);
        const obNow = Number(a.ob), balNow = Number(a.bal);
        if (Math.abs(obNow) > 0.005) { cleared++; clearedAmt += Math.abs(obNow); }
        const closing = (w ? w.opening : 0) + balNow;
        const off = w ? closing - w.closing : 0;
        if (w && Math.abs(off) > 1) bad++;
        console.log(`  ${a.name.slice(0, 36).padEnd(38)}${inr(obNow).padStart(13)}` +
            `${(w ? inr(w.opening) : "—").padStart(13)}${inr(closing).padStart(13)}` +
            `${(w ? inr(w.closing) : "—").padStart(13)}${w && Math.abs(off) > 1 ? "  ⚠ " + inr(off) : ""}`);
    }
    console.log(`\n  clearing ${cleared} pre-Vyapar opening(s) worth ${inr(clearedAmt)} · setting ${wanted.size} from Vyapar`);
    if (bad) console.log(`  ⚠ ${bad} ledger(s) would NOT land on Vyapar's closing — see above`);

    const unmapped = [...money.values()].filter((m) => !target.has(m.name) && Math.abs(m.closing) > 1);
    if (unmapped.length) {
        console.log(`\n  not migrated (dropped in the ledger map) but still carrying a balance in Vyapar:`);
        for (const m of unmapped.sort((a, b) => Math.abs(b.closing) - Math.abs(a.closing)))
            console.log(`    ${m.name.padEnd(36)}${inr(m.closing).padStart(13)}`);
    }

    if (!apply) { console.log(`\nNothing written. Re-run with --apply.\n`); await pool.end(); close(); return; }
    if (bad) { console.log(`\nREFUSING to write while a ledger misses Vyapar's closing.\n`); await pool.end(); close(); process.exit(1); }

    // ── 2. Write: clear the lot, then set only what Vyapar restates ─────────
    await pool.query(
        `update "Account" a set "openingBalance" = null, "openingBalanceType" = null
         from "AccountGroup" g where g.id = a."groupId" and g.name ~* $1`, [MONEY_GROUPS]);
    for (const [name, m] of wanted) {
        if (Math.abs(m.opening) < 0.005) continue;
        await pool.query(
            `update "Account" set "openingBalance" = $2, "openingBalanceType" = $3::"EntryType"
             where name = $1`,
            [name, Math.abs(m.opening).toFixed(2), m.opening >= 0 ? "DEBIT" : "CREDIT"]);
    }
    console.log(`\ncleared ${cleared} old opening(s); wrote ${wanted.size} from Vyapar as at ${OPENING_DATE}\n`);

    await pool.end();
    close();
}

// reconcile.ts imports `vyaparMoney` from here so the check and the write agree on
// one definition of a Vyapar balance. Only run the script when it IS the script.
if (/payments\.ts$/.test(process.argv[1] ?? "")) {
    main().catch((e: Error) => { console.error(`\n${e.message}\n`); process.exit(1); });
}
