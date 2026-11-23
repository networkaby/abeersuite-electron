// Rebuild every running total from its ledger, on whichever database the env points
// at, and report the drift. The one-shot repair behind the rule "a running total
// never travels between machines; each side re-sums its own ledger" (see
// `cacheColumns` in scripts/gen-sync-registry.ts).
//
//   InvProduct.stock       = openingStock + Σ(inQty − outQty)
//   InvProductBranch.stock = Σ(inQty − outQty) per branch
//   GiftCard.balance       = Σ GiftCardTxn.amount   (cards with at least one txn)
//
// Run once on Supabase before the first counter goes local on this build, and any
// time drift is suspected. Also usable against a counter's replica by pointing
// DATABASE_URL at it.
//
//   pnpm recompute:caches            report drift only (exit 1 if any)
//   pnpm recompute:caches --fix      write ledger truth into the caches

import { prisma, pool, rawUrl } from "@/shared/lib/db/scriptPrisma";



const FIX = process.argv.includes("--fix");
const n = (v: unknown) => Number(v ?? 0);
const EPS = 0.0005;
const round2 = (v: number) => Math.round(v * 100) / 100;
// The stock columns are Int, the ledger Decimal(10,3): compare and write the
// rounded figure, the way recomputeProductStock's ROUND() does (half away from 0).
const roundInt = (v: number) => Math.sign(v) * Math.round(Math.abs(v));

type Drift = { what: string; key: string; cached: number; computed: number };

async function stock(): Promise<Drift[]> {
    const [byProduct, byBranch, products, branchRows] = await Promise.all([
        prisma.invStockLedger.groupBy({ by: ["productId"], _sum: { inQty: true, outQty: true } }),
        prisma.invStockLedger.groupBy({ by: ["productId", "branchId"], _sum: { inQty: true, outQty: true } }),
        prisma.invProduct.findMany({ select: { id: true, sku: true, stock: true, openingStock: true } }),
        prisma.invProductBranch.findMany({ select: { productId: true, branchId: true, stock: true } }),
    ]);
    const ledger = new Map(byProduct.map((r) => [r.productId, n(r._sum.inQty) - n(r._sum.outQty)]));
    const drift: Drift[] = [];
    for (const p of products) {
        const c = roundInt(n(p.openingStock) + (ledger.get(p.id) ?? 0));
        if (Math.abs(c - n(p.stock)) > EPS) {
            drift.push({ what: "InvProduct.stock", key: `${p.id} ${p.sku}`, cached: n(p.stock), computed: c });
            if (FIX) await prisma.invProduct.update({ where: { id: p.id }, data: { stock: c } });
        }
    }
    const branchLedger = new Map(byBranch.map((r) => [`${r.productId}|${r.branchId}`, n(r._sum.inQty) - n(r._sum.outQty)]));
    for (const b of branchRows) {
        const c = roundInt(branchLedger.get(`${b.productId}|${b.branchId}`) ?? 0);
        if (Math.abs(c - n(b.stock)) > EPS) {
            drift.push({ what: "InvProductBranch.stock", key: `${b.productId}|${b.branchId}`, cached: n(b.stock), computed: c });
            if (FIX) await prisma.invProductBranch.update({ where: { productId_branchId: { productId: b.productId, branchId: b.branchId } }, data: { stock: c } });
        }
    }
    return drift;
}

async function giftCards(): Promise<Drift[]> {
    const [cards, sums] = await Promise.all([
        prisma.giftCard.findMany({ select: { id: true, code: true, balance: true, status: true } }),
        prisma.giftCardTxn.groupBy({ by: ["giftCardId"], _sum: { amount: true } }),
    ]);
    const ledger = new Map(sums.map((r) => [r.giftCardId, round2(n(r._sum.amount))]));
    const drift: Drift[] = [];
    for (const g of cards) {
        const c = ledger.get(g.id);
        if (c === undefined) continue; // DRAFT: no ledger yet, balance is the typed value
        if (Math.abs(c - n(g.balance)) > EPS) {
            drift.push({ what: "GiftCard.balance", key: `${g.id} ${g.code}`, cached: n(g.balance), computed: c });
            if (FIX) {
                const status = g.status === "ACTIVE" && c <= 0.005 ? "REDEEMED" : g.status === "REDEEMED" && c > 0.005 ? "ACTIVE" : g.status;
                await prisma.giftCard.update({ where: { id: g.id }, data: { balance: c, status } });
            }
        }
    }
    return drift;
}

async function main() {
    console.log(`recompute-caches on ${rawUrl.replace(/:\/\/[^@]*@/, "://…@")} ${FIX ? "(FIX)" : "(report only)"}`);
    const all = [...await stock(), ...await giftCards()];
    const byWhat = new Map<string, number>();
    for (const d of all) byWhat.set(d.what, (byWhat.get(d.what) ?? 0) + 1);
    for (const [what, count] of byWhat) console.log(`  ${what.padEnd(24)} drift rows: ${count}`);
    if (all.length === 0) console.log("  no drift.");
    for (const d of all.slice(0, 40)) {
        console.log(`    ${d.what.padEnd(24)} ${d.key.padEnd(40)} cached=${d.cached} computed=${d.computed}`);
    }
    if (all.length > 40) console.log(`    … ${all.length - 40} more`);
    if (FIX) console.log(`  wrote ${all.length} cache value(s).`);
    process.exitCode = all.length > 0 && !FIX ? 1 : 0;
}

main()
    .catch((e) => { console.error(e); process.exitCode = 2; })
    .finally(async () => { await prisma.$disconnect(); await pool.end(); });
