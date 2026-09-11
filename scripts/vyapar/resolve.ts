/**
 * The resolver — decide what happens to every Vyapar item and party, and hand the
 * result to the existing importers.
 *
 * This is the only genuinely new logic in the migration. `runProductImport()`
 * matches on SKU alone; Vyapar's `item_code` is a manufacturer BARCODE, so a
 * straight hand-off would miss 1,074 products we already hold and re-create every
 * one as a duplicate. So this runs first: it loads every scannable value and every
 * party contact once, decides hit-or-miss per Vyapar row, and emits importer-ready
 * rows. Neither importer is modified.
 *
 * The governing rule: **additive and figure-only, never descriptive.** AbeerSuite
 * holds months of hand-corrected names, categories, brands and HSN codes. A matched
 * row therefore receives quantities, rates and balances and NOTHING else — every
 * descriptive column is simply omitted, which `patch` mode leaves untouched.
 *
 * Balances and stock are rolled back to the day before the books begin
 * (31-Mar-2026), because the current-FY vouchers are replayed on top in Phase 4.
 * Importing today's figures and then replaying would count the year twice.
 *
 *   pnpm vyapar:resolve              # dry run — reports every decision, writes nothing
 *   pnpm vyapar:resolve -- --apply
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import {
    FY_START, PARTY_EFFECT, STOCK_EFFECT,
    extractItems, extractParties, normalisePhone,
} from "./extract";
import { openVyb } from "./openVyb";
import { Pool } from "pg";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_VYB = "D:/AbeerSuite/11-09-2026_05.55.41_Network_Service_VypBackup.vyb";
/** The books begin 1-Apr-2026, so openings are stated as at the day before. */
const OPENING_DATE = "2026-03-31";

const inr = (n: number) => (n < 0 ? "-" : "") + "₹" + Math.abs(Math.round(n)).toLocaleString("en-IN");
const rp = (s: string | number, w: number) => String(s).padStart(w);

type ProductRow = { rowIndex: number; values: Record<string, string> };
type PartyRow = { rowIndex: number; values: Record<string, string> };

async function main(): Promise<void> {
    const apply = process.argv.includes("--apply");
    const url = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
    if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("REFUSING: run this against the local copy, not live.");

    const { db, close } = openVyb(process.argv.find((a) => a.endsWith(".vyb")) ?? DEFAULT_VYB, join(tmpdir(), "vy-resolve"));
    const pool = new Pool({ connectionString: url, ssl: false, max: 1 });

    // ── What we already hold ────────────────────────────────────────────────
    // SKU and barcode namespaces are kept disjoint by findSkuCodeCollision(), so a
    // Vyapar code can hit at most one of them.
    const bySku = new Map<string, { id: number; sku: string }>();
    for (const r of (await pool.query(`select id, sku from "InvProduct"`)).rows) {
        bySku.set(String(r.sku).toUpperCase(), { id: r.id, sku: r.sku });
    }
    const byCode = new Map<string, { id: number; sku: string }>();
    for (const r of (await pool.query(
        `select c.value, p.id, p.sku from inv_product_codes c join "InvProduct" p on p.id = c."productId"`,
    )).rows) {
        byCode.set(String(r.value).toUpperCase(), { id: r.id, sku: r.sku });
    }
    const takenSku = new Set(bySku.keys());
    const takenCode = new Set(byCode.keys());

    type Owner = { kind: "person" | "company"; id: number; name: string };
    const phoneOwner = new Map<string, Owner>();
    const emailOwner = new Map<string, Owner>();
    for (const r of (await pool.query(`
        select ph.phone, ph."personId" pid, ph."companyId" cid,
               coalesce(p.name, c.name) nm
        from "Phone" ph
        left join "Person" p on p.id = ph."personId"
        left join "Company" c on c.id = ph."companyId"
    `)).rows) {
        const n = normalisePhone(r.phone);
        if (!n) continue;
        phoneOwner.set(n, r.pid != null
            ? { kind: "person", id: r.pid, name: r.nm }
            : { kind: "company", id: r.cid, name: r.nm });
    }
    for (const r of (await pool.query(`
        select e.email, e."personId" pid, e."companyId" cid, coalesce(p.name, c.name) nm
        from "Email" e
        left join "Person" p on p.id = e."personId"
        left join "Company" c on c.id = e."companyId"
    `)).rows) {
        emailOwner.set(String(r.email).toLowerCase(), r.pid != null
            ? { kind: "person", id: r.pid, name: r.nm }
            : { kind: "company", id: r.cid, name: r.nm });
    }

    // ── Roll-backs to 31-Mar-2026 ───────────────────────────────────────────
    // Vyapar's figures are all as at 10-Sep. The current-FY vouchers get replayed
    // on top of these openings, so the openings must predate them.
    const stockMoved = new Map<number, number>();   // item_id → net qty in since FY_START
    for (const r of db.prepare(`
        select l.item_id id, t.txn_type ty, coalesce(l.quantity, 0) q
        from kb_lineitems l join kb_transactions t on t.txn_id = l.lineitem_txn_id
        where t.txn_date >= '${FY_START}'
    `).all() as Array<Record<string, unknown>>) {
        const dir = STOCK_EFFECT[Number(r.ty)];
        if (!dir) continue;
        const id = Number(r.id);
        stockMoved.set(id, (stockMoved.get(id) ?? 0) + dir * Number(r.q));
    }

    const balMoved = new Map<number, number>();     // name_id → signed effect since FY_START
    for (const r of db.prepare(`
        select txn_name_id nid, txn_type ty,
               coalesce(txn_cash_amount, 0) cash, coalesce(txn_balance_amount, 0) bal
        from kb_transactions
        where txn_name_id is not null and txn_date >= '${FY_START}'
    `).all() as Array<Record<string, unknown>>) {
        const e = PARTY_EFFECT[Number(r.ty)];
        if (!e) continue;
        const nid = Number(r.nid);
        balMoved.set(nid, (balMoved.get(nid) ?? 0) + e.cash * Number(r.cash) + e.bal * Number(r.bal));
    }

    // ── Products ────────────────────────────────────────────────────────────
    const items = extractItems(db).filter((i) => i.disposition !== "skip-empty");
    // Two separate batches, because the importer's modes are mutually exclusive:
    // `patch` updates existing products ONLY and errors on an unknown SKU, while a
    // create needs a mode that accepts new rows. Sending both together is what
    // produced 43 "SKU not found — patch mode only updates existing products".
    const patchRows: ProductRow[] = [];
    const createRows: ProductRow[] = [];
    const stats = { patched: 0, created: 0, skippedDead: 0, adoptedSku: 0, mintedSku: 0, noCode: 0 };
    const skippedNames: string[] = [];

    for (const i of items) {
        const code = (i.code ?? "").toUpperCase();
        const hit = code ? (bySku.get(code) ?? byCode.get(code)) : undefined;

        // Opening stock is today's quantity minus everything that moved this FY.
        const opening = i.qty - (stockMoved.get(i.itemId) ?? 0);
        // Vyapar values stock at historic cost. Its own export has no value column,
        // so unit cost must come from the backup — using the export's `Purchase
        // price` instead would misstate ₹53,403 across the catalogue.
        const rate = i.qty !== 0 ? Math.abs(i.stockValue / i.qty) : (i.purchasePrice ?? 0);

        if (hit) {
            // Figures only. Every descriptive column is omitted, and `patch` mode
            // writes just what it is given — so name, category, group, brand, unit,
            // HSN and GST keep the corrections made here.
            patchRows.push({
                rowIndex: patchRows.length,
                values: {
                    sku: hit.sku,
                    openingStock: String(opening),
                    openingRate: rate ? rate.toFixed(2) : "0",
                    ...(i.mrp ? { mrp: String(i.mrp) } : {}),
                },
            });
            stats.patched++;
            continue;
        }

        // A miss with no stock and no value carries nothing across — these are
        // retired or test rows (`test`, `z MOBILE`, `investment rased`). Skipping
        // them by rule rather than by name list means the rule keeps working on the
        // next backup.
        if (i.qty === 0 && i.stockValue === 0) {
            stats.skippedDead++;
            skippedNames.push(i.name);
            continue;
        }

        // New product. SKU is required by the bulk importer (auto-generation is
        // disabled there), and the two namespaces must stay disjoint.
        let sku: string;
        let barcode: string | undefined;
        if (code && i.codeIsOurSkuShape && !takenSku.has(code) && !takenCode.has(code)) {
            sku = code;                       // a 6-digit code is shaped like ours; adopt it
            stats.adoptedSku++;
        } else {
            sku = mintSku(takenSku, takenCode);
            if (code) barcode = i.code!;
            stats.mintedSku++;
        }
        if (!code) stats.noCode++;
        takenSku.add(sku.toUpperCase());
        if (barcode) takenCode.add(barcode.toUpperCase());

        createRows.push({
            rowIndex: createRows.length,
            values: {
                name: i.name,
                sku,
                unit: i.unitCode,
                ...(barcode ? { barcode1: barcode } : {}),
                ...(i.hsn ? { hsnCode: i.hsn } : {}),
                ...(i.salePrice ? { salePrice: String(i.salePrice) } : {}),
                ...(i.mrp ? { mrp: String(i.mrp) } : {}),
                openingStock: String(opening),
                openingRate: rate ? rate.toFixed(2) : "0",
            },
        });
        stats.created++;
    }

    // ── Parties ─────────────────────────────────────────────────────────────
    const parties = extractParties(db).filter((p) => p.include);

    // Vyapar lets two different parties carry the same phone number, and six do.
    // That is a problem in both directions: the importer rejects the second row as
    // a duplicate, and worse, if the number matches an existing record then BOTH
    // Vyapar parties resolve to the SAME AbeerSuite party and one of the two
    // balances is silently lost. So only the first claimant keeps the number; later
    // ones fall back to a placeholder and are reported for a deliberate merge.
    const phoneClaim = new Map<string, number>();
    const sharedPhone = new Set<number>();
    const sharedPairs: string[] = [];
    for (const p of parties) {
        if (!p.phone) continue;
        const first = phoneClaim.get(p.phone);
        if (first === undefined) phoneClaim.set(p.phone, p.nameId);
        else {
            sharedPhone.add(p.nameId);
            sharedPairs.push(`${p.name} shares ${p.phone} with an earlier party`);
        }
    }

    const partyRows: PartyRow[] = [];
    const pstats = { updated: 0, created: 0, keptOurName: 0, keptOurKind: 0, placeholder: 0 };

    for (const p of parties) {
        // A shared number is treated as no number at all for this party.
        const phone = sharedPhone.has(p.nameId) ? null : p.phone;
        const owner = (phone ? phoneOwner.get(phone) : undefined)
            ?? (p.email ? emailOwner.get(p.email.toLowerCase()) : undefined);

        const opening = p.balance - (balMoved.get(p.nameId) ?? 0);
        const bal = Math.abs(opening) < 0.01
            ? {}
            : opening > 0
                ? { receivableBalance: opening.toFixed(2) }
                : { payableBalance: Math.abs(opening).toFixed(2) };

        if (owner) {
            // `update` mode overwrites `name` unconditionally, so send OUR name back
            // — the write becomes a no-op instead of replacing a corrected name with
            // Vyapar's. `kind` likewise: Vyapar has no person/company concept at all,
            // and sending our guess would make the importer reject 75 rows outright.
            if (owner.name !== p.name) pstats.keptOurName++;
            if (owner.kind !== p.kind) pstats.keptOurKind++;
            partyRows.push({
                rowIndex: partyRows.length,
                values: {
                    name: owner.name,
                    kind: owner.kind,
                    ...(phone ? { phone1: phone } : {}),
                    ...(p.email ? { email1: p.email } : {}),
                    ...bal,
                },
            });
            pstats.updated++;
            continue;
        }

        // A party with no usable contact needs one anyway — `runCustomerImport`
        // requires a phone or email as its dedupe key, and only auto-generates a
        // placeholder when a GSTIN or balance is present. That leaves out the
        // parties that are here purely because they appear on invoices, which is
        // most of them. So the placeholder is minted here instead.
        //
        // Keyed on the Vyapar name_id, NOT a random uuid: a random one would mint a
        // fresh address on every run and create a duplicate party each time. This
        // is stable, unique, traceable back to the source row, and `.invalid` is a
        // reserved TLD (RFC 2606) so it can never be delivered to a real person.
        const contact = phone ? { phone1: phone }
            : p.email ? { email1: p.email }
                : { email1: `vyapar-${p.nameId}@placeholder.invalid` };
        if (!phone && !p.email) pstats.placeholder++;

        partyRows.push({
            rowIndex: partyRows.length,
            values: {
                name: p.name,
                kind: p.kind,
                accountGroup: opening < 0 ? "creditor" : "debtor",
                ...contact,
                ...(p.address ? { address: p.address } : {}),
                ...(p.gstin ? { gstin: p.gstin } : {}),
                ...(p.creditLimit ? { creditLimit: String(p.creditLimit) } : {}),
                ...bal,
            },
        });
        pstats.created++;
    }

    // ── Report ──────────────────────────────────────────────────────────────
    console.log(`\nopenings dated ${OPENING_DATE}; FY vouchers from ${FY_START} are replayed on top\n`);
    console.log(`PRODUCTS  ${patchRows.length + createRows.length} rows`);
    console.log(`  ${rp(stats.patched, 5)}  update figures only (stock, cost, MRP — nothing descriptive)`);
    console.log(`  ${rp(stats.created, 5)}  create  (${stats.adoptedSku} adopt their Vyapar code as SKU, ${stats.mintedSku} get a minted SKU, ${stats.noCode} have no code)`);
    console.log(`  ${rp(stats.skippedDead, 5)}  skipped — no stock, no value, not ours: ${skippedNames.slice(0, 5).join(", ")}${skippedNames.length > 5 ? " …" : ""}`);

    console.log(`\nPARTIES   ${partyRows.length} rows`);
    console.log(`  ${rp(pstats.updated, 5)}  update balance only  (${pstats.keptOurName} keep our name over Vyapar's, ${pstats.keptOurKind} keep our person/company kind)`);
    console.log(`  ${rp(pstats.created, 5)}  create  (${pstats.placeholder} need a placeholder contact)`);
    if (sharedPairs.length) {
        console.log(`  ⚠ ${sharedPairs.length} share a phone with another party — kept separate, MERGE BY HAND later:`);
        for (const m of sharedPairs) console.log(`      ${m}`);
    }

    const recv = partyRows.reduce((s, r) => s + Number(r.values.receivableBalance ?? 0), 0);
    const pay = partyRows.reduce((s, r) => s + Number(r.values.payableBalance ?? 0), 0);
    console.log(`  opening receivable ${inr(recv)} · payable ${inr(pay)}  (as at ${OPENING_DATE})`);

    const openStock = [...patchRows, ...createRows].reduce((s, r) => s + Number(r.values.openingStock ?? 0), 0);
    console.log(`\nopening stock: ${Math.round(openStock).toLocaleString("en-IN")} units as at ${OPENING_DATE}`);

    // ── Hand off ────────────────────────────────────────────────────────────
    // Dynamic import AFTER dotenv, so the Prisma singleton is built with env loaded
    // (the pattern in src/scripts/opening-bills-backfill.ts).
    const { runProductImport } = await import("@/shared/lib/import/productImport");
    const { runCustomerImport } = await import("@/shared/lib/import/customerImport");

    console.log(`\n${apply ? "APPLYING" : "dry run"} …`);

    // Creates first: a patch that referenced a product this run is about to make
    // would otherwise fail on a SKU that does not exist yet.
    if (createRows.length) {
        report("products created", await runProductImport({
            rows: createRows as never, mode: "skip", dryRun: !apply, autoCreateMasters: false,
        }));
    }
    report("products patched", await runProductImport({
        rows: patchRows as never, mode: "patch", dryRun: !apply, autoCreateMasters: false,
    }));

    report("parties", await runCustomerImport({ rows: partyRows as never, mode: "update", dryRun: !apply }));

    if (!apply) console.log(`\nNothing written. Re-run with --apply.\n`);
    await pool.end();
    close();
}

function report(label: string, res: { results: Array<{ action: string; errors?: string[]; rowIndex: number; name?: string | null }> }): void {
    const by = new Map<string, number>();
    for (const r of res.results) by.set(r.action, (by.get(r.action) ?? 0) + 1);
    console.log(`  ${label}: ${[...by].map(([k, v]) => `${k} ${v}`).join(" · ")}`);
    const errs = res.results.filter((r) => r.action === "error");
    for (const e of errs.slice(0, 10)) {
        console.log(`    ✗ row ${e.rowIndex} ${e.name ?? ""}: ${(e.errors ?? []).join("; ")}`);
    }
    if (errs.length > 10) console.log(`    … ${errs.length - 10} more errors`);
}

/** Mint a 6-digit SKU the way the app does, but check BOTH namespaces first. */
function mintSku(takenSku: Set<string>, takenCode: Set<string>): string {
    for (let i = 0; i < 10_000; i++) {
        const s = String(Math.floor(100000 + Math.random() * 900000));
        if (!takenSku.has(s) && !takenCode.has(s)) return s;
    }
    throw new Error("could not mint a free SKU");
}

main().catch((e: Error) => { console.error(`\n${e.message}\n`); process.exit(1); });
