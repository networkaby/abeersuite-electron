-- Own discount caps, each a % of bill goods, applied before the combined
-- maxTotalDiscountPct (coupon + tier + loyalty together). null = no own cap.
ALTER TABLE "CouponConfig" ADD COLUMN "maxCouponDiscountPct" DECIMAL(5,2);
ALTER TABLE "CouponConfig" ADD COLUMN "maxTierDiscountPct" DECIMAL(5,2);
