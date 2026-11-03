/**
 * One-off: move every active product's sale-price source to COMPUTED, keeping
 * today's effective sale price to the paisa. For each product we back-solve the
 * margin from its weighted-average cost and GST:
 *
 *   margin% = price ÷ (1 + GST%) ÷ cost − 1        (rounded to 2 dp, the column's scale)
 *
 * and only switch it when recomputePrices' COMPUTED formula gives back exactly
 * the same paise. When no 2-dp margin hits it exactly, the nearest one is used and
 * the price drifts by a few paise (capped at MAX_DRIFT_PAISE). Products with no
 * cost or a non-WA cost-method override are left as they are and listed.
 *
 * Usage:
 *   npx tsx scripts/switch-prices-to-computed.ts            # dry run
 *   npx tsx scripts/switch-prices-to-computed.ts --commit   # write
 */

import "dotenv/config";
import { prisma } from "../src/shared/lib/prisma/prismaClient";
import { resolveCostBatch } from "../src/modules/pricing-strategy/lib/resolveCost";
import { resolveProductTaxBatch } from "../src/modules/inventory/lib/gstResolver";

const COMMIT = process.argv.includes("--commit");
const MAX_DRIFT_PAISE = 100;

// Same as recomputePrices' COMPUTED branch.
function computedPrice(cost: number, marginPct: number, gstPct: number, mrp: number | null): number {
    const gross = Math.round(cost * (1 + marginPct / 100) * (1 + gstPct / 100));
    return mrp != null && mrp > 0 ? Math.min(gross, mrp) : gross;
}

async function main() {
    const products = await prisma.invProduct.findMany({
        where:  { isActive: true },
        select: {
            id: true, sku: true, name: true, stock: true, mrpPaise: true, costMethod: true,
            marginPercent: true, effectiveSalePriceSource: true, effectiveSalePricePaise: true,
        },
    });
    const costs = await resolveCostBatch(products.map((p) => ({ id: p.id, stock: p.stock })), "WEIGHTED_AVG");
    const tax   = (await resolveProductTaxBatch({ productIds: products.map((p) => p.id) })).products;

    const switches: { id: number; margin: number; price: number }[] = [];
    const skipped: Record<string, string[]> = {};
    const skip = (why: string, p: typeof products[number]) => (skipped[why] ??= []).push(`${p.sku} ${p.name}`);
    let alreadyComputed = 0, negative = 0, drifted = 0, maxDrift = 0;

    for (const p of products) {
        if (p.effectiveSalePriceSource === "COMPUTED" && p.marginPercent != null) { alreadyComputed++; continue; }
        if (p.costMethod != null && p.costMethod !== "WEIGHTED_AVG") { skip(`cost method ${p.costMethod}`, p); continue; }
        const price = p.effectiveSalePricePaise;
        if (price == null || price <= 0) { skip("no current sale price", p); continue; }
        const cost = costs.get(p.id)?.costPaise ?? null;
        if (cost == null || cost <= 0) { skip("no cost", p); continue; }
        const gst = tax.get(p.id)?.gstRate ?? 0;

        const base = Math.round((price / (1 + gst / 100) / cost - 1) * 10000) / 100;
        const margin = [base, base - 0.01, base + 0.01, base - 0.02, base + 0.02]
            .map((m) => Math.round(m * 100) / 100)
            .find((m) => Math.abs(m) < 9999.99 && computedPrice(cost, m, gst, p.mrpPaise) === price);
        // No exact hit: take the nearest 2-dp margin and accept a few paise of drift.
        const chosen = margin ?? base;
        if (Math.abs(chosen) >= 9999.99) { skip("margin too large for the column (cost looks wrong)", p); continue; }
        const newPrice = computedPrice(cost, chosen, gst, p.mrpPaise);
        const drift = newPrice - price;
        if (Math.abs(drift) > MAX_DRIFT_PAISE) { skip(`price would move more than ${MAX_DRIFT_PAISE} paise`, p); continue; }
        if (drift !== 0) { drifted++; maxDrift = Math.max(maxDrift, Math.abs(drift)); }
        if (chosen < 0) negative++;
        switches.push({ id: p.id, margin: chosen, price: newPrice });
    }

    console.log(`Active products:        ${products.length}`);
    console.log(`Already COMPUTED:       ${alreadyComputed}`);
    console.log(`Will switch:            ${switches.length}  (below cost: ${negative}, price moved: ${drifted}, max move: ${maxDrift} paise)`);
    for (const [why, list] of Object.entries(skipped)) {
        console.log(`Skipped – ${why}: ${list.length}`);
        for (const s of list.slice(0, 15)) console.log(`    ${s}`);
        if (list.length > 15) console.log(`    … ${list.length - 15} more`);
    }

    if (!COMMIT) { console.log("\nDry run — nothing written. Re-run with --commit."); return; }
    for (let i = 0; i < switches.length; i += 25) {
        await prisma.$transaction(
            switches.slice(i, i + 25).map((s) => prisma.invProduct.update({
                where: { id: s.id },
                data:  { effectiveSalePriceSource: "COMPUTED", marginPercent: s.margin, effectiveSalePricePaise: s.price },
            })),
        );
    }
    console.log(`\nWritten: ${switches.length} products now COMPUTED.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
