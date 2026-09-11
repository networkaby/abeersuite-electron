/**
 * Build the 1-Apr-2026 opening from Vyapar, in an empty database.
 *
 * This is the clean-room route, and it exists because the previous one kept losing
 * to the same bug. Patching Vyapar's figures onto a restored copy of AbeerSuite
 * meant every pre-migration opening had to be found and cleared BY NAME — and one
 * by one they were not: Counter 21's ₹25,109, the Vault's ₹9,503, Cheques in Hand's
 * ₹2,10,790, Free Carry Bag's ₹10,000, Capital's ₹98,419, Suspense's ₹1,825. Each
 * was caught by a different check on a different day, which is not a method.
 *
 * Starting empty makes residue structurally impossible: every figure in the database
 * was put there by this file, from a number Vyapar published.
 *
 * ── Nothing is dropped ──────────────────────────────────────────────────────
 * The old route skipped rows it could not use — items with no barcode, parties with
 * no phone, dead stock. Here EVERY item and EVERY party is carried, because the
 * owner will be checking the mapping and cannot check what is not there. Anything
 * defective is repaired with a placeholder and renamed with a `FIX:` prefix and a
 * reason tag, so one search finds them all:
 *
 *     FIX:NOCODE     item has no barcode of its own — an SKU was minted
 *     FIX:NEGQTY     Vyapar holds a negative quantity (sold before purchase)
 *     FIX:DEAD       no stock, no value, no transactions — probably retired
 *     FIX:NOCONTACT  party has neither phone nor email — placeholder address
 *     FIX:BADPHONE   phone is not 10 digits (a typo, not a format)
 *     FIX:DUPPHONE   phone already claimed by a different party
 *
 * The prefix is temporary and cosmetic. It changes no figure, and clearing it later
 * is a rename.
 *
 * ── Where each number comes from ────────────────────────────────────────────
 * Ledgers, loans and fixed assets are READ from `vyapar-opening-31mar2026.json`,
 * transcribed from the owner's own 31-Mar Balance Sheet and Trial Balance. Party
 * openings likewise — all 72 that carry one, and their two totals reproduce
 * Vyapar's ₹26,678 and ₹2,54,303.20 exactly, which is what makes the transcription
 * self-checking.
 *
 * Opening STOCK quantity is the one figure still derived: today's quantity minus
 * everything that moved this year. The owner is exporting a 31-Mar stock summary to
 * replace it; until then the rate carries a known ₹14,396 basis difference, and the
 * report says so rather than implying the number is read.
 *
 *   pnpm vyapar:opening              # report only
 *   pnpm vyapar:opening -- --apply
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import {
    FY_START, PARTY_EFFECT, STOCK_EFFECT,
    extractItems, extractParties, normalisePhone, sharedPhoneIds,
    type VyaparItem, type VyaparParty,
} from "./extract";
import { openVyb } from "./openVyb";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_VYB = "D:/AbeerSuite/11-09-2026_05.55.41_Network_Service_VypBackup.vyb";
const OPENINGS = "prisma/seeds/data/vyapar-opening-31mar2026.json";
const PARTY_OPENINGS = "prisma/seeds/data/vyapar-party-opening-31mar2026.json";
const inr = (n: number) => (n < 0 ? "-" : "") + "₹" + Math.abs(Math.round(n)).toLocaleString("en-IN");

type Row = { rowIndex: number; values: Record<string, string> };
type Fix = { what: "item" | "party"; id: number; name: string; tag: string; detail: string };

/** Six digits, the shape generateSku() produces. Kept disjoint from barcodes. */
function mintSku(takenSku: Set<string>, takenCode: Set<string>): string {
    for (let n = 100000; n <= 999999; n++) {
        const s = String(n);
        if (!takenSku.has(s) && !takenCode.has(s)) return s;
    }
    throw new Error("no free 6-digit SKU left");
}

async function main(): Promise<void> {
    const apply = process.argv.includes("--apply");
    const url = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
    if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("REFUSING: local copy only, never live.");

    const V = JSON.parse(readFileSync(OPENINGS, "utf8")) as {
        money: Array<{ vyapar: string; account: string | null; amount: number; create?: string }>;
        loans: Array<{ vyapar: string; account: string; amount: number; create?: string }>;
        fixedAssets: { items: Array<{ itemId: number; name: string; amount: number; ledger: string }>;
                       byLedger: Record<string, number> };
        interestLedgers: { create: Array<{ account: string; group: string }> };
        totals: Record<string, number>;
    };
    // The JSON carries `$comment` entries inside the arrays for the reader's benefit.
    // They have no `amount`, and summing them produced NaN — which the total check
    // caught and refused to write on, doing exactly what it is for.
    V.money = V.money.filter((m) => typeof m.amount === "number");
    V.loans = V.loans.filter((l) => typeof l.amount === "number");

    const P = JSON.parse(readFileSync(PARTY_OPENINGS, "utf8")) as {
        debtors: Record<string, number>; creditors: Record<string, number>;
    };

    const { db, close } = openVyb(process.argv.find((a) => a.endsWith(".vyb")) ?? DEFAULT_VYB, join(tmpdir(), "vy-open"));
    const pool = new Pool({ connectionString: url, ssl: false, max: 1 });

    // Refuse to build on top of anything — this route's whole value is the empty start.
    const held = (await pool.query(
        `select (select count(*)::int from "InvProduct") p, (select count(*)::int from "Person") n,
                (select count(*)::int from "UniversalVoucher") v, (select count(*)::int from "AccountGroup") g`)).rows[0];
    if (Number(held.g) === 0) throw new Error("no AccountGroup rows — run the base seed first (prisma/seeds/personal-bootstrap.ts)");
    if (apply && (Number(held.p) > 0 || Number(held.n) > 0 || Number(held.v) > 0)) {
        throw new Error(`REFUSING: database already holds ${held.p} product(s), ${held.n} person(s), ${held.v} voucher(s).` +
            `\nThis builds an opening from empty. Drop and recreate the database, or use a fresh one.`);
    }

    const items = extractItems(db);
    const parties = extractParties(db);
    const fixes: Fix[] = [];

    // ── What moved inside the window, so the opening can be stated before it ──
    const stockMoved = new Map<number, number>();
    for (const r of db.prepare(`
        select l.item_id id, t.txn_type ty, sum(l.quantity) q
        from kb_lineitems l join kb_transactions t on t.txn_id = l.lineitem_txn_id
        where date(t.txn_date) >= ? group by 1, 2`).all(FY_START) as Array<Record<string, unknown>>) {
        const eff = STOCK_EFFECT[Number(r.ty)];
        if (!eff) continue;
        stockMoved.set(Number(r.id), (stockMoved.get(Number(r.id)) ?? 0) + Number(r.q) * eff);
    }
    // "Dead" has to mean never traded at all. Keyed on movement in THIS year it
    // flagged 626 of 1,445 products — ordinary slow stock in a shop this size, not
    // dead rows, and a tag on 43% of the catalogue tells the owner nothing.
    const everTraded = new Set<number>();
    for (const r of db.prepare(`select distinct item_id id from kb_lineitems`).all() as Array<Record<string, unknown>>)
        everTraded.add(Number(r.id));

    // ── Products ────────────────────────────────────────────────────────────
    // Fixed assets (item_type 5) are NOT products — they are ledgers, below.
    const fixedAssetIds = new Set(items.filter((i) => i.itemType === 5).map((i) => i.itemId));
    const takenSku = new Set<string>(), takenCode = new Set<string>();
    const productRows: Row[] = [];
    const skuByItem = new Map<number, string>();
    let openStockQty = 0, openStockValue = 0;

    for (const i of items) {
        if (fixedAssetIds.has(i.itemId)) continue;
        const code = (i.code ?? "").trim().toUpperCase();
        const tags: string[] = [];

        let sku: string, barcode: string | undefined;
        if (code && i.codeIsOurSkuShape && !takenSku.has(code) && !takenCode.has(code)) {
            sku = code;
        } else {
            sku = mintSku(takenSku, takenCode);
            if (code && !takenCode.has(code)) barcode = i.code!;
            if (!code) tags.push("NOCODE");
        }
        takenSku.add(sku);
        if (barcode) takenCode.add(barcode.toUpperCase());
        skuByItem.set(i.itemId, sku);

        const qty = i.qty - (stockMoved.get(i.itemId) ?? 0);
        // Services are "sold" without being bought, so Vyapar carries them at a
        // negative quantity and leaves them out of Stock-in-hand VALUE. Quantity is
        // kept (it is real) and the rate is nil, so the two sides stay comparable.
        const isService = i.itemType === 2 || i.itemType === 3;
        const rate = isService ? 0 : (i.qty !== 0 ? Math.abs(i.stockValue / i.qty) : (i.purchasePrice ?? 0));

        if (qty < 0) tags.push("NEGQTY");
        if (i.qty === 0 && i.stockValue === 0 && !everTraded.has(i.itemId)) tags.push("DEAD");

        const name = tags.length ? `FIX:${tags.join("+")} ${i.name}` : i.name;
        if (tags.length) fixes.push({
            what: "item", id: i.itemId, name: i.name, tag: tags.join("+"),
            detail: tags.includes("NOCODE") ? `sku ${sku} minted` : `qty ${qty}`,
        });

        openStockQty += qty;
        openStockValue += qty * rate;
        productRows.push({
            rowIndex: productRows.length,
            values: {
                name, sku, unit: i.unitCode,
                ...(barcode ? { barcode1: barcode } : {}),
                ...(i.hsn ? { hsnCode: i.hsn } : {}),
                ...(i.salePrice ? { salePrice: String(i.salePrice) } : {}),
                ...(i.mrp ? { mrp: String(i.mrp) } : {}),
                openingStock: String(qty),
                openingRate: rate ? rate.toFixed(2) : "0",
            },
        });
    }

    // ── Parties ─────────────────────────────────────────────────────────────
    // Every Vyapar name, whether or not it carries a balance — the owner is checking
    // the mapping, and a party that was dropped cannot be checked.
    const opening = new Map<string, number>();
    for (const [n, v] of Object.entries(P.debtors)) opening.set(n.trim().toLowerCase(), v);
    for (const [n, v] of Object.entries(P.creditors)) opening.set(n.trim().toLowerCase(), -v);

    // Every name in the opening file must find a party. One that does not would have
    // its balance silently dropped, and the totals would still look plausible.
    const unclaimed = new Set(opening.keys());
    const shared = sharedPhoneIds(parties);
    const claimedPhone = new Set<string>();
    const partyRows: Row[] = [];
    let matchedOpenings = 0, dr = 0, cr = 0;

    for (const p of parties) {
        const tags: string[] = [];
        let phone = p.phone;
        if (phone && shared.has(p.nameId)) { phone = null; tags.push("DUPPHONE"); }
        else if (!p.phone && p.rawPhone) tags.push("BADPHONE");
        if (phone && claimedPhone.has(phone)) { phone = null; tags.push("DUPPHONE"); }
        if (phone) claimedPhone.add(phone);

        // Deterministic, traceable, undeliverable (.invalid is reserved, RFC 2606).
        // A random key would mint a new address every run and duplicate the party.
        const placeholder = `vyapar-${p.nameId}@placeholder.invalid`;
        const contact = phone ? { phone1: phone }
            : p.email ? { email1: p.email }
                : (tags.push("NOCONTACT"), { email1: placeholder });

        const key = p.name.trim().toLowerCase();
        const bal = opening.get(key) ?? 0;
        if (opening.has(key)) { matchedOpenings++; unclaimed.delete(key); }
        if (bal > 0) dr += bal; else if (bal < 0) cr += -bal;

        const name = tags.length ? `FIX:${tags.join("+")} ${p.name}` : p.name;
        if (tags.length) fixes.push({
            what: "party", id: p.nameId, name: p.name, tag: tags.join("+"),
            detail: tags.includes("BADPHONE") ? `vyapar holds "${p.rawPhone}"` : placeholder,
        });

        partyRows.push({
            rowIndex: partyRows.length,
            values: {
                name, kind: p.kind,
                accountGroup: bal < 0 ? "creditor" : "debtor",
                ...contact,
                ...(p.address ? { address: p.address } : {}),
                ...(p.gstin ? { gstin: p.gstin } : {}),
                ...(p.creditLimit ? { creditLimit: String(p.creditLimit) } : {}),
                ...(bal > 0 ? { receivableBalance: bal.toFixed(2) }
                    : bal < 0 ? { payableBalance: Math.abs(bal).toFixed(2) } : {}),
            },
        });
    }

    // ── Report ──────────────────────────────────────────────────────────────
    const t = V.totals;
    const line = (label: string, ours: number, theirs: number, unit = inr) => {
        const gap = ours - theirs;
        const ok = Math.abs(gap) <= 1;
        console.log(`  ${label.padEnd(30)}${unit(ours).padStart(15)}${unit(theirs).padStart(15)}` +
            `${unit(gap).padStart(13)}   ${ok ? "✓" : "⚠"}`);
        return ok;
    };

    console.log(`\nOPENING AT 1-APR-2026 — built from empty, every figure from Vyapar\n`);
    console.log(`  ${"".padEnd(30)}${"ours".padStart(15)}${"vyapar".padStart(15)}${"gap".padStart(13)}`);
    let ok = true;
    ok = line("party openings (Dr)", dr, t.sundryDebtors) && ok;
    ok = line("party openings (Cr)", -cr, t.sundryCreditors) && ok;
    ok = line("loans", V.loans.reduce((s, l) => s + l.amount, 0), t.loanAccounts) && ok;
    ok = line("fixed assets", Object.values(V.fixedAssets.byLedger).reduce((s, v) => s + v, 0), t.fixedAssets) && ok;
    ok = line("money ledgers", V.money.reduce((s, m) => s + m.amount, 0),
        V.money.reduce((s, m) => s + m.amount, 0)) && ok;
    line("opening stock value", openStockValue, t.stockInHand);
    console.log(`  ${"".padEnd(30)}${"".padStart(15)}${"".padStart(15)}${"".padStart(13)}` +
        `   ⓘ stock value is the one DERIVED figure — awaiting the 31-Mar stock summary`);

    console.log(`\n  ${productRows.length} products · ${partyRows.length} parties` +
        ` · ${V.fixedAssets.items.length} fixed assets · ${V.money.length} money · ${V.loans.length} loans`);
    console.log(`  ${matchedOpenings} of ${opening.size} named party openings matched a Vyapar party`);
    if (unclaimed.size) {
        ok = false;
        console.log(`  ⚠ ${unclaimed.size} opening(s) found NO party and would be lost:`);
        for (const u of unclaimed) console.log(`      ${u}`);
    }
    console.log(`  opening stock ${openStockQty.toFixed(0)} units`);

    const byTag = new Map<string, number>();
    for (const f of fixes) byTag.set(f.tag, (byTag.get(f.tag) ?? 0) + 1);
    console.log(`\n  ${fixes.length} record(s) carry a FIX: prefix — search "FIX:" to find them all`);
    for (const [tag, n] of [...byTag].sort((a, b) => b[1] - a[1]))
        console.log(`    ${String(n).padStart(5)}  FIX:${tag}`);

    if (!apply) { console.log(`\nNothing written. Re-run with --apply.\n`); await pool.end(); close(); return; }
    if (!ok) { console.log(`\nREFUSING: a total above does not match Vyapar.\n`); await pool.end(); close(); process.exit(1); }

    // ── Write ───────────────────────────────────────────────────────────────
    // Clear every opening first, even in a database this file believes is empty.
    // It is not: `personal.local.json` carries openingBalance on the ledgers it
    // restores, so the base seed quietly re-seeded Counter 21's ₹25,109, the Vault's
    // ₹9,503, Capital's ₹98,419 and Suspense's ₹1,825 — the exact figures this whole
    // route exists to remove, arriving through a different door. A snapshot is meant
    // to hold CONFIGURATION; an opening balance is a POSITION.
    //
    // So the invariant is asserted rather than assumed: after this, every opening in
    // the database was written below, from a number Vyapar published.
    const wiped = await pool.query(
        `update "Account" set "openingBalance" = null, "openingBalanceType" = null
         where coalesce("openingBalance", 0) <> 0`);
    if (wiped.rowCount) console.log(`  cleared ${wiped.rowCount} opening(s) the base seed had restored`);

    const { runProductImport } = await import("@/shared/lib/import/productImport");
    const { runCustomerImport } = await import("@/shared/lib/import/customerImport");

    const say = (label: string, res: { results: Array<{ action: string; errors?: string[] }> }) => {
        const by = new Map<string, number>();
        for (const r of res.results) by.set(r.action, (by.get(r.action) ?? 0) + 1);
        console.log(`  ${label}: ${[...by].map(([k, v]) => `${k} ${v}`).join(" · ")}`);
        for (const e of res.results.filter((r) => r.action === "error").slice(0, 10))
            console.log(`      ${(e.errors ?? []).join("; ")}`);
    };

    console.log(`\nAPPLYING …`);
    say("products", await runProductImport({ rows: productRows as never, mode: "skip", dryRun: false, autoCreateMasters: true }));
    say("parties", await runCustomerImport({ rows: partyRows as never, mode: "skip", dryRun: false }));

    // Ledger openings: money, loans, fixed assets. GST opens at NIL by the owner's
    // decision — Vyapar's figures are cumulative since 2023 and were long since paid.
    for (const c of V.interestLedgers.create)
        await pool.query(
            `insert into "Account" (name, "groupId", "isActive", "createdAt", "updatedAt")
             select $1, g.id, true, now(), now() from "AccountGroup" g
             where g.name = $2 and not exists (select 1 from "Account" where name = $1)`, [c.account, c.group]);
    for (const l of [...V.money, ...V.loans])
        if (l.create && l.account)
            await pool.query(
                `insert into "Account" (name, "groupId", "isActive", "createdAt", "updatedAt")
                 select $1, g.id, true, now(), now() from "AccountGroup" g
                 where g.name = $2 and not exists (select 1 from "Account" where name = $1)`, [l.account, l.create]);

    const set = async (name: string, amount: number) => {
        if (Math.abs(amount) < 0.005) return;
        const r = await pool.query(
            `update "Account" set "openingBalance" = $2, "openingBalanceType" = $3::"EntryType" where name = $1`,
            [name, Math.abs(amount).toFixed(2), amount >= 0 ? "DEBIT" : "CREDIT"]);
        if (r.rowCount === 0) console.log(`  ⚠ no ledger named "${name}" — opening ${inr(amount)} NOT set`);
    };
    // A zero opening still needs its ledger — the transactions land on it next.
    for (const m of V.money) if (m.account) await set(m.account, m.amount);
    for (const l of V.loans) await set(l.account, l.amount);
    for (const [ledger, amount] of Object.entries(V.fixedAssets.byLedger)) await set(ledger, amount);

    console.log(`\ndone — opening is in place at 1-Apr-2026\n`);
    await pool.end();
    close();
}

main().catch((e: Error) => { console.error(`\n${e.message}\n`); process.exit(1); });
