/**
 * Surgical opening-stock + opening-rate updater. Reads the enriched Vyapar CSV
 * and writes ONLY four fields per matched product:
 *
 *   - openingStock   ← CSV `openingStock` (Vyapar "Current stock quantity")
 *   - openingRate    ← CSV `openingRate`  (Vyapar "Purchase price")
 *   - openingValue   = openingStock × openingRate  (computed)
 *   - stock          = round(openingStock)         (cache — syncProductCacheFromOpening)
 *   - costPaise      = round(openingRate × 100)    (cache — syncProductCacheFromOpening)
 *
 * Every other column (name, brand, category, group, hsnCode, gstRate, modelNo,
 * barcode, MRP, salePrice, isActive, …) is **left untouched**. We bypass the
 * existing /office/settings/item-import importer because that path does a
 * full-row replace on update (writes every field unconditionally, nulling any
 * column the CSV didn't carry).
 *
 * The cache sync (stock + costPaise) is safe because there are no vouchers in
 * the system yet — checked at startup; aborts if any voucher exists. Pass
 * `--opening-only` to skip the cache sync if you don't want stock/costPaise
 * touched (writes just the three opening fields).
 *
 * Match is by SKU exactly — InvProduct.sku is uppercased on the API write path,
 * so we uppercase the CSV value too before lookup. Rows whose SKU doesn't
 * exist in the DB are reported and skipped (no creation).
 *
 * Usage:
 *   pnpm tsx scripts/update-opening-from-csv.ts                  # dry-run, default
 *   pnpm tsx scripts/update-opening-from-csv.ts --commit         # apply changes
 *   pnpm tsx scripts/update-opening-from-csv.ts --commit --opening-only
 *   pnpm tsx scripts/update-opening-from-csv.ts --file <path>    # custom CSV
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { parseCsv } from "../src/shared/lib/import/csvParse";
import {
    productOpeningValue,
    syncProductCacheFromOpening,
} from "../src/modules/inventory/lib/stockValue";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const args = process.argv.slice(2);
const COMMIT       = args.includes("--commit");
const OPENING_ONLY = args.includes("--opening-only");
const fileFlag = args.indexOf("--file");
const FILE = fileFlag >= 0 && args[fileFlag + 1]
    ? args[fileFlag + 1]
    : "d:/Users/User/Desktop/contact-import-testing/Export Items_enriched_v2.csv";

const url = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 2 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

interface UpdateRow {
    sku:          string;
    openingStock: number;
    openingRate:  number;
}

function parseNumber(s: string): number | null {
    const t = (s ?? "").trim();
    if (t === "") return null;
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : null;
}

async function main(): Promise<void> {
    console.log(`\nMode: ${COMMIT ? "COMMIT" : "DRY-RUN"} ${OPENING_ONLY ? "(opening-only, no cache sync)" : "(opening + cache sync)"}`);
    console.log(`CSV : ${FILE}\n`);

    // ── Safety gate — refuse to sync cache if vouchers exist ─────────────────
    if (!OPENING_ONLY) {
        const voucherCount = await prisma.voucherDetail.count();
        if (voucherCount > 0) {
            console.error(`✗ ${voucherCount} VoucherDetail rows exist. Re-run with --opening-only so we don't clobber running stock cache.`);
            process.exit(1);
        }
    }

    // ── Read CSV ─────────────────────────────────────────────────────────────
    const raw = readFileSync(FILE, "utf8").replace(/^﻿/, "");
    const parsed = parseCsv(raw);
    const headers = parsed.headers.map((h) => h.trim());

    const I_SKU   = headers.findIndex((h) => h.toLowerCase() === "sku");
    const I_STOCK = headers.findIndex((h) => h.toLowerCase() === "openingstock");
    const I_RATE  = headers.findIndex((h) => h.toLowerCase() === "openingrate");
    if (I_SKU < 0 || I_STOCK < 0 || I_RATE < 0) {
        console.error(`✗ CSV must have columns: sku, openingStock, openingRate. Got: ${headers.join(", ")}`);
        process.exit(1);
    }

    const updates: UpdateRow[] = [];
    let skippedNoSku = 0;
    let skippedBothBlank = 0;

    for (const row of parsed.rows) {
        const sku = (row[I_SKU] ?? "").trim().toUpperCase();
        if (!sku) { skippedNoSku++; continue; }
        const openingStock = parseNumber(row[I_STOCK] ?? "");
        const openingRate  = parseNumber(row[I_RATE]  ?? "");
        // Skip rows where neither field has a meaningful value — nothing to do
        if ((openingStock == null || openingStock === 0) && (openingRate == null || openingRate === 0)) {
            skippedBothBlank++;
            continue;
        }
        updates.push({
            sku,
            openingStock: openingStock ?? 0,
            openingRate:  openingRate  ?? 0,
        });
    }
    console.log(`CSV rows parsed:        ${parsed.rows.length}`);
    console.log(`  no SKU:               ${skippedNoSku}`);
    console.log(`  qty=0 AND rate=0:     ${skippedBothBlank}`);
    console.log(`  candidates to update: ${updates.length}\n`);

    // ── Match against DB by SKU ──────────────────────────────────────────────
    const skus = [...new Set(updates.map((u) => u.sku))];
    const existing = await prisma.invProduct.findMany({
        where: { sku: { in: skus } },
        select: { id: true, sku: true, openingStock: true, openingRate: true, stock: true },
    });
    const bySku = new Map(existing.map((p) => [p.sku, p]));

    let toUpdate = 0;
    let noop = 0;
    let missing = 0;
    const missingSkus: string[] = [];

    for (const u of updates) {
        const cur = bySku.get(u.sku);
        if (!cur) { missing++; missingSkus.push(u.sku); continue; }
        // Compare against current values to count actual diffs (Decimal → number).
        const curStock = cur.openingStock == null ? null : Number(cur.openingStock);
        const curRate  = cur.openingRate  == null ? null : Number(cur.openingRate);
        if (curStock === u.openingStock && curRate === u.openingRate) {
            noop++;
            continue;
        }
        toUpdate++;
    }

    console.log(`DB match summary:`);
    console.log(`  matched in DB:        ${updates.length - missing}`);
    console.log(`  missing in DB:        ${missing}`);
    console.log(`  no-change (identical):${noop}`);
    console.log(`  will update:          ${toUpdate}`);
    if (missing > 0) {
        console.log(`\n  Sample missing SKUs (first 10):`);
        for (const s of missingSkus.slice(0, 10)) console.log(`    ${s}`);
        if (missing > 10) console.log(`    … and ${missing - 10} more`);
    }

    if (!COMMIT) {
        console.log(`\nDry-run complete. Re-run with --commit to apply.`);
        await prisma.$disconnect();
        await pool.end();
        return;
    }

    // ── Apply updates ────────────────────────────────────────────────────────
    console.log(`\nApplying ${toUpdate} updates…`);
    let done = 0;
    let failed = 0;
    for (const u of updates) {
        const cur = bySku.get(u.sku);
        if (!cur) continue;
        const curStock = cur.openingStock == null ? null : Number(cur.openingStock);
        const curRate  = cur.openingRate  == null ? null : Number(cur.openingRate);
        if (curStock === u.openingStock && curRate === u.openingRate) continue;

        const openingValue = productOpeningValue({
            openingStock: u.openingStock,
            openingRate:  u.openingRate,
        });
        const cache = syncProductCacheFromOpening({
            openingStock: u.openingStock,
            openingRate:  u.openingRate,
        });

        try {
            await prisma.invProduct.update({
                where: { id: cur.id },
                data: {
                    openingStock: u.openingStock,
                    openingRate:  u.openingRate,
                    openingValue,
                    ...(OPENING_ONLY ? {} : cache),
                },
            });
            done++;
            if (done % 100 === 0) console.log(`  …${done} / ${toUpdate}`);
        } catch (e) {
            failed++;
            console.error(`  ✗ ${u.sku}: ${(e as Error).message}`);
        }
    }
    console.log(`\nDone. Updated ${done}, failed ${failed}.`);

    await prisma.$disconnect();
    await pool.end();
}

main().catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
});
