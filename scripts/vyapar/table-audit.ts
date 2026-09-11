/**
 * Account for every table in the Vyapar file. Nothing is allowed to be unexamined.
 *
 * Three whole modules went missing from this migration and not one was caught by a
 * check: bank contras (₹22,51,824 of till cash that never left Petty Cash), the loan
 * module (₹1,71,661 of movement and ₹49,884 of interest), and cheque clearing
 * (₹31,100 stranded). They surfaced because the owner opened a POS screen and sent
 * two Balance Sheet exports nobody had asked for.
 *
 * The common cause is that every other check tests something we already knew existed.
 * `reconcile.ts` proves parties, stock, money and loans — all of them things someone
 * thought to look for. It cannot report on a table nobody opened.
 *
 * So this file inverts it. It enumerates every table in the `.vyb`, and each one must
 * be claimed by name in `CLASSIFIED` below, with a reason. Anything not claimed lands
 * in NEVER CONSIDERED and the script exits 1. Adding a table to the list is a
 * deliberate act that forces the question "does this move money or stock?" — which is
 * the question that was never asked about `loan_transactions`.
 *
 * A "skipped" reason that depends on a date (the journal entries all predate the
 * window, say) is re-checked on every run by CUTOFFS, not taken on trust — because
 * that claim stops being true the moment someone supplies a newer backup.
 *
 *   pnpm vyapar:table-audit
 */

import { openVyb } from "./openVyb";
import { FY_START } from "./extract";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_VYB = "D:/AbeerSuite/11-09-2026_05.55.41_Network_Service_VypBackup.vyb";

type Verdict = "migrated" | "skipped";
const CLASSIFIED: Record<string, [Verdict, string]> = {
    // ── Migrated ────────────────────────────────────────────────────────────
    kb_transactions:      ["migrated", "the vouchers — 3,203 in the window"],
    kb_lineitems:         ["migrated", "voucher inventory lines and line-level GST"],
    txn_payment_mapping:  ["migrated", "tender legs; supports split tenders"],
    kb_names:             ["migrated", "parties (type 1), expense heads (2), income heads (3)"],
    kb_address:           ["migrated", "party addresses, through customerImport"],
    kb_items:             ["migrated", "products — figures only, our masters win"],
    kb_item_units:        ["migrated", "mapped onto our units: Unit→UNIT, METERS→MTR, Ream→REAM"],
    kb_paymentTypes:      ["migrated", "cash / bank / wallet / card ledgers"],
    kb_bank_adjustments:  ["migrated", "contra transfers — cash banked, bank to bank"],
    loan_accounts:        ["migrated", "six loans, opening read from the 31-Mar export"],
    loan_transactions:    ["migrated", "instalments and drawdowns, with their interest"],
    kb_cheque_status:     ["migrated", "cheques banked out of Cheques in Hand"],
    loyalty_txn:          ["migrated", "9,978 rows replayed FIFO, original earn dates kept"],

    // ── Skipped: the owner's masters win (descriptive, and ours are newer) ──
    kb_item_categories:          ["skipped", "Vyapar's 7 'categories' are tax buckets; our masters win"],
    kb_item_categories_mapping:  ["skipped", "ditto — no Vyapar category is imported"],
    kb_party_item_rate:          ["skipped", "party price lists — descriptive, ours win"],
    kb_party_groups:             ["skipped", "party grouping — ours win"],
    kb_prefix:                   ["skipped", "invoice numbering — AbeerSuite has its own"],
    kb_settings:                 ["skipped", "426 Vyapar settings rows — ours are unrelated"],
    kb_firms:                    ["skipped", "Jupiter Enterprise is a print name on the same books"],
    kb_bank_accounts:            ["skipped", "bank detail for printing, not a balance"],
    kb_tax_code:                 ["skipped", "our own GST rate setup"],
    kb_tax_mapping:              ["skipped", "ditto"],
    tds_tax_rates:               ["skipped", "TDS rates — not used in this business"],
    kb_payment_terms:            ["skipped", "credit terms — ours win"],
    terms_and_conditions:        ["skipped", "print text — our print templates own this"],
    tnc_txn_type_mapping:        ["skipped", "ditto"],
    kb_txn_message_config:       ["skipped", "SMS/WhatsApp templates"],
    kb_custom_fields:            ["skipped", "Vyapar custom fields"],
    kb_udf_fields:               ["skipped", "ditto"],
    kb_extra_charges:            ["skipped", "charge DEFINITIONS (Shipping/Packaging); the amounts ride on the txn and ARE migrated"],
    kb_item_units_mapping:       ["skipped", "unit conversion pairs — our units are authoritative"],

    // ── Skipped: Vyapar's own bookkeeping, not ours ────────────────────────
    urp_users:                 ["skipped", "17 Vyapar users — AbeerSuite has its own RBAC"],
    urp_activity:              ["skipped", "60,131 rows of Vyapar UI activity log"],
    urp_item_category_access:  ["skipped", "Vyapar per-user category permissions"],
    audit_trails:              ["skipped", "22,139 rows of Vyapar's own edit history"],
    recycle_bin:               ["skipped", "833 deleted Vyapar rows — deliberately not resurrected"],
    kb_fts_vtable:             ["skipped", "full-text search index, internal to Vyapar"],
    kb_fts_vtable_content:     ["skipped", "ditto"],
    kb_fts_vtable_segments:    ["skipped", "ditto"],
    kb_fts_vtable_segdir:      ["skipped", "ditto"],
    kb_images:                 ["skipped", "images"],
    kb_item_images:            ["skipped", "product images"],
    transaction_attachments:   ["skipped", "1 attachment"],
    kb_log:                    ["skipped", "Vyapar internal log"],

    // ── Skipped: real accounting data, but ALREADY inside the 31-Mar opening ─
    // These are the dangerous ones. Each claim is re-tested by CUTOFFS below, so a
    // newer backup that pushes any of them into the window fails the audit instead
    // of quietly passing.
    journal_entry:            ["skipped", "17 manual journals, ALL before the window (last 2026-03-30)"],
    journal_entry_line_items: ["skipped", "their lines — inside the opening"],
    kb_item_adjustments:      ["skipped", "532 stock adjustments, ALL before the window (last 2025-08-25)"],
    kb_closed_link_txn_table: ["skipped", "settled bill-wise links, all pre-window"],

    // ── Skipped: the owner decided ─────────────────────────────────────────
    kb_txn_links:          ["skipped", "bill-wise allocations — owner declined: 'balances are right, that's enough'"],
    kb_linked_transactions: ["skipped", "estimate→invoice links; both are documents that post nothing"],
    other_accounts:        ["skipped", "Vyapar's tax ledgers. GST opens at NIL by the owner's decision — Vyapar never clears these on filing, so its ₹21.97L Output is cumulative since 2023, not a liability"],
    chart_of_accounts_mapping: ["skipped", "ties the above to Vyapar's own COA — not ours"],
    stores:                ["skipped", "3 stores (NetworkServiceStore, NewRoom, Abeer_Home) merged into one branch — one set of books, as decided for the two firms"],
    item_def_assembly:     ["skipped", "manufacturing assembly — not used"],
    kb_adjustment_ist_mapping: ["skipped", "assembly/adjustment links — follows the above"],
    kb_item_stock_tracking: ["skipped", "batch/serial tracking — not used; totals are what reconcile"],
    kb_serial_details:     ["skipped", "serial numbers — empty"],
    kb_serial_mapping:     ["skipped", "ditto"],
    party_item_service_reminder: ["skipped", "1,666 service reminders — a CRM feature, moves no money"],
    party_notes:           ["skipped", "party notes"],
    party_to_party_transfer: ["skipped", "party-to-party transfers"],
    kb_cash_adjustments:   ["skipped", "empty — cash corrections live in kb_bank_adjustments"],
    kb_payment_gateway:    ["skipped", "payment gateway config"],
    pg_txn_uti_mapping:    ["skipped", "gateway reference mapping"],
    attachments:           ["skipped", "attachments"],
    task_attachments:      ["skipped", "task attachments"],
    tasks:                 ["skipped", "Vyapar tasks"],
    leads:                 ["skipped", "Vyapar CRM leads"],
    currencies:            ["skipped", "multi-currency — single currency here"],
    currency_exchange_rate: ["skipped", "ditto"],
    kb_tcs_tax_rates:      ["skipped", "TCS rates"],
    kb_udf_values:         ["skipped", "custom field values"],
    transaction_attributes: ["skipped", "transaction attributes"],
    repeat_invoice_template: ["skipped", "recurring invoice templates"],
    store_transactions:    ["skipped", "per-store transactions"],
    store_line_items:      ["skipped", "ditto"],
    item_adj_attachment_mappings: ["skipped", "adjustment attachments"],
    item_adj_image_mappings: ["skipped", "adjustment images"],
    item_def_assembly_additional_costs: ["skipped", "assembly costing"],
    item_mfg_assembly_additional_costs: ["skipped", "ditto"],
};

/**
 * Claims of the form "everything in this table predates the window" have to keep
 * being true. Each entry re-runs the count; a single row on or after FY_START fails
 * the audit and names the table, because that row would be real money nobody replays.
 */
const CUTOFFS: Array<[string, string]> = [
    ["journal_entry", "date"],
    ["kb_item_adjustments", "item_adj_date"],
    ["kb_closed_link_txn_table", "closed_link_txn_date"],
];

function main(): void {
    const { db, close } = openVyb(process.argv.find((a) => a.endsWith(".vyb")) ?? DEFAULT_VYB, join(tmpdir(), "vy-audit"));

    const tables = (db.prepare(
        `select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`,
    ).all() as Array<{ name: string }>).map((t) => t.name);

    const rows = new Map<string, number>();
    for (const t of tables) rows.set(t, Number((db.prepare(`select count(*) c from "${t}"`).get() as { c: number }).c));

    const unclaimed: string[] = [];
    const migrated: string[] = [];
    const skippedWithRows: string[] = [];
    let empty = 0;

    for (const t of tables) {
        const n = rows.get(t)!;
        const c = CLASSIFIED[t];
        if (!c) { if (n > 0) unclaimed.push(t); else empty++; continue; }
        if (n === 0) { empty++; continue; }
        (c[0] === "migrated" ? migrated : skippedWithRows).push(t);
    }

    const fmt = (n: number) => n.toLocaleString("en-IN");
    console.log(`\nVYAPAR TABLE AUDIT — ${tables.length} tables, ${tables.filter((t) => rows.get(t)! > 0).length} holding rows\n`);

    console.log(`MIGRATED (${migrated.length})`);
    for (const t of migrated.sort((a, b) => rows.get(b)! - rows.get(a)!))
        console.log(`  ${fmt(rows.get(t)!).padStart(8)}  ${t.padEnd(26)}${CLASSIFIED[t][1]}`);

    console.log(`\nDELIBERATELY SKIPPED (${skippedWithRows.length})`);
    for (const t of skippedWithRows.sort((a, b) => rows.get(b)! - rows.get(a)!))
        console.log(`  ${fmt(rows.get(t)!).padStart(8)}  ${t.padEnd(26)}${CLASSIFIED[t][1]}`);

    console.log(`\nEMPTY (${empty}) — nothing to decide`);

    // ── Re-test the date-based claims ───────────────────────────────────────
    console.log(`\nDATE CLAIMS — "all of this predates ${FY_START}"`);
    let stale = 0;
    for (const [table, col] of CUTOFFS) {
        const n = Number((db.prepare(
            `select count(*) c from "${table}" where date("${col}") >= ?`).get(FY_START) as { c: number }).c);
        const last = (db.prepare(`select max("${col}") m from "${table}"`).get() as { m: string | null }).m;
        if (n > 0) stale++;
        console.log(`  ${table.padEnd(28)}${n === 0 ? "✓ none in window" : `⚠ ${n} ROW(S) IN THE WINDOW`}` +
            `   (last ${String(last ?? "—").slice(0, 10)})`);
    }

    console.log(`\nNEVER CONSIDERED (${unclaimed.length})`);
    if (unclaimed.length === 0) {
        console.log(`  none — every table holding rows is accounted for by name`);
    } else {
        for (const t of unclaimed.sort((a, b) => rows.get(b)! - rows.get(a)!))
            console.log(`  ${fmt(rows.get(t)!).padStart(8)}  ${t}   ← decide, then add it to CLASSIFIED`);
    }

    const ok = unclaimed.length === 0 && stale === 0;
    console.log(`\n${ok ? "✓ every table accounted for" : "⚠ see above — do not push to live"}\n`);
    close();
    if (!ok) process.exit(1);
}

main();
