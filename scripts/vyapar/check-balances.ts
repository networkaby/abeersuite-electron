/**
 * Prove we understand Vyapar's accounting BEFORE replaying 23,551 vouchers.
 *
 * Vyapar stores a current balance per party (`kb_names.amount`) but keeps no
 * double-entry ledger. The migration has to DERIVE debits and credits from the
 * transactions. If that derivation is wrong, every opening balance is wrong and
 * so is every ledger built on top — and we would not find out until the books
 * were already loaded.
 *
 * So: recompute each party's balance from its transactions using the sign rules
 * the importer will use, and compare against Vyapar's own figure. Agreement
 * across 3,754 parties is strong evidence the rules are right. Disagreement is
 * a bug in our understanding, found for the price of one read-only script.
 *
 * Sign convention (same as AbeerSuite's): POSITIVE = receivable, the party owes
 * us. Negative = payable, we owe them.
 *
 *   pnpm vyapar:check-balances [-- <path-to.vyb>]
 */

import { openVyb } from "./openVyb";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_VYB = "D:/AbeerSuite/11-09-2026_05.55.41_Network_Service_VypBackup.vyb";

/**
 * How each Vyapar transaction type moves the party's balance.
 *
 * `cash` and `bal` are multipliers on `txn_cash_amount` / `txn_balance_amount`.
 * A sale adds only its UNPAID part to what the customer owes (the cash part was
 * settled at the counter), so bal=+1, cash=0. A receipt is pure settlement, so
 * cash=-1. Purchases mirror sales with the sign flipped.
 *
 * Types marked `null` do not touch a party ledger at all — estimates, orders and
 * challans are documents, not postings. Getting that wrong is precisely the
 * error that made `txn_current_balance` disagree with `kb_names.amount` on 67
 * parties, so it is encoded here deliberately.
 */
const EFFECT: Record<number, { cash: number; bal: number; label: string } | null> = {
    1: { cash: 0, bal: +1, label: "Sale" },
    2: { cash: 0, bal: -1, label: "Purchase" },
    3: { cash: -1, bal: -1, label: "Payment-In" },
    4: { cash: +1, bal: +1, label: "Payment-Out" },
    21: { cash: 0, bal: -1, label: "Credit Note" },
    23: { cash: 0, bal: +1, label: "Debit Note" },
    5: { cash: +1, bal: +1, label: "Opening receivable" },
    6: { cash: -1, bal: -1, label: "Opening payable" },
    // "Payment In/Out Opening Balance" — NOT postings, despite looking like them.
    // They record how much of an opening balance had ALREADY been settled, and
    // that same money also appears as real Payment-In/Out rows (types 3/4). Posting
    // both counts it twice. Proven on "Jahidul junmoni": opening payable −405,000,
    // type 32 +388,826 and five type-4 payments +388,826 — the identical 388,826
    // twice, producing a 372,652 error that vanished the moment these were muted.
    // Muting them cut the total derivation gap from ₹7.04L to ₹1.18L.
    31: null,
    32: null,
    7: { cash: 0, bal: -1, label: "Expense" },
    29: { cash: 0, bal: +1, label: "Other income" },
    60: { cash: 0, bal: +1, label: "Sale of fixed asset" },
    61: { cash: 0, bal: -1, label: "Purchase of fixed asset" },
    27: null, // Estimate — a quotation, no posting
    30: null, // Delivery Challan — goods moved, not yet invoiced
    65: null, // unidentified (32 rows) — no effect improved the fit, so left out

    // Types 81 (2 rows) and 82 (10 rows) are still UNNAMED — we have not confirmed
    // what Vyapar calls them. But their EFFECT is evidence-backed: 81 behaves like a
    // receipt and 82 like a payment, which fits the parties involved (81's are
    // customers, 82's are suppliers). Adopting these signs took the derivation gap
    // from ₹1,17,862 to ₹82,023 and fixed MAHALAXMI INFOTRONICS to the rupee.
    // They are posted with these signs but still listed for identification — a
    // correct sign is not the same as a known meaning.
    81: { cash: -1, bal: -1, label: "unnamed, behaves as a receipt" },
    82: { cash: +1, bal: +1, label: "unnamed, behaves as a payment" },
};

function main(): void {
    const vyb = process.argv[2] ?? DEFAULT_VYB;
    const { db, close } = openVyb(vyb, join(tmpdir(), "vyapar-check"));

    const derived = new Map<number, number>();
    const unknownTypes = new Map<number, number>();

    for (const r of db.prepare(`
        select txn_name_id nid, txn_type ty,
               coalesce(txn_cash_amount, 0) cash, coalesce(txn_balance_amount, 0) bal
        from kb_transactions where txn_name_id is not null
    `).all() as Array<Record<string, unknown>>) {
        const ty = Number(r.ty);
        if (!(ty in EFFECT)) { unknownTypes.set(ty, (unknownTypes.get(ty) ?? 0) + 1); continue; }
        const e = EFFECT[ty];
        if (!e) continue;
        const nid = Number(r.nid);
        derived.set(nid, (derived.get(nid) ?? 0) + e.cash * Number(r.cash) + e.bal * Number(r.bal));
    }

    // Vyapar's OTHER opinion of the balance: the running total it stamps on each
    // voucher. It disagrees with `kb_names.amount` on a handful of parties, so when
    // our derivation differs from `amount` it matters a great deal whether it
    // matches this instead — that tells us who is wrong, us or the stale cache.
    const running = new Map<number, number>();
    for (const r of db.prepare(`
        select nid, bal from (
            select txn_name_id nid, txn_current_balance bal,
                   row_number() over (partition by txn_name_id order by txn_date desc, txn_id desc) rn
            from kb_transactions where txn_name_id is not null
        ) where rn = 1
    `).all() as Array<Record<string, unknown>>) {
        running.set(Number(r.nid), Number(r.bal));
    }

    const parties = db.prepare(`
        select name_id, full_name, coalesce(amount, 0) amount from kb_names where name_type = 1
    `).all() as Array<Record<string, unknown>>;

    let agree = 0;
    let matchesRunning = 0;
    const gaps: Array<{ name: string; theirs: number; ours: number; gap: number; run: number }> = [];
    for (const p of parties) {
        const theirs = Number(p.amount);
        const ours = round2(derived.get(Number(p.name_id)) ?? 0);
        const gap = round2(ours - theirs);
        const run = round2(running.get(Number(p.name_id)) ?? 0);
        if (Math.abs(gap) < 0.01) agree++;
        else {
            // `txn_current_balance` is unsigned, so compare magnitudes.
            if (Math.abs(Math.abs(ours) - Math.abs(run)) < 0.01) matchesRunning++;
            gaps.push({ name: String(p.full_name), theirs, ours, gap, run });
        }
    }

    const pct = ((agree / parties.length) * 100).toFixed(1);
    console.log(`\nDerived balance vs Vyapar's own figure, ${parties.length} parties`);
    console.log(`  agree exactly : ${agree}  (${pct}%)`);
    console.log(`  disagree      : ${gaps.length}   total gap ${inr(gaps.reduce((s, g) => s + Math.abs(g.gap), 0))}`);

    if (unknownTypes.size) {
        console.log(`\n  UNMAPPED transaction types (not in EFFECT — add them before replay):`);
        for (const [ty, n] of [...unknownTypes].sort((a, b) => b[1] - a[1])) console.log(`    type ${ty}: ${n} rows`);
    }

    if (gaps.length) {
        console.log(`  of which our figure matches Vyapar's own running balance: ${matchesRunning}` +
            `  — there Vyapar contradicts itself and \`amount\` is the stale side`);
        console.log(`\n  ${"party".padEnd(36)}${"amount".padStart(13)}${"running".padStart(13)}${"ours".padStart(13)}${"gap".padStart(12)}`);
        for (const g of [...gaps].sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)).slice(0, 12)) {
            const flag = Math.abs(Math.abs(g.ours) - Math.abs(g.run)) < 0.01 ? "  ✓ running agrees with us" : "";
            console.log(`    ${g.name.slice(0, 32).padEnd(34)}${inr(g.theirs).padStart(13)}${inr(g.run).padStart(13)}${inr(g.ours).padStart(13)}${inr(g.gap).padStart(12)}${flag}`);
        }
    }

    const totTheirs = parties.reduce((s, p) => s + Number(p.amount), 0);
    const totOurs = [...derived.values()].reduce((s, v) => s + v, 0);
    console.log(`\n  Net across all parties — vyapar ${inr(totTheirs)} · ours ${inr(totOurs)} · gap ${inr(totOurs - totTheirs)}\n`);

    close();
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const inr = (n: number) => (n < 0 ? "-" : "") + "₹" + Math.abs(Math.round(n)).toLocaleString("en-IN");

main();
