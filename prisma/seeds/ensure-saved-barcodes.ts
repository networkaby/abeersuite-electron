/**
 * Save the barcode price for every product that has a Sale Price but no saved
 * barcode yet. Targeted and idempotent — run it as often as you like.
 *
 *   pnpm seed:saved-barcodes
 *
 * Since 2026-11-03 the barcode price is STORED (InvProduct.barcodeManualPaise)
 * and only a barcode save moves it (src/modules/pricing-strategy/lib/barcodeStore.ts).
 * Products from before that still derive theirs live from the Sale Price, so a
 * Sale Price change would still move their barcode. This script freezes them at
 * exactly the price they print today (bands on the saved Sale Price, MRP-capped):
 *   • barcodeManualPaise = that price, barcodeIsManual = false;
 *   • salePriceFrozenAt is KEPT (the label's date code does not move);
 *   • barcodeGapBasePaise = the price selling now, only if not set yet.
 * A product that already has a saved barcode is never touched.
 */

import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { barcodeTagPaise, normalizeBarcodeBands } from "../../src/shared/lib/pricing/barcodePrice";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");
const pool = new Pool({
    connectionString: rawUrl,
    ssl: /@(localhost|127\.0\.0\.1)/.test(rawUrl) ? false : { rejectUnauthorized: false },
    max: 2,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
    const od = await prisma.orgDefaults.findUnique({ where: { id: 1 }, select: { barcodeBandsJson: true } });
    const bands = normalizeBarcodeBands(od?.barcodeBandsJson);
    const rows = await prisma.invProduct.findMany({
        where:  { barcodeManualPaise: null, savedSalePricePaise: { not: null } },
        select: { id: true, savedSalePricePaise: true, mrpPaise: true, effectiveSalePricePaise: true, barcodeGapBasePaise: true },
    });
    let done = 0;
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
        const ops = rows.slice(i, i + CHUNK).flatMap((p) => {
            const tag = barcodeTagPaise(p.savedSalePricePaise, p.mrpPaise, bands);
            if (tag == null) return [];
            return [prisma.invProduct.update({
                where: { id: p.id },
                data:  {
                    barcodeManualPaise: tag,
                    barcodeIsManual:    false,
                    ...(p.barcodeGapBasePaise == null ? { barcodeGapBasePaise: p.effectiveSalePricePaise } : {}),
                },
            })];
        });
        if (ops.length) await prisma.$transaction(ops);
        done += ops.length;
    }
    console.log(`Saved the barcode price for ${done} product(s); ${rows.length - done} had no barcode to save.`);
}

main()
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(async () => { await prisma.$disconnect(); await pool.end(); });
