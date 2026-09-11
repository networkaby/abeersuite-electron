/**
 * Dry run of the match step: how much of Vyapar is ALREADY in AbeerSuite?
 *
 * The migration is additive and figure-only — existing products and parties keep
 * their hand-corrected names, categories and brands and receive only fresh
 * quantities, rates and balances. Everything hinges on matching the two sides
 * correctly, and a wrong match is the worst outcome available here: it silently
 * merges two real records, and nothing downstream will ever flag it.
 *
 * So the counts get reviewed BEFORE anything is written. This script writes
 * nothing — it reads both databases and reports what the resolver would do.
 *
 * Matching rules (from the plan):
 *   • products — Vyapar `item_code` against every scannable value we hold:
 *     `InvProduct.sku` ∪ `inv_product_codes.value`. Vyapar's code is a
 *     manufacturer BARCODE, so most hits land in the codes table, not the SKU.
 *   • parties — phone or email, across BOTH Person and Company, mirroring
 *     `runCustomerImport()` so this report predicts what the importer will do.
 *
 *   pnpm vyapar:match-report [-- <path-to.vyb>]
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { extractItems, extractParties, normalisePhone } from "./extract";
import { openVyb } from "./openVyb";
import { Pool } from "pg";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_VYB = "D:/AbeerSuite/11-09-2026_05.55.41_Network_Service_VypBackup.vyb";

const rp = (s: string | number, w: number) => String(s).padStart(w);

async function main(): Promise<void> {
    const vyb = process.argv[2] ?? DEFAULT_VYB;
    const url = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
    if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("REFUSING: this report is meant for the local copy, not live.");

    const { db, close } = openVyb(vyb, join(tmpdir(), "vyapar-match"));
    const pool = new Pool({ connectionString: url, ssl: false, max: 1 });

    // ── Products ────────────────────────────────────────────────────────────
    // One pass each over the two scannable namespaces. They are kept disjoint by
    // findSkuCodeCollision(), so a Vyapar code can hit at most one of them.
    const bySku = new Map<string, number>();
    for (const r of (await pool.query(`select id, upper(sku) sku from "InvProduct"`)).rows) bySku.set(r.sku, r.id);
    const byCode = new Map<string, number>();
    for (const r of (await pool.query(`select "productId", upper(value) v from inv_product_codes`)).rows) byCode.set(r.v, r.productId);

    const items = extractItems(db).filter((i) => i.disposition === "migrate" || i.disposition === "service");
    let hitSku = 0, hitCode = 0, miss = 0, missAdoptSku = 0;
    const missNoCode: string[] = [];
    const collisions: string[] = [];

    for (const i of items) {
        const code = (i.code ?? "").toUpperCase();
        if (!code) { miss++; missNoCode.push(i.name); continue; }
        if (bySku.has(code)) { hitSku++; continue; }
        if (byCode.has(code)) { hitCode++; continue; }
        miss++;
        // Could this code BE the SKU? Only if it looks like one of ours AND is free
        // in both namespaces — otherwise the resolver mints a fresh SKU and files
        // the code as a barcode.
        if (i.codeIsOurSkuShape) { if (byCode.has(code)) collisions.push(i.name); else missAdoptSku++; }
    }

    console.log(`\nPRODUCTS — ${items.length} Vyapar items to place`);
    console.log(`  ${rp(hitSku + hitCode, 5)}  already here → update figures only (${hitSku} by SKU, ${hitCode} by barcode)`);
    console.log(`  ${rp(miss, 5)}  new → create`);
    console.log(`         of which ${missAdoptSku} can adopt their Vyapar code as the SKU (6-digit, free);` +
        ` ${miss - missAdoptSku - missNoCode.length} get a generated SKU + barcode row; ${missNoCode.length} have no code at all`);
    if (collisions.length) console.log(`  ⚠ ${collisions.length} would collide across the SKU/barcode namespaces — resolver must mint instead`);
    console.log(`  (we hold ${bySku.size} SKUs and ${byCode.size} barcodes)`);

    // ── Parties ─────────────────────────────────────────────────────────────
    const phoneOwner = new Map<string, string>();
    for (const r of (await pool.query(
        `select phone, "personId", "companyId" from "Phone"`,
    )).rows) {
        const n = normalisePhone(r.phone);
        if (n) phoneOwner.set(n, r.personId != null ? `person:${r.personId}` : `company:${r.companyId}`);
    }
    const emailOwner = new Map<string, string>();
    for (const r of (await pool.query(
        `select lower(email) email, "personId", "companyId" from "Email"`,
    )).rows) {
        emailOwner.set(r.email, r.personId != null ? `person:${r.personId}` : `company:${r.companyId}`);
    }

    const parties = extractParties(db).filter((p) => p.include);
    let pPhone = 0, pEmail = 0, pNew = 0, adoptedKind = 0, needPlaceholder = 0;
    let newPerson = 0, newCompany = 0;
    for (const p of parties) {
        const owner = (p.phone && phoneOwner.get(p.phone)) || (p.email && emailOwner.get(p.email.toLowerCase())) || null;
        if (owner) {
            if (p.phone && phoneOwner.has(p.phone)) pPhone++; else pEmail++;
            // `kind` is a DESCRIPTIVE field, and Vyapar has no person/company concept
            // at all — ours is inferred from `name_customer_type` / GSTIN. So on a
            // match the EXISTING record decides, exactly as name and category do.
            // Sending Vyapar's guess instead makes runCustomerImport error out
            // ("matched contact already belongs to a …"), because it rightly refuses
            // to convert a Person into a Company. 75 rows would have failed that way.
            if (!owner.startsWith(p.kind)) adoptedKind++;
        } else {
            pNew++;
            if (p.kind === "company") newCompany++; else newPerson++;
            if (!p.phone && !p.email) needPlaceholder++;
        }
    }

    console.log(`
PARTIES — ${parties.length} Vyapar parties to place`);
    console.log(`  ${rp(pPhone + pEmail, 5)}  already here → update balance only (${pPhone} by phone, ${pEmail} by email)`);
    console.log(`         ${adoptedKind} of those keep OUR person/company kind over Vyapar's guess`);
    console.log(`  ${rp(pNew, 5)}  new → create  (${newPerson} persons, ${newCompany} companies; ${needPlaceholder} need a placeholder contact)`);
    console.log(`  (we hold ${phoneOwner.size} phones and ${emailOwner.size} emails)`);

    // ── What the books look like right now ──────────────────────────────────
    const v = await pool.query(`select count(*)::int n from "UniversalVoucher"`);
    const s = await pool.query(`select count(*)::int n from "InvStockLedger"`);
    const t = await pool.query(`select count(*)::int n from "Ticket"`);
    console.log(`\nLOCAL COPY holds ${v.rows[0].n} vouchers, ${s.rows[0].n} stock movements, ${t.rows[0].n} tickets` +
        ` — these are cleared by \`pnpm seed:purge-vouchers\` before the replay.`);

    console.log(`\nNothing was written.\n`);
    await pool.end();
    close();
}

main().catch((e: Error) => { console.error(`\n${e.message}\n`); process.exit(1); });
