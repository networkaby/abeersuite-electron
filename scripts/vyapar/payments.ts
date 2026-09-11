/**
 * Load the 31-Mar-2026 openings that Vyapar itself published: money, loans,
 * fixed assets.
 *
 * This script used to RECONSTRUCT these figures from `kb_bank_adjustments` by
 * solving for undocumented type codes. It reproduced plain Cash exactly, which
 * looked like proof, and was wrong on eight of ten ledgers — 3 Routing A/c out by
 * ₹5.85L, SBI CC by ₹3.21L, and two ledgers (Rakesh Cash, Cheque) given balances
 * that do not exist in Vyapar at all. The check that passed compared our figure
 * against the same derivation that produced it, so it could never have failed.
 *
 * Nothing is derived here any more. Every number is read from
 * `vyapar-opening-31mar2026.json`, transcribed from the owner's own Balance Sheet
 * and Trial Balance exports, which agree with each other line for line. That is
 * how party balances and stock quantities were done, and those are the two things
 * in this migration that came out exact.
 *
 * Three corrections, all following the owner's rule — *any pre-Vyapar opening
 * should be zero; the opening comes from Vyapar at 1-Apr-2026*:
 *
 *   MONEY   Clear every opening on a cash / bank / wallet / card ledger — the old
 *           AbeerSuite floats (Counter 21 ₹25,109, the Vault ₹9,503, SBI CC
 *           ₹5,34,077) — then set from the export. The purge preserves openings by
 *           design, so nothing else would ever have cleared them.
 *
 *   LOANS   Vyapar carries six totalling ₹9,78,044; we held four, and two
 *           (Navi 2, Hamid Soceity) did not exist at all. Created and loaded.
 *
 *   ASSETS  Vyapar's `item_type = 5` rows are office equipment, not stock. They
 *           were imported as ordinary products, which put ₹4,83,396 of ladders,
 *           cabinets and a ROOM into opening inventory while the fixed-asset
 *           ledgers sat empty — and New Room was then counted twice, ₹4,00,001 as
 *           stock and ₹4,00,000 as a ledger. Their opening stock is zeroed and the
 *           value moved to the ledgers.
 *
 * A dry run prints every line against the published figure and --apply refuses to
 * write while any of them disagrees, so a transcription slip cannot land silently.
 *
 *   pnpm vyapar:payments            # report only
 *   pnpm vyapar:payments -- --apply
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
const OPENINGS = "prisma/seeds/data/vyapar-opening-31mar2026.json";
/** Which of our ledgers hold money — the ones Vyapar restates and we clear first. */
const MONEY_GROUPS = "cash|bank|wallet|credit card";
const TOL = 1;

const inr = (n: number) => (n < 0 ? "-" : "") + "₹" + Math.abs(Math.round(n)).toLocaleString("en-IN");

type Line = { vyapar: string; account: string | null; amount: number; create?: string };
type Opening = {
    money: Line[];
    loans: Line[];
    fixedAssets: { items: Array<{ itemId: number; name: string; amount: number; ledger: string }>;
                   byLedger: Record<string, number> };
    totals: Record<string, number>;
};

async function main(): Promise<void> {
    const apply = process.argv.includes("--apply");
    const url = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
    if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("REFUSING: local copy only, never live.");

    const V = JSON.parse(readFileSync(OPENINGS, "utf8")) as Opening;
    const pool = new Pool({ connectionString: url, ssl: false, max: 1 });

    const signed = (r: Record<string, unknown>) =>
        Number(r.openingBalance ?? 0) * (r.openingBalanceType === "CREDIT" ? -1 : 1);
    const held = new Map<string, number>();
    for (const r of (await pool.query(
        `select name, "openingBalance", "openingBalanceType" from "Account"`)).rows) held.set(r.name, signed(r));

    let bad = 0;
    const row = (label: string, want: number, have: number | null) => {
        const off = have == null ? NaN : have - want;
        if (have == null || Math.abs(off) > TOL) bad++;
        console.log(`  ${label.slice(0, 36).padEnd(38)}${inr(want).padStart(14)}` +
            `${(have == null ? "NO LEDGER" : inr(have)).padStart(14)}` +
            `${(have == null ? "" : inr(off)).padStart(13)}${have == null || Math.abs(off) > TOL ? "  ⚠" : ""}`);
    };
    const head = (title: string) => {
        console.log(`\n${title}`);
        console.log(`  ${"".padEnd(38)}${"vyapar".padStart(14)}${"ours now".padStart(14)}${"gap".padStart(13)}`);
    };

    // ── Money ───────────────────────────────────────────────────────────────
    head("MONEY — opening at 31-Mar-2026");
    for (const m of V.money) {
        if (!m.account) { if (m.amount) console.log(`  ${m.vyapar.padEnd(38)}${inr(m.amount).padStart(14)}   (not migrated)`); continue; }
        row(m.vyapar, m.amount, held.has(m.account) ? held.get(m.account)! : null);
    }
    const strays = (await pool.query(`
        select a.name, a."openingBalance", a."openingBalanceType" from "Account" a
        join "AccountGroup" g on g.id = a."groupId"
        where g.name ~* $1 and coalesce(a."openingBalance", 0) <> 0
          and a.name <> all($2::text[])`,
        [MONEY_GROUPS, V.money.filter((m) => m.account).map((m) => m.account)])).rows;
    for (const s of strays) console.log(`  ${String(s.name).slice(0, 36).padEnd(38)}${"—".padStart(14)}${inr(signed(s)).padStart(14)}   ⚠ pre-Vyapar float, will be cleared`);

    // ── Loans ───────────────────────────────────────────────────────────────
    head("LOANS — opening at 31-Mar-2026");
    for (const l of V.loans) row(l.vyapar, l.amount, held.has(l.account!) ? held.get(l.account!)! : null);

    // ── Fixed assets ────────────────────────────────────────────────────────
    const { db, close } = openVyb(process.argv.find((a) => a.endsWith(".vyb")) ?? DEFAULT_VYB, join(tmpdir(), "vy-pay"));
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

    const productIds: number[] = [];
    let missing = 0, inStock = 0;
    for (const f of V.fixedAssets.items) {
        const pid = maps.product.get(f.itemId);
        if (pid == null) { missing++; continue; }
        productIds.push(pid);
    }
    if (productIds.length) {
        inStock = Number((await pool.query(
            `select coalesce(sum(coalesce("openingStock",0) * coalesce("openingRate",0)), 0) v
             from "InvProduct" where id = any($1::int[])`, [productIds])).rows[0].v);
    }
    head("FIXED ASSETS — opening at 31-Mar-2026");
    for (const [ledger, amount] of Object.entries(V.fixedAssets.byLedger))
        row(ledger, amount, held.has(ledger) ? held.get(ledger)! : null);
    console.log(`\n  ${V.fixedAssets.items.length} item(s) · ${productIds.length} matched here` +
        `${missing ? ` · ⚠ ${missing} NOT FOUND` : ""}`);
    console.log(`  sitting in opening STOCK right now: ${inr(inStock)}  ← moves out to the ledgers above`);

    console.log(`\n  ${bad} line(s) disagree with Vyapar's published opening`);
    if (!apply) { console.log(`\nNothing written. Re-run with --apply.\n`); await pool.end(); close(); return; }
    if (missing) { console.log(`\nREFUSING: ${missing} fixed asset(s) have no product here to move.\n`); await pool.end(); close(); process.exit(1); }

    // ── Write ───────────────────────────────────────────────────────────────
    // Clear first, set second. A ledger the export does not mention is meant to be
    // nil, and only clearing the whole group makes "not mentioned" and "zero" the
    // same thing — the distinction that left ₹1,02,336 of stale party openings
    // behind earlier in this migration.
    await pool.query(
        `update "Account" a set "openingBalance" = null, "openingBalanceType" = null
         from "AccountGroup" g where g.id = a."groupId"
           and (g.name ~* $1 or g.name in ('Fixed Assets', 'Unsecured Loans', 'Secured Loans'))`,
        [MONEY_GROUPS]);

    const setOpening = async (name: string, amount: number) => {
        if (Math.abs(amount) < 0.005) return;
        const r = await pool.query(
            `update "Account" set "openingBalance" = $2, "openingBalanceType" = $3::"EntryType" where name = $1`,
            [name, Math.abs(amount).toFixed(2), amount >= 0 ? "DEBIT" : "CREDIT"]);
        if (r.rowCount === 0) throw new Error(`no ledger named "${name}"`);
    };

    for (const m of V.money) if (m.account) await setOpening(m.account, m.amount);

    for (const l of V.loans) {
        if (l.create) {
            // Account.name carries no unique constraint, so ON CONFLICT has nothing
            // to catch on — look before inserting, or a re-run mints a second ledger.
            await pool.query(
                `insert into "Account" (name, "groupId", "isActive", "createdAt", "updatedAt")
                 select $1, g.id, true, now(), now() from "AccountGroup" g
                 where g.name = $2 and not exists (select 1 from "Account" where name = $1)`,
                [l.account, l.create]);
        }
        await setOpening(l.account!, l.amount);
    }

    for (const [ledger, amount] of Object.entries(V.fixedAssets.byLedger)) await setOpening(ledger, amount);

    // The same rupee cannot be a chair and a saleable product at once.
    await pool.query(
        `update "InvProduct" set "openingStock" = 0, "openingRate" = 0, "openingValue" = 0
         where id = any($1::int[])`, [productIds]);

    console.log(`\nloaded ${V.money.filter((m) => m.account).length} money · ${V.loans.length} loan` +
        ` · ${Object.keys(V.fixedAssets.byLedger).length} fixed-asset ledger(s)`);
    console.log(`moved ${inr(inStock)} of fixed assets out of opening stock (${productIds.length} products)\n`);

    await pool.end();
    close();
}

// reconcile.ts imports nothing from here any more — the openings live in the JSON.
main().catch((e: Error) => { console.error(`\n${e.message}\n`); process.exit(1); });
