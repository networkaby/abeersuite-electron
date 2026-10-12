-- The owner's Accept / Reject on a day the till measured (Employee Activity →
-- day review). Nullable and default-free, so every existing row reads as
-- "waiting" and nothing about anybody's pay changes until a day is decided.
ALTER TABLE "attendance_days" ADD COLUMN "review" TEXT;
ALTER TABLE "attendance_days" ADD COLUMN "reviewedById" INTEGER;
ALTER TABLE "attendance_days" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "attendance_days" ADD COLUMN "reviewedMinutes" INTEGER;
