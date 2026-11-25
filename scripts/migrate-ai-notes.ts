/**
 * One-time: old AI notes → the one problem list (owner, 2026-11-25).
 *
 * An old product kept problems as text in its Attention reason and as flags on
 * the AI copy, plus old-style notes. This moves the problems onto
 * shopDraftJson.problems (exactly as `draftOf` reads them) and drops the old
 * notes. No field a customer sees is touched.
 *
 *   npx tsx scripts/migrate-ai-notes.ts            # report only → ai-notes-report.csv
 *   npx tsx scripts/migrate-ai-notes.ts --apply    # write, after the owner checked the CSV
 *
 * Run it only when every counter has the release that writes the new format.
 * Safe to run again: a product already in the new format is skipped. A row that
 * changed after it was read is skipped too, and named.
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { writeFileSync } from "node:fs";
import { attentionAgain, draftOf, problemKey, readShopDraft } from "../src/modules/ecommerce/lib/productAdmin";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const APPLY = process.argv.includes("--apply");
const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) throw new Error("DIRECT_URL / DATABASE_URL is not set");
console.log(`${APPLY ? "APPLY" : "Report only"} — database host: ${new URL(url).hostname}`);

const pool = new Pool({ connectionString: url });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

async function main() {
    const rows = (await prisma.invProduct.findMany({
        select: { id: true, sku: true, name: true, shopStatus: true, shopAttention: true, shopAttentionAt: true, shopDraftJson: true, updatedAt: true },
        orderBy: { id: "asc" },
    })).filter((r) => r.shopDraftJson !== null || r.shopAttention);
    const csv = [["SKU", "Name", "Stage", "Problems now", "Moved onto the list", "Old notes dropped"].map(cell).join(",")];
    let changed = 0;
    for (const r of rows) {
        const before = readShopDraft(r.shopDraftJson);
        if (before?.v === 2) continue;
        const now = draftOf(r);
        if (!now) continue;
        const had = new Set((before?.problems ?? []).map((p) => problemKey(p.text)));
        const moved = (now.problems ?? []).filter((p) => !had.has(problemKey(p.text)));
        const raw = r.shopDraftJson as { notes?: unknown; aiCopy?: { notes?: unknown } } | null;
        const old = [raw?.notes, raw?.aiCopy?.notes].flatMap((x) => (Array.isArray(x) ? x : []));
        csv.push([r.sku, r.name, r.shopStatus, now.problems?.length ?? 0, moved.map((p) => p.text).join(" | "), old.join(" | ")].map(cell).join(","));
        if (APPLY) {
            const done = await prisma.invProduct.updateMany({
                where: { id: r.id, updatedAt: r.updatedAt },
                data: { shopDraftJson: JSON.parse(JSON.stringify(now)), shopAttention: r.shopStatus === "ATTENTION" ? attentionAgain(r.shopAttention, now, now) : r.shopAttention },
            });
            if (!done.count) { console.log(`Changed meanwhile, skipped: SKU ${r.sku}`); continue; }
        }
        changed++;
    }
    writeFileSync("ai-notes-report.csv", "﻿" + csv.join("\r\n"));
    console.log(`${changed} product(s) ${APPLY ? "moved" : "would move"}. Report: ai-notes-report.csv`);
}

main().finally(async () => { await prisma.$disconnect(); await pool.end(); });
