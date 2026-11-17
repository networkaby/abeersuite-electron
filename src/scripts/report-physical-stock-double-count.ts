// REPORT ONLY — lists posted Physical Stock counts that probably added the
// opening quantity a second time. Never writes: every query runs inside a
// READ ONLY transaction, so even a bug here cannot change a row.
//
// The bug (fixed 2026-10-24, see loadStockBeforeDate in liveStock.ts): the
// first Physical Stock of a day posted `counted − (branch ledger before the
// date)` and left `openingStock` out. When the product's opening counts in that
// branch, the adjustment came out too high by exactly the opening:
//
//   opening 10, nothing sold, count 10 → posted +10 (should be 0) → stock 20
//
// Each first-of-day count is checked against BOTH formulas, using the branch's
// ledger before the count date as it stands today:
//
//   posted = counted − ledger before            → "old formula": doubled
//   posted = counted − ledger before − opening  → correct (fixed code) — skipped
//   neither                                     → "unclear": listed, check by hand
//
// so a count posted after the fix never shows up as a false alarm. For each line
// it prints what was posted, what should have been, and the excess. A PERSON
// decides what to do about each one — usually a fresh Physical Stock count, or a
// correcting entry. Nothing is fixed here.
//
// Read each line with care. It is a likely case, not a proven one:
//   • the opening shown is the opening TODAY. If it was entered or changed
//     AFTER the count was posted (a later Vyapar load, an edit), the count did
//     not double it — or doubled a different number.
//   • "unclear" usually means a back-dated voucher was entered after the count,
//     which changes "ledger before" after the fact.
//   • a second count of the same product, branch and day only ADDS its
//     quantity, so only the first one of the day is checked.
//
//   pnpm report:ps-double-count                    print the list
//   pnpm report:ps-double-count --csv out.csv      also write it as CSV

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { writeFileSync } from "node:fs";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { HEAD_OFFICE_BRANCH_ID } from "@/shared/lib/org/systemBranch";

const rawUrl = (process.env.DIRECT_URL_1 ?? process.env.DATABASE_URL_1 ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
const isLocalDb = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(rawUrl);
const pool = new Pool({ connectionString: rawUrl, ssl: isLocalDb ? false : { rejectUnauthorized: false }, max: 2 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const csvAt = process.argv.indexOf("--csv");
const CSV = csvAt > 0 ? process.argv[csvAt + 1] : null;
const n = (v: unknown) => Number(v ?? 0);
const EPS = 0.0005;
const same = (a: number, b: number) => Math.abs(a - b) < EPS;

// Inlined rather than imported (same reason as recompute-caches.ts: the shared
// helpers pull in the app's prisma client). MUST match openingAppliesTo in
// src/modules/inventory/lib/liveStock.ts: an opening counts only at its own
// branch, and one with no branch at Head Office.
const openingApplies = (openingBranchId: string | null, branchId: string) =>
    (openingBranchId ?? HEAD_OFFICE_BRANCH_ID) === branchId;

type Row = {
    voucherNo: string; date: string; postedAt: string; branch: string;
    sku: string; name: string; counted: number; opening: number; ledgerBefore: number;
    posted: number; shouldBe: number; excess: number; match: "old formula" | "unclear";
};

async function main() {
    const rows = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;

        const counts = await tx.universalVoucher.findMany({
            where:   { type: "PHYSICAL_STOCK", status: "POSTED" },
            select:  {
                id: true, voucherNo: true, date: true, branchId: true, postedAt: true,
                inventoryLines: { select: { productId: true, quantity: true } },
            },
            orderBy: [{ postedAt: "asc" }, { id: "asc" }],
        });
        if (counts.length === 0) return [];

        const productIds = [...new Set(counts.flatMap((c) => c.inventoryLines.map((l) => l.productId)))];
        const products = await tx.invProduct.findMany({
            where:  { id: { in: productIds }, openingStock: { not: null } },
            select: { id: true, sku: true, name: true, openingStock: true, openingBranchId: true },
        });
        const productById = new Map(products.map((p) => [p.id, p]));
        const branches = new Map((await tx.branch.findMany({ select: { id: true, name: true } })).map((b) => [b.id, b.name]));
        // What each count actually posted, per product (its own ledger rows only).
        const postedRows = await tx.invStockLedger.groupBy({
            by:    ["universalVoucherId", "productId"],
            where: { universalVoucherId: { in: counts.map((c) => c.id) } },
            _sum:  { inQty: true, outQty: true },
        });
        const posted = new Map(postedRows.map((r) => [`${r.universalVoucherId}|${r.productId}`, n(r._sum.inQty) - n(r._sum.outQty)]));
        // Branch ledger per day for these products — POSTED only, the window the
        // post path reads (loadStockBeforeDate). One grouped read; "before a
        // date" is summed in memory, not one query per count.
        const daily = await tx.invStockLedger.groupBy({
            by:    ["productId", "branchId", "date"],
            where: { productId: { in: products.map((p) => p.id) }, universalVoucher: { status: "POSTED" } },
            _sum:  { inQty: true, outQty: true },
        });
        const dailyByKey = new Map<string, Array<{ date: Date; q: number }>>();
        for (const d of daily) {
            const k = `${d.productId}|${d.branchId}`;
            const list = dailyByKey.get(k) ?? [];
            list.push({ date: d.date, q: n(d._sum.inQty) - n(d._sum.outQty) });
            dailyByKey.set(k, list);
        }
        const ledgerBefore = (productId: number, branchId: string, date: Date) =>
            (dailyByKey.get(`${productId}|${branchId}`) ?? []).reduce((sum, d) => d.date < date ? sum + d.q : sum, 0);

        const out: Row[] = [];
        const seenFirst = new Set<string>();   // product|branch|day — first count only
        for (const c of counts) {
            const day = c.date.toISOString().slice(0, 10);
            const lines = new Map<number, number>();
            for (const l of c.inventoryLines) lines.set(l.productId, (lines.get(l.productId) ?? 0) + n(l.quantity));
            for (const [productId, counted] of lines) {
                const key = `${productId}|${c.branchId}|${day}`;
                if (seenFirst.has(key)) continue;
                seenFirst.add(key);

                const p = productById.get(productId);
                const opening = n(p?.openingStock);
                if (!p || opening === 0 || !c.branchId || !openingApplies(p.openingBranchId, c.branchId)) continue;

                const was = posted.get(`${c.id}|${productId}`) ?? 0;
                const before = ledgerBefore(productId, c.branchId, c.date);
                if (same(was, counted - before - opening)) continue;   // posted correctly
                out.push({
                    voucherNo: c.voucherNo ?? `UV-${c.id}`, date: day,
                    postedAt:  c.postedAt?.toISOString().slice(0, 16).replace("T", " ") ?? "",
                    branch:    branches.get(c.branchId) ?? c.branchId,
                    sku: p.sku, name: p.name, counted, opening, ledgerBefore: before,
                    posted: was, shouldBe: counted - before - opening, excess: was - (counted - before - opening),
                    match: same(was, counted - before) ? "old formula" : "unclear",
                });
            }
        }
        return out;
    }, { timeout: 120_000, maxWait: 30_000 });

    console.log(`Physical Stock counts that probably doubled the opening — REPORT ONLY, nothing written.`);
    console.log(`Database: ${rawUrl.replace(/\/\/[^@]*@/, "//…@")}\n`);
    if (rows.length === 0) {
        console.log("None found ✓ — every first-of-day count on a product with an opening in that branch posted correctly.");
        return;
    }
    console.table(rows.map((r) => ({
        "Voucher": r.voucherNo, "Date": r.date, "Posted at": r.postedAt, "Branch": r.branch,
        "SKU": r.sku, "Counted": r.counted, "Opening": r.opening, "Ledger before": r.ledgerBefore,
        "Posted adj.": r.posted, "Should be": r.shouldBe, "Excess": r.excess, "Match": r.match,
    })));
    const doubled = rows.filter((r) => r.match === "old formula");
    const units = doubled.reduce((s, r) => s + r.excess, 0);
    console.log(`\n${doubled.length} count line(s) match the old formula — ${units} unit(s) likely added twice.`);
    console.log(`${rows.length - doubled.length} line(s) unclear (match neither formula).`);
    console.log("Check each one: was the opening already there when the count was posted? Then decide — usually a fresh count.");

    if (CSV) {
        const esc = (v: string | number) => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
        const head = ["voucherNo", "date", "postedAt", "branch", "sku", "name", "counted", "opening", "ledgerBefore", "posted", "shouldBe", "excess", "match"] as const;
        writeFileSync(CSV, [head.join(","), ...rows.map((r) => head.map((h) => esc(r[h])).join(","))].join("\n") + "\n");
        console.log(`CSV written to ${CSV}`);
    }
}

main()
    .then(() => prisma.$disconnect())
    .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
