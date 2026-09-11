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
    interestLedgers: { create: Array<{ account: string; group: string }> };
    chequeClearing: { account: string };
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
    const allItems = extractItems(db);
    const { maps } = await buildMaps(
        pool, extractParties(db), allItems,
        named(`select paymentType_id id, paymentType_name nm from kb_paymentTypes`),
        named(`select name_id id, full_name nm from kb_names where name_type = 2`),
        named(`select name_id id, full_name nm from kb_names where name_type = 3`),
    );

    // Every item_type 5 row, not just the 20 the 31-Mar sheet lists. The Havells fan
    // (item 1947) was bought INSIDE the window, so it is absent from the 31-Mar fixed
    // assets and gets no opening — but it is still office equipment, and it still has
    // to leave inventory. It did not, because STOCK_EFFECT in extract.ts rolls back
    // only sales and purchases (types 1/2/21/23); type 61, purchase of a fixed asset,
    // is not in it, so the fan's in-window purchase never came out of the opening
    // quantity. Result: ₹2,699 sitting in opening stock AND in Office Equipment — the
    // New Room double-count again, two orders of magnitude smaller.
    const productIds: number[] = [];
    let missing = 0, inStock = 0;
    const listed = new Set(V.fixedAssets.items.map((f) => f.itemId));
    for (const f of V.fixedAssets.items) {
        const pid = maps.product.get(f.itemId);
        if (pid == null) { missing++; continue; }
        productIds.push(pid);
    }
    const extraAssets: number[] = [];
    for (const i of allItems) {
        if (i.itemType !== 5 || listed.has(i.itemId)) continue;
        const pid = maps.product.get(i.itemId);
        if (pid != null) extraAssets.push(pid);
    }

    // Services carry a quantity in Vyapar — negative, by design, since they are
    // "sold" without ever being bought — but are excluded from its Stock-in-hand
    // VALUE. So only the RATE is zeroed here, never the quantity: zeroing both put
    // five service items out by 365 units against Vyapar's own figures, trading a
    // ₹299 valuation difference for a quantity mismatch. Value and quantity are
    // separate questions and have to be answered separately.
    const services: number[] = [];
    for (const i of allItems) {
        if (i.itemType !== 2 && i.itemType !== 3) continue;
        const pid = maps.product.get(i.itemId);
        if (pid != null) services.push(pid);
    }

    // Vyapar is authoritative on stock, so a product it has never heard of cannot
    // hold an opening quantity — that is AbeerSuite's own pre-migration data, and the
    // owner's rule sends it to zero like every other pre-Vyapar opening.
    const knownProducts = new Set(maps.product.values());
    const orphans = (await pool.query(`
        select id, name, coalesce("openingStock", 0) * coalesce("openingRate", 0) v from "InvProduct"
        where coalesce("openingStock", 0) * coalesce("openingRate", 0) <> 0`)).rows
        .filter((r) => !knownProducts.has(Number(r.id)));
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
    if (extraAssets.length) console.log(`  + ${extraAssets.length} fixed asset(s) bought inside the window — stock zeroed, no opening`);
    if (services.length) console.log(`  + ${services.length} service item(s) — value zeroed, quantity kept (Vyapar excludes services from stock VALUE only)`);
    for (const o of orphans)
        console.log(`  ⚠ ${String(o.name).slice(0, 44).padEnd(46)}${inr(Number(o.v)).padStart(12)}  not in Vyapar — opening stock cleared`);

    console.log(`\n  ${bad} line(s) disagree with Vyapar's published opening`);
    if (!apply) { console.log(`\nNothing written. Re-run with --apply.\n`); await pool.end(); close(); return; }
    if (missing) { console.log(`\nREFUSING: ${missing} fixed asset(s) have no product here to move.\n`); await pool.end(); close(); process.exit(1); }

    // ── Write ───────────────────────────────────────────────────────────────
    // Clear first, set second. A ledger the export does not mention is meant to be
    // nil, and only clearing the whole group makes "not mentioned" and "zero" the
    // same thing — the distinction that left ₹1,02,336 of stale party openings
    // behind earlier in this migration.
    //
    // Clearing by GROUP alone is not enough: "Cheques in Hand" lives under Current
    // Assets, so a ₹2,10,790 pre-Vyapar opening survived the group sweep and then
    // showed up as money Vyapar says does not exist. Every ledger this file NAMES is
    // cleared too, whatever group it happens to sit in.
    const namedHere = [
        ...V.money.map((m) => m.account), ...V.loans.map((l) => l.account),
        ...Object.keys(V.fixedAssets.byLedger), V.chequeClearing.account,
    ].filter((n): n is string => !!n);
    await pool.query(
        `update "Account" a set "openingBalance" = null, "openingBalanceType" = null
         from "AccountGroup" g where g.id = a."groupId"
           and (g.name ~* $1 or g.name in ('Fixed Assets', 'Unsecured Loans', 'Secured Loans')
                or a.name = any($2::text[]))`,
        [MONEY_GROUPS, namedHere]);

    const setOpening = async (name: string, amount: number) => {
        if (Math.abs(amount) < 0.005) return;
        const r = await pool.query(
            `update "Account" set "openingBalance" = $2, "openingBalanceType" = $3::"EntryType" where name = $1`,
            [name, Math.abs(amount).toFixed(2), amount >= 0 ? "DEBIT" : "CREDIT"]);
        if (r.rowCount === 0) throw new Error(`no ledger named "${name}"`);
    };

    // Loan interest needs somewhere to land before the replay posts it.
    for (const c of V.interestLedgers.create) {
        await pool.query(
            `insert into "Account" (name, "groupId", "isActive", "createdAt", "updatedAt")
             select $1, g.id, true, now(), now() from "AccountGroup" g
             where g.name = $2 and not exists (select 1 from "Account" where name = $1)`,
            [c.account, c.group]);
    }

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
         where id = any($1::int[])`,
        [[...productIds, ...extraAssets, ...orphans.map((o) => Number(o.id))]]);

    // Services: drop the value, keep the quantity.
    await pool.query(
        `update "InvProduct" set "openingRate" = 0, "openingValue" = 0 where id = any($1::int[])`,
        [services]);

    console.log(`\nloaded ${V.money.filter((m) => m.account).length} money · ${V.loans.length} loan` +
        ` · ${Object.keys(V.fixedAssets.byLedger).length} fixed-asset ledger(s)`);
    console.log(`moved ${inr(inStock)} of fixed assets out of opening stock (${productIds.length} products)\n`);

    await pool.end();
    close();
}

// reconcile.ts imports nothing from here any more — the openings live in the JSON.
main().catch((e: Error) => { console.error(`\n${e.message}\n`); process.exit(1); });
