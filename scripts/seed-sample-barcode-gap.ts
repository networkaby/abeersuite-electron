// One-off TEST DATA: make a few products show up in Needs Attention → "Low
// barcode gap", so the screen can be checked without waiting for real cost moves.
//
//   Run:    pnpm tsx scripts/seed-sample-barcode-gap.ts
//   Clean:  pnpm tsx scripts/seed-sample-barcode-gap.ts --clean
//
// What it does: picks up to 10 products that have a saved barcode and a positive
// gap today (barcode − selling price), and rewrites ONLY their gap basis
// (InvProduct.barcodeGapBasePaise) as if, on the barcode's date, the product had
// sold cheaper — so today's gap is 10% / 20% / 40% / 60% / 80% of that "original"
// gap. Barcode price, date, Sale Price and selling price are not touched.
// --clean puts every saved-barcode product's basis back to today's selling price
// (the same as `pnpm seed:saved-barcodes` leaves a new one).
//
// FAKE figures: it refuses a non-local database unless --allow-remote is given.
// Delete this script when done.

import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(rawUrl);
const args = new Set(process.argv.slice(2));

// Today's gap as this share of the faked original gap — 5 kinds, then repeat.
const SHARES = [0.1, 0.2, 0.4, 0.6, 0.8];

async function main() {
    if (!isLocal && !args.has("--allow-remote")) {
        console.error(`Refusing: the database is not local (${rawUrl.replace(/\/\/[^@]*@/, "//***@")}). These are fake figures. Add --allow-remote only if you are sure.`);
        process.exitCode = 1;
        return;
    }
    const pool = new Pool({ connectionString: rawUrl, ssl: isLocal ? false : { rejectUnauthorized: false }, max: 2 });
    try {
        if (args.has("--clean")) {
            const r = await pool.query(`UPDATE "InvProduct" SET "barcodeGapBasePaise" = "effectiveSalePricePaise", "updatedAt" = NOW()
                WHERE "barcodeManualPaise" IS NOT NULL`);
            console.log(`Gap basis reset to today's selling price on ${r.rowCount} product(s).`);
            return;
        }
        const { rows } = await pool.query<{ id: number; name: string; bc: number; eff: number }>(
            `SELECT id, name, "barcodeManualPaise" AS bc, "effectiveSalePricePaise" AS eff
               FROM "InvProduct"
              WHERE "isActive" AND "barcodeManualPaise" IS NOT NULL AND "effectiveSalePricePaise" IS NOT NULL
                AND "barcodeManualPaise" > "effectiveSalePricePaise"
              ORDER BY name LIMIT 10`,
        );
        if (rows.length === 0) {
            console.log("No product has a saved barcode above its selling price. Run `pnpm seed:saved-barcodes` first.");
            return;
        }
        for (const [i, p] of rows.entries()) {
            const gapNow = p.bc - p.eff;
            // Keep the faked "then" price believable: never below half of today's.
            const share = Math.max(SHARES[i % SHARES.length], gapNow / (p.bc - p.eff / 2));
            const base = Math.round(p.bc - gapNow / share); // original gap = gapNow / share
            await pool.query(`UPDATE "InvProduct" SET "barcodeGapBasePaise" = $1, "updatedAt" = NOW() WHERE id = $2`, [base, p.id]);
            const pct = Math.round((gapNow / (p.bc - base)) * 1000) / 10;
            console.log(`${String(pct).padStart(5)}%  ${p.name}  (barcode ₹${p.bc / 100}, sells ₹${p.eff / 100}, "then" ₹${base / 100})`);
        }
        console.log(`\n${rows.length} product(s) changed. Needs Attention → Low barcode gap: below 30% shows the 10% and 20% ones, below 50% adds the 40% ones, and so on.`);
    } finally {
        await pool.end();
    }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
