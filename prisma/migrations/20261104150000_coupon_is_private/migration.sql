-- Single-use becomes Private: a coupon hidden from the POS / app / shop offer
-- lists that works only when its code is typed. Uses are capped by
-- totalUsageLimit / perCustomerLimit alone now. No coupon existed when this shipped.
ALTER TABLE "Coupon" RENAME COLUMN "singleUse" TO "isPrivate";
