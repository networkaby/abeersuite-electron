/**
 * One-off cleanup: an earlier CSV import put supplier barcodes into
 * `InvProduct.sku`. Our own SKU format is 6 digits (see
 * `src/modules/inventory/lib/sku.ts`), so any other shape is not a SKU.
 *
 * For every product whose SKU is not 6 digits:
 *   1. the old SKU value is moved into `inv_product_codes` as a scannable code,
 *      classified by GTIN check digit (NOT by length alone — see below);
 *   2. the product gets a freshly generated, unused 6-digit SKU.
 *
 * The old value therefore stays scannable: `productSearchWhere()` and
 * `ProductScanInput` already match on `codes.value`, so scanning the printed
 * supplier barcode still resolves to the same product.
 *
 * Classification rule — EAN-13 / UPC-A / EAN-8 all carry a mod-10 check digit,
 * so a length-13 string that fails the checksum is not an EAN. Measured on this
 * dataset, 13- and 12-digit SKUs pass at 99% / 96% (real barcodes) while the
 * 7/9/10/11-digit groups pass at ~10% — pure chance, i.e. internal codes that
 * merely look numeric. Length alone would have mislabelled 300 eleven-digit
 * internal codes as UPC.
 *
 *   13 digits + valid checksum -> EAN
 *   12 digits + valid checksum -> UPC
 *    8 digits + valid checksum -> EAN   (EAN-8)
 *   anything else              -> BARCODE
 *
 * Run (prints the full before -> after table, writes nothing):
 *   pnpm tsx scripts/reclassify-imported-skus.ts
 * Apply (single transaction):
 *   pnpm tsx scripts/reclassify-imported-skus.ts --commit
 */
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { generateSku } from "../src/modules/inventory/lib/sku";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const COMMIT = process.argv.includes("--commit");

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");
if (!rawUrl) throw new Error("No DIRECT_URL / DATABASE_URL in env");

const pool = new Pool({
    connectionString: rawUrl,
    ssl: /@(localhost|127\.0\.0\.1)/.test(rawUrl) ? false : { rejectUnauthorized: false },
    max: 2,
});

type Kind = "BARCODE" | "EAN" | "UPC";

const isOurSku = (s: string) => /^\d{6}$/.test(s);

/** GS1 mod-10 check digit, defined for GTIN-8 / 12 / 13 / 14 only. */
function gtinChecksumValid(s: string): boolean {
    if (!/^\d+$/.test(s)) return false;
    if (![8, 12, 13, 14].includes(s.length)) return false;
    const d = [...s].map(Number);
    const check = d.pop()!;
    let sum = 0;
    for (let i = d.length - 1, mult = 3; i >= 0; i--, mult = mult === 3 ? 1 : 3) sum += d[i] * mult;
    return (10 - (sum % 10)) % 10 === check;
}

function classify(sku: string): Kind {
    if (gtinChecksumValid(sku)) {
        if (sku.length === 13 || sku.length === 8) return "EAN";
        if (sku.length === 12) return "UPC";
    }
    return "BARCODE";
}

async function main() {
    const { rows: products } = await pool.query<{ id: number; sku: string; name: string }>(
        `SELECT id, sku, name FROM "InvProduct" ORDER BY id`,
    );
    const { rows: codeRows } = await pool.query<{ value: string }>(`SELECT value FROM inv_product_codes`);

    // The scannable namespace spans BOTH tables (see codeCollision.ts) — a new
    // SKU must not collide with any existing SKU *or* any code value, including
    // the ones this run is about to insert.
    const taken = new Set<string>([...products.map((p) => p.sku), ...codeRows.map((c) => c.value)]);

    const targets = products.filter((p) => !isOurSku(p.sku));
    const plan = targets.map((p) => {
        let fresh = generateSku();
        while (taken.has(fresh)) fresh = generateSku();
        taken.add(fresh);
        return { id: p.id, name: p.name, oldSku: p.sku, newSku: fresh, kind: classify(p.sku) };
    });

    const counts = plan.reduce<Record<string, number>>((acc, r) => {
        acc[r.kind] = (acc[r.kind] ?? 0) + 1;
        return acc;
    }, {});

    console.log(`products total          : ${products.length}`);
    console.log(`already 6-digit (skipped): ${products.length - targets.length}`);
    console.log(`to reclassify           : ${plan.length}`);
    console.log(`  -> EAN     : ${counts.EAN ?? 0}`);
    console.log(`  -> UPC     : ${counts.UPC ?? 0}`);
    console.log(`  -> BARCODE : ${counts.BARCODE ?? 0}`);

    console.log(`\n${"old SKU".padEnd(16)} ${"->".padEnd(2)} ${"new SKU".padEnd(8)} ${"kind".padEnd(8)} name`);
    for (const r of plan) {
        console.log(`${r.oldSku.padEnd(16)} -> ${r.newSku.padEnd(8)} ${r.kind.padEnd(8)} ${r.name.slice(0, 60)}`);
    }

    if (!COMMIT) {
        console.log(`\nDRY RUN — nothing written. Re-run with --commit to apply.`);
        await pool.end();
        return;
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        for (const r of plan) {
            // Insert the code first: `value` is globally unique, so if this old
            // SKU is somehow already a code the whole transaction aborts rather
            // than silently dropping a scannable identifier.
            await client.query(
                `INSERT INTO inv_product_codes ("productId", kind, value, "sortOrder", "createdAt")
                 VALUES ($1, $2::"InvProductCodeKind", $3, 0, now())`,
                [r.id, r.kind, r.oldSku],
            );
            await client.query(`UPDATE "InvProduct" SET sku = $1 WHERE id = $2`, [r.newSku, r.id]);
        }
        await client.query("COMMIT");
        console.log(`\nCOMMITTED — ${plan.length} products reclassified.`);
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("\nROLLED BACK — nothing changed.", err);
        process.exitCode = 1;
    } finally {
        client.release();
    }
    await pool.end();
}

main();
