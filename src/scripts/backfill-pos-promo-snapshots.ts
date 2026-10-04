// Backfill PromoSnapshot into settlementJson for POS sales.
//
// Every POS sale records its promo conditions (tier %, loyalty used/earned,
// coupons, gift cards) in `PromoSnapshot` inside `settlementJson`. Sales posted
// before this feature need their snapshot backfilled from their stored charges,
// tenders, lines, and loyalty lots so that editing them in the POS screen
// faithfully locks all rates and values.
//
// Safe to re-run: vouchers that already have `promoSnapshot` are skipped.
//
// Usage:
//   pnpm tsx src/scripts/backfill-pos-promo-snapshots.ts          # preview dry-run
//   pnpm tsx src/scripts/backfill-pos-promo-snapshots.ts --apply  # write to database

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { readSettlement, buildSettlementJson, type PromoSnapshot } from "@/shared/lib/accountancy/settlement";

const APPLY = process.argv.includes("--apply");

async function main(): Promise<void> {
    const { prisma } = await import("@/shared/lib/prisma/prismaClient");

    console.log(`\n━━━ Backfill POS PromoSnapshot ━━━ [mode: ${APPLY ? "APPLY (writes to DB)" : "DRY RUN (preview only)"}]\n`);

    const vouchers = await prisma.voucherDetail.findMany({
        where: {
            universalVoucher: { type: "POS" },
        },
        select: {
            id: true,
            universalVoucherId: true,
            discountPct: true,
            discountAmt: true,
            totalAmount: true,
            settlementJson: true,
            universalVoucher: {
                select: {
                    voucherNo: true,
                    date: true,
                },
            },
        },
        orderBy: { id: "asc" },
    });

    console.log(`Found ${vouchers.length} POS vouchers in total.\n`);

    let alreadySnapshotted = 0;
    let needsBackfill = 0;
    const updates: Array<{ id: number; ref: string; total: string; promo: PromoSnapshot; newJson: ReturnType<typeof buildSettlementJson> }> = [];

    for (const v of vouchers) {
        const settlement = readSettlement(v.settlementJson);
        if (settlement.promoSnapshot != null) {
            alreadySnapshotted++;
            continue;
        }

        needsBackfill++;
        const fallbackGiftCard = settlement.tenders.find((t) => t.reference?.startsWith("Gift card"));
        const fallbackLoyaltyCharge = settlement.charges.find((c) => c.description?.startsWith("Loyalty:"));
        const fallbackCouponCharge = settlement.charges.find((c) => c.description?.startsWith("Coupon:"));

        const earnedLot = v.universalVoucherId != null
            ? await prisma.loyaltyLot.findFirst({
                where: { universalVoucherId: v.universalVoucherId },
                select: { pointsEarned: true },
            })
            : null;

        const promo: PromoSnapshot = {
            tierDiscountPct: v.discountPct != null ? Number(v.discountPct) : 0,
            availablePointsBeforeSale: 0,
            pointsRedeemed: fallbackLoyaltyCharge ? Math.abs(Math.round(Number(fallbackLoyaltyCharge.amount))) : 0,
            pointsEarned: earnedLot?.pointsEarned ?? 0,
            loyaltyRates: null,
            giftCardUsedAmount: fallbackGiftCard ? Number(fallbackGiftCard.amount) : 0,
            couponCode: fallbackCouponCharge ? (fallbackCouponCharge.description?.replace(/^Coupon:\s*/, "") || "auto") : null,
            couponDiscountAmt: fallbackCouponCharge ? Math.abs(Number(fallbackCouponCharge.amount)) : 0,
        };

        const newJson = buildSettlementJson(settlement.tenders, settlement.charges, promo);
        updates.push({
            id: v.id,
            ref: v.universalVoucher?.voucherNo ?? `ID-${v.id}`,
            total: String(v.totalAmount),
            promo,
            newJson,
        });
    }

    console.log(`Summary:`);
    console.log(`  - Already have promoSnapshot: ${alreadySnapshotted}`);
    console.log(`  - Need backfill:             ${needsBackfill}\n`);

    if (updates.length > 0) {
        console.log(`Vouchers to backfill (first 10 samples):`);
        for (const u of updates.slice(0, 10)) {
            console.log(`  Voucher #${u.id} (${u.ref}) Total: ₹${u.total}`);
            console.log(`    tierDiscountPct: ${u.promo.tierDiscountPct}%`);
            if (u.promo.couponCode || (u.promo.couponDiscountAmt ?? 0) > 0) {
                console.log(`    coupon: ${u.promo.couponCode} (-₹${u.promo.couponDiscountAmt})`);
            }
            if ((u.promo.pointsRedeemed ?? 0) > 0) {
                console.log(`    loyalty points redeemed: ${u.promo.pointsRedeemed}`);
            }
            if ((u.promo.pointsEarned ?? 0) > 0) {
                console.log(`    loyalty points earned: ${u.promo.pointsEarned}`);
            }
            if ((u.promo.giftCardUsedAmount ?? 0) > 0) {
                console.log(`    gift card used: ₹${u.promo.giftCardUsedAmount}`);
            }
        }
        if (updates.length > 10) {
            console.log(`  ... and ${updates.length - 10} more.`);
        }

        // Specifically show voucher 2457 if present in updates
        const v2457 = updates.find((u) => u.id === 2457);
        if (v2457) {
            console.log(`\n  Target Voucher #2457 detail:`);
            console.log(`    Ref: ${v2457.ref}, Total: ₹${v2457.total}`);
            console.log(`    PromoSnapshot:`, JSON.stringify(v2457.promo));
        }
    }

    if (!APPLY) {
        console.log(`\nDRY RUN complete. No changes written. Run with --apply to commit to DB.\n`);
        return;
    }

    console.log(`\nWriting backfill to database...`);
    let written = 0;
    for (const u of updates) {
        await prisma.voucherDetail.update({
            where: { id: u.id },
            data: { settlementJson: u.newJson },
        });
        written++;
    }

    console.log(`Successfully backfilled ${written} vouchers.\n`);
}

main().catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
});
