/**
 * Read-only survey of a Vyapar `.vyb` — what is in it, and what the migration
 * intends to do with each row. Writes nothing, touches no database.
 *
 * Run it before every migration run, and after any new backup arrives: it is the
 * cheapest way to catch a corrupt file, a surprise item type, or a party that
 * would be silently dropped.
 *
 *   pnpm vyapar:survey                       # uses the default backup below
 *   pnpm vyapar:survey -- <path-to.vyb>
 */

import { extractExpenseHeads, extractItems, extractParties, extractPaymentLedgers } from "./extract";
import { describeVyb, openVyb } from "./openVyb";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_VYB = "D:/AbeerSuite/11-09-2026_05.55.41_Network_Service_VypBackup.vyb";

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const pad = (s: string | number, w: number) => String(s).padEnd(w);
const rpad = (s: string | number, w: number) => String(s).padStart(w);

function main(): void {
    const vyb = process.argv[2] ?? DEFAULT_VYB;
    const { db, close } = openVyb(vyb, join(tmpdir(), "vyapar-survey"));

    console.log(`\n${vyb.split(/[\\/]/).pop()}`);
    console.log(`  ${describeVyb(db)}\n`);

    // ── Products ────────────────────────────────────────────────────────────
    const items = extractItems(db);
    const byDisp = new Map<string, { n: number; qty: number; val: number }>();
    for (const i of items) {
        const g = byDisp.get(i.disposition) ?? { n: 0, qty: 0, val: 0 };
        g.n++; g.qty += i.qty; g.val += i.stockValue;
        byDisp.set(i.disposition, g);
    }
    console.log("PRODUCTS");
    for (const [d, g] of [...byDisp].sort((a, b) => b[1].n - a[1].n)) {
        console.log(`  ${pad(d, 14)} ${rpad(g.n, 5)} items   qty ${rpad(Math.round(g.qty), 7)}   ${rpad(inr(g.val), 14)}`);
    }

    const kinds = new Map<string, number>();
    for (const i of items) if (i.code) kinds.set(i.codeKind!, (kinds.get(i.codeKind!) ?? 0) + 1);
    console.log(`  barcode kinds: ${[...kinds].map(([k, n]) => `${k} ${n}`).join(" · ")}` +
        `  ·  ${items.filter((i) => i.codeIsOurSkuShape).length} match our 6-digit SKU shape` +
        `  ·  ${items.filter((i) => !i.code).length} have none`);

    const assets = items.filter((i) => i.disposition === "fixed-asset" && i.stockValue !== 0);
    if (assets.length) {
        console.log(`\n  NEEDS A DECISION — ${assets.length} fixed assets, ${inr(assets.reduce((s, i) => s + i.stockValue, 0))}`);
        for (const i of [...assets].sort((a, b) => b.stockValue - a.stockValue).slice(0, 10)) {
            console.log(`    ${pad(i.name.slice(0, 44), 46)} ${rpad(i.qty, 4)}  ${rpad(inr(i.stockValue), 12)}`);
        }
    }

    const negative = items.filter((i) => i.disposition === "migrate" && i.qty < 0);
    if (negative.length) {
        console.log(`\n  NEGATIVE STOCK — ${negative.length} items, ${Math.round(negative.reduce((s, i) => s + i.qty, 0))} units.` +
            ` Migrated as-is; correct at the physical count.`);
        for (const i of [...negative].sort((a, b) => a.qty - b.qty).slice(0, 5)) {
            console.log(`    ${pad(i.name.slice(0, 44), 46)} ${rpad(i.qty, 4)}`);
        }
    }

    // ── Parties ─────────────────────────────────────────────────────────────
    const parties = extractParties(db);
    const inc = parties.filter((p) => p.include);
    const byReason = new Map<string, number>();
    for (const p of parties) {
        const key = p.include ? p.reason.replace(/\d+/g, "N") : "DROPPED — " + p.reason;
        byReason.set(key, (byReason.get(key) ?? 0) + 1);
    }
    console.log(`\nPARTIES  ${inc.length} of ${parties.length} imported`);
    for (const [r, n] of [...byReason].sort((a, b) => b[1] - a[1])) console.log(`  ${rpad(n, 5)}  ${r}`);
    console.log(`  ${inc.filter((p) => p.kind === "company").length} companies · ${inc.filter((p) => p.kind === "person").length} persons` +
        `  ·  ${inc.filter((p) => !p.phone).length} need a placeholder contact`);

    const recv = inc.filter((p) => p.balance > 0).reduce((s, p) => s + p.balance, 0);
    const pay = inc.filter((p) => p.balance < 0).reduce((s, p) => s + p.balance, 0);
    console.log(`  receivable ${inr(recv)} · payable ${inr(Math.abs(pay))}`);

    const dropped = parties.filter((p) => !p.include);
    if (dropped.length) console.log(`  dropped ${dropped.length}: ${dropped.slice(0, 4).map((p) => p.name).join(", ")}${dropped.length > 4 ? " …" : ""}`);

    // ── Ledgers that must be matched or quarantined ─────────────────────────
    const heads = extractExpenseHeads(db);
    console.log(`\nEXPENSE HEADS  ${heads.length}  ·  ${inr(heads.reduce((s, h) => s + h.total, 0))}`);
    for (const h of heads.slice(0, 8)) console.log(`  ${pad(h.name.slice(0, 40), 42)} ${rpad(h.used, 5)}  ${rpad(inr(h.total), 12)}`);

    const pays = extractPaymentLedgers(db).filter((p) => p.used > 0);
    console.log(`\nPAYMENT LEDGERS  ${pays.length} used  ·  ${inr(pays.reduce((s, p) => s + p.total, 0))}`);
    for (const p of pays.slice(0, 8)) console.log(`  ${pad(p.name.slice(0, 40), 42)} ${rpad(p.used, 6)}  ${rpad(inr(p.total), 14)}`);

    console.log("\nNothing was written. Masters land only when the resolver runs against the local DB.\n");
    close();
}

main();
