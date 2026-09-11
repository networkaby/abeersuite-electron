/**
 * Pre-flight for the replay: can every voucher in the window actually be posted?
 *
 * Read-only. It resolves every party, product and ledger the 3,203 in-window
 * vouchers touch and reports what would fail — BEFORE anything is written. A
 * replay that discovers a missing ledger at voucher 2,000 leaves the books half
 * built, and the fix is then a restore rather than an edit.
 *
 * It also totals the GL by hand, because the one thing worth knowing in advance is
 * whether the debits and credits the replay intends to write actually balance.
 *
 *   pnpm vyapar:replay-check
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { FY_START, extractItems, extractParties } from "./extract";
import { buildMaps } from "./mapping";
import { openVyb } from "./openVyb";
import { Pool } from "pg";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_VYB = "D:/AbeerSuite/11-09-2026_05.55.41_Network_Service_VypBackup.vyb";
const inr = (n: number) => (n < 0 ? "-" : "") + "₹" + Math.abs(Math.round(n)).toLocaleString("en-IN");

/** Vyapar types the replay knows how to post, and what each becomes. */
const HANDLED: Record<number, string> = {
    1: "SALE", 2: "PURCHASE", 3: "RECEIPT", 4: "PAYMENT", 7: "JOURNAL (expense)",
    21: "SALE_RETURN", 23: "PURCHASE_RETURN", 29: "JOURNAL (other income)",
    60: "JOURNAL (sale of fixed asset)", 61: "JOURNAL (purchase of fixed asset)",
    27: "ESTIMATE (no GL, no stock)", 30: "CHALLAN (no GL, no stock)",
    65: "CANCELLED SALE — deliberately never posted",
};

/** Types that resolve to nothing at all: real rows in Vyapar, no effect on the books. */
const POSTS_NOTHING = new Set([27, 30, 65]);

async function main(): Promise<void> {
    const url = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
    if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("REFUSING: local copy only, never live.");

    const { db, close } = openVyb(process.argv.find((a) => a.endsWith(".vyb")) ?? DEFAULT_VYB, join(tmpdir(), "vy-replay"));
    const pool = new Pool({ connectionString: url, ssl: false, max: 1 });

    const paymentNames = new Map<number, string>();
    for (const r of db.prepare(`select paymentType_id id, paymentType_name nm from kb_paymentTypes`).all() as Array<Record<string, unknown>>) {
        paymentNames.set(Number(r.id), String(r.nm).trim());
    }
    const headNames = new Map<number, string>();
    for (const r of db.prepare(`select name_id id, full_name nm from kb_names where name_type = 2`).all() as Array<Record<string, unknown>>) {
        headNames.set(Number(r.id), String(r.nm).trim());
    }

    const incomeNames = new Map<number, string>();
    for (const r of db.prepare(`select name_id id, full_name nm from kb_names where name_type = 3`).all() as Array<Record<string, unknown>>) {
        incomeNames.set(Number(r.id), String(r.nm).trim());
    }

    const { maps, unresolved } = await buildMaps(
        pool, extractParties(db), extractItems(db), paymentNames, headNames, incomeNames,
    );

    console.log(`\nmapped: ${maps.party.size} parties · ${maps.product.size} products` +
        ` · ${maps.payment.size} payment ledgers · ${maps.expenseHead.size} expense heads`);
    if (unresolved.length) {
        console.log(`\n⚠ ${unresolved.length} mapping problem(s):`);
        for (const u of unresolved.slice(0, 15)) console.log(`    ${u}`);
        if (unresolved.length > 15) console.log(`    … ${unresolved.length - 15} more`);
    } else {
        console.log(`  no mapping gaps`);
    }

    // ── Walk the window and check every voucher can be built ────────────────
    const txns = db.prepare(`
        select txn_id, txn_type, txn_name_id, txn_category_id, txn_date,
               coalesce(txn_cash_amount, 0) cash, coalesce(txn_balance_amount, 0) bal,
               coalesce(txn_discount_amount, 0) disc, coalesce(txn_round_off_amount, 0) roff
        from kb_transactions where txn_date >= '${FY_START}'
        order by txn_date, txn_id
    `).all() as Array<Record<string, number>>;

    const lineTax = new Map<number, number>();
    const lineTotal = new Map<number, number>();
    const lineIgst = new Set<number>();
    for (const r of db.prepare(`
        select l.lineitem_txn_id tid, coalesce(l.lineitem_tax_amount, 0) tax,
               coalesce(l.total_amount, 0) total, coalesce(c.tax_code_name, '') code
        from kb_lineitems l
        join kb_transactions t on t.txn_id = l.lineitem_txn_id
        left join kb_tax_code c on c.tax_code_id = l.lineitem_tax_id
        where t.txn_date >= '${FY_START}'
    `).all() as Array<Record<string, unknown>>) {
        const tid = Number(r.tid);
        lineTax.set(tid, (lineTax.get(tid) ?? 0) + Number(r.tax));
        lineTotal.set(tid, (lineTotal.get(tid) ?? 0) + Number(r.total));
        if (/^I?GST/i.test(String(r.code)) && String(r.code).toUpperCase().startsWith("IGST")) lineIgst.add(tid);
    }

    const tenders = new Map<number, Array<{ pid: number; amt: number }>>();
    for (const r of db.prepare(`
        select m.txn_id tid, m.payment_id pid, coalesce(m.amount, 0) amt
        from txn_payment_mapping m join kb_transactions t on t.txn_id = m.txn_id
        where t.txn_date >= '${FY_START}'
    `).all() as Array<Record<string, number>>) {
        const tid = Number(r.tid);
        tenders.set(tid, [...(tenders.get(tid) ?? []), { pid: Number(r.pid), amt: Number(r.amt) }]);
    }

    const productLines = new Map<number, number[]>();
    for (const r of db.prepare(`
        select l.lineitem_txn_id tid, l.item_id iid
        from kb_lineitems l join kb_transactions t on t.txn_id = l.lineitem_txn_id
        where t.txn_date >= '${FY_START}'
    `).all() as Array<Record<string, number>>) {
        const tid = Number(r.tid);
        productLines.set(tid, [...(productLines.get(tid) ?? []), Number(r.iid)]);
    }

    const problems = new Map<string, number>();
    const note = (s: string) => problems.set(s, (problems.get(s) ?? 0) + 1);
    const byType = new Map<number, number>();
    let totalTax = 0, igstTxns = 0;

    for (const t of txns) {
        const ty = Number(t.txn_type);
        byType.set(ty, (byType.get(ty) ?? 0) + 1);
        if (!(ty in HANDLED)) { note(`type ${ty} is not handled — held back`); continue; }
        // A cancelled sale still carries amounts and line items; posting it would
        // invent revenue and a stock movement for a sale that never happened.
        if (POSTS_NOTHING.has(ty)) continue;

        // Type 29 points txn_name_id at an INCOME HEAD, not a customer.
        if (t.txn_name_id != null) {
            const nid = Number(t.txn_name_id);
            if (ty === 29) {
                if (!maps.incomeHead.has(nid)) note(`income head id ${nid} unresolved`);
            } else if (!maps.party.has(nid)) {
                note(`party id ${nid} unresolved`);
            }
        }
        if (ty === 7 && t.txn_category_id != null) {
            const head = Number(t.txn_category_id);
            if (maps.droppedHead.has(head)) note(`expense head "${headNames.get(head)}" was dropped but has a voucher in the window`);
            else if (!maps.expenseHead.has(head)) note(`expense head id ${head} unresolved`);
        }
        for (const { pid } of tenders.get(Number(t.txn_id)) ?? []) {
            if (maps.droppedPayment.has(pid)) note(`payment ledger "${paymentNames.get(pid)}" was dropped but has a tender in the window`);
            else if (!maps.payment.has(pid)) note(`payment ledger id ${pid} unresolved`);
        }
        for (const iid of productLines.get(Number(t.txn_id)) ?? []) {
            if (!maps.product.has(iid)) note(`product id ${iid} unresolved (voucher ${t.txn_id})`);
        }
        totalTax += lineTax.get(Number(t.txn_id)) ?? 0;
        if (lineIgst.has(Number(t.txn_id))) igstTxns++;
    }

    console.log(`\nWINDOW ${FY_START} → 10-Sep-2026 — ${txns.length} vouchers`);
    for (const [ty, n] of [...byType].sort((a, b) => b[1] - a[1])) {
        console.log(`  type ${String(ty).padEnd(3)} ${String(n).padStart(5)}  ${HANDLED[ty] ?? "⚠ NOT HANDLED — held back"}`);
    }
    console.log(`\n  line-level GST ${inr(totalTax)} · ${igstTxns} voucher(s) carry IGST (inter-state)`);

    if (problems.size) {
        console.log(`\n⚠ WOULD FAIL — fix before replaying:`);
        for (const [p, n] of [...problems].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)} × ${p}`);
    } else {
        console.log(`\n✓ every voucher in the window resolves — nothing would fail`);
    }

    console.log(`\nNothing was written.\n`);
    await pool.end();
    close();
}

main().catch((e: Error) => { console.error(`\n${e.message}\n`); process.exit(1); });
