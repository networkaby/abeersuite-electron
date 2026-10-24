// Phase 4 ②-foundation — recompute on-hand stock from the InvStockLedger (the
// source of truth) and report drift vs the cached columns. The stock mirror of
// `recompute-balances` for GL.
//
// The ledger is self-netting: inventory cancel/delete write COUNTER-entries
// (reverseStockMovement), never delete rows — so Σ(inQty − outQty) over ALL
// rows is the correct on-hand. Branch transfers net to zero org-wide (out on
// source + in on dest). No voucher-status filter needed.
//
//   InvProduct.stock        = openingStock + Σ(inQty − outQty) by productId
//   InvProductBranch.stock  = Σ(inQty − outQty) by (productId, branchId)
//
// `openingStock` is a Tally-style MASTER column (entered on the product, dated at
// booksBeginningFrom), NOT a ledger row — exactly like GL's Account.openingBalance
// folded into aggregateClosingAsOf. On-hand = master-opening + ledger movements.
//
// This is BOTH the cache safety-net (rebuild-from-truth) and the test oracle for
// the ②-edit work: after a correct edit, recomputed == cached → zero drift.
//
// Run:  pnpm tsx src/scripts/recompute-stock.ts          (check — report drift, exit 1 if any)
//       pnpm tsx src/scripts/recompute-stock.ts --fix    (apply: write cache = ledger truth)

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
const isLocalDb = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(rawUrl);
const pool = new Pool({ connectionString: rawUrl, ssl: isLocalDb ? false : { rejectUnauthorized: false }, max: 2 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const FIX = process.argv.includes("--fix");
const n = (v: unknown) => Number(v ?? 0);
const EPS = 0.0005;
// The stock columns are Int, the ledger Decimal(10,3): compare and write the
// rounded figure, the way recomputeProductStock's ROUND() does (half away from 0).
const roundInt = (v: number) => Math.sign(v) * Math.round(Math.abs(v));

async function main() {
    const [byProduct, byBranch, products, branchRows] = await Promise.all([
        prisma.invStockLedger.groupBy({ by: ["productId"], _sum: { inQty: true, outQty: true } }),
        prisma.invStockLedger.groupBy({ by: ["productId", "branchId"], _sum: { inQty: true, outQty: true } }),
        prisma.invProduct.findMany({ select: { id: true, sku: true, stock: true, openingStock: true } }),
        prisma.invProductBranch.findMany({ select: { productId: true, branchId: true, stock: true } }),
    ]);

    // ── Org-wide (InvProduct.stock) ──────────────────────────────────────────
    const computedProduct = new Map<number, number>();
    for (const r of byProduct) computedProduct.set(r.productId, n(r._sum.inQty) - n(r._sum.outQty));

    const productDrift: { id: number; sku: string; cached: number; computed: number; delta: number }[] = [];
    for (const p of products) {
        // On-hand = master opening (folded in, GL-style) + ledger movements.
        const computed = roundInt(n(p.openingStock) + (computedProduct.get(p.id) ?? 0));
        const cached = n(p.stock);
        if (Math.abs(computed - cached) > EPS) {
            productDrift.push({ id: p.id, sku: p.sku, cached, computed, delta: computed - cached });
        }
    }

    // ── Per-branch (InvProductBranch.stock) ──────────────────────────────────
    const computedBranch = new Map<string, number>();
    const key = (pid: number, bid: string) => `${pid}|${bid}`;
    for (const r of byBranch) computedBranch.set(key(r.productId, r.branchId), n(r._sum.inQty) - n(r._sum.outQty));

    const branchDrift: { productId: number; branchId: string; cached: number; computed: number }[] = [];
    for (const b of branchRows) {
        const computed = roundInt(computedBranch.get(key(b.productId, b.branchId)) ?? 0);
        const cached = n(b.stock);
        if (Math.abs(computed - cached) > EPS) {
            branchDrift.push({ productId: b.productId, branchId: b.branchId, cached, computed });
        }
    }

    console.log(`stock recompute: ${products.length} products, ${branchRows.length} product-branch rows.`);
    console.log(`  org-wide drift:   ${productDrift.length}`);
    console.log(`  per-branch drift: ${branchDrift.length}`);
    for (const d of productDrift.slice(0, 25)) {
        console.log(`    product ${d.id} (${d.sku}): cached ${d.cached} ≠ ledger ${d.computed}  (Δ ${d.delta})`);
    }

    if (productDrift.length === 0 && branchDrift.length === 0) {
        console.log("ZERO DRIFT ✓ — cached stock == ledger truth");
        return;
    }

    if (!FIX) {
        console.log("\nDRIFT ✗ — run with --fix to rebuild the cache from the ledger.");
        process.exitCode = 1;
        return;
    }

    // ── --fix: write cache = ledger truth ────────────────────────────────────
    for (const d of productDrift) {
        await prisma.invProduct.update({ where: { id: d.id }, data: { stock: d.computed } });
    }
    for (const d of branchDrift) {
        await prisma.invProductBranch.update({
            where: { productId_branchId: { productId: d.productId, branchId: d.branchId } },
            data:  { stock: d.computed },
        });
    }
    console.log(`\nFIXED ✓ — rebuilt ${productDrift.length} product + ${branchDrift.length} branch cache rows from the ledger.`);
}

main()
    .then(() => prisma.$disconnect().then(() => process.exit(process.exitCode ?? 0)))
    .catch((e) => { console.error(e); prisma.$disconnect().then(() => process.exit(1)); });
