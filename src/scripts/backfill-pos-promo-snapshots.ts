// Record the sale-day offers on POS sales saved before they were recorded.
//
// Every POS sale now freezes the offers it was rung under — tier %, the
// customer's points just before the sale, the loyalty rates, the coupon — as
// `promoSnapshot` inside its settlementJson, so Update Sale re-bills it on its
// sale day's terms (posSaleEdit.ts). An older sale gets one made up on its
// first edit anyway (derivePromoSnapshot); this script makes it up NOW, while
// today's loyalty rates are still the closest thing to the sale day's.
//
// Made up from the sale's own rows: the stored tier %, its points before the
// sale read back off the loyalty ledger, today's rates at the rupee value its
// loyalty row was actually redeemed at. A sale with no loyalty rows gets no
// rates (loyalty was off for it).
//
// Safe to re-run: a sale that already has a snapshot is not touched — except one
// the unreleased first draft of this feature wrote, which is made up again.
//
//   pnpm backfill:pos-promo            # dry run — writes nothing
//   pnpm backfill:pos-promo --apply    # write the snapshots

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { readSettlement, buildSettlementJson } from "@/shared/lib/accountancy/settlement";
import { derivePromoSnapshot, trustedSnapshot } from "@/modules/pos/lib/posSaleEdit";
import { ratesFromConfig } from "@/modules/loyalty/lib";

const APPLY = process.argv.includes("--apply");
const CHUNK = 200;

async function main(): Promise<void> {
    const { prisma } = await import("@/shared/lib/prisma/prismaClient");
    console.log(`\nBackfill POS promo snapshots — ${APPLY ? "APPLY (writes)" : "DRY RUN (no writes)"}\n`);

    const [sales, config] = await Promise.all([
        prisma.voucherDetail.findMany({
            where:   { universalVoucher: { type: "POS" } },
            select:  { id: true, discountPct: true, settlementJson: true, universalVoucherId: true, universalVoucher: { select: { voucherNo: true } } },
            orderBy: { id: "asc" },
        }),
        prisma.loyaltyConfig.findUnique({ where: { id: 1 } }),
    ]);
    // A snapshot from the unreleased first draft is re-made too (see trustedSnapshot).
    const todo = sales.filter((v) => trustedSnapshot(readSettlement(v.settlementJson).promoSnapshot) == null);
    console.log(`POS sales: ${sales.length} · already recorded: ${sales.length - todo.length} · to record: ${todo.length}`);
    if (todo.length === 0) return;

    // Every loyalty row of every sale to record, in one read.
    const spineIds = todo.map((v) => v.universalVoucherId).filter((x): x is number => x != null);
    const ledger = await prisma.loyaltyLedger.findMany({
        where:   { universalVoucherId: { in: spineIds }, reason: { in: ["EARN_SALE", "REDEEM_SALE"] } },
        orderBy: { id: "asc" },
        select:  { universalVoucherId: true, delta: true, balanceAfter: true },
    });
    const ledgerBySpine = new Map<number, { delta: number; balanceAfter: number }[]>();
    for (const r of ledger) {
        if (r.universalVoucherId == null) continue;
        const rows = ledgerBySpine.get(r.universalVoucherId) ?? [];
        rows.push(r);
        ledgerBySpine.set(r.universalVoucherId, rows);
    }
    const configRates = config ? ratesFromConfig(config) : null;

    const updates = todo.map((v) => {
        const settlement = readSettlement(v.settlementJson);
        const promo = derivePromoSnapshot(settlement, v.discountPct, ledgerBySpine.get(v.universalVoucherId ?? -1) ?? [], configRates);
        return { id: v.id, no: v.universalVoucher?.voucherNo ?? `#${v.id}`, promo, json: buildSettlementJson(settlement.tenders, settlement.charges, promo) };
    });

    for (const u of updates.slice(0, 10)) {
        const p = u.promo;
        console.log(`  ${u.no}: tier ${p.tierDiscountPct}% · points before ${p.availablePointsBeforeSale} · loyalty ${p.loyaltyRates ? `on @ ₹${p.loyaltyRates.redeemValue}/pt` : "off"}${p.couponCode ? ` · coupon ${p.couponCode}` : ""}`);
    }
    if (updates.length > 10) console.log(`  … and ${updates.length - 10} more`);

    if (!APPLY) {
        console.log("\nDry run — nothing written. Re-run with --apply.\n");
        return;
    }
    for (let i = 0; i < updates.length; i += CHUNK) {
        await prisma.$transaction(updates.slice(i, i + CHUNK).map((u) =>
            prisma.voucherDetail.update({ where: { id: u.id }, data: { settlementJson: u.json } })));
    }
    console.log(`\nRecorded ${updates.length} snapshot(s).\n`);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error("Backfill failed:", e);
        process.exit(1);
    });
