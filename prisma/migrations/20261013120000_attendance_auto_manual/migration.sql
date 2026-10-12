-- Auto / manual replaces accept / reject (owner, 2026-10-13).
--
-- A day keeps both answers: the till's figures (auto, correctable on the
-- activity card) and the office's mark (manual). `source` is the toggle that
-- picks which one pays; `manualStatus` keeps the mark while the day runs on
-- auto. See shared/lib/hr/attendanceSource.ts.

-- 1. The new columns.
ALTER TABLE "attendance_days" ADD COLUMN "manualStatus" TEXT;
ALTER TABLE "attendance_days" ADD COLUMN "overrideWorkedMinutes" INTEGER;
ALTER TABLE "attendance_days" ADD COLUMN "overrideLateMinutes" INTEGER;
ALTER TABLE "attendance_days" ADD COLUMN "correctedById" INTEGER;
ALTER TABLE "attendance_days" ADD COLUMN "correctedAt" TIMESTAMP(3);

-- 2. Carry the data. Every office mark is the manual side of its day.
--    `updatedAt` moves so the counters' replicas pull the rows.
UPDATE "attendance_days"
   SET "manualStatus" = "status", "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3)
 WHERE "source" = 'OFFICE';

--    A till day that was REJECTED was paid as a normal day. Keep it that way:
--    it becomes a manual PRESENT, and the till's minutes stay underneath.
UPDATE "attendance_days"
   SET "source" = 'OFFICE', "status" = 'PRESENT', "manualStatus" = 'PRESENT',
       "markedById" = "reviewedById",
       "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3)
 WHERE "source" = 'COUNTER' AND "review" = 'REJECTED';

-- 3. Accept / reject is gone.
ALTER TABLE "attendance_days" DROP COLUMN "review";
ALTER TABLE "attendance_days" DROP COLUMN "reviewedById";
ALTER TABLE "attendance_days" DROP COLUMN "reviewedAt";
ALTER TABLE "attendance_days" DROP COLUMN "reviewedMinutes";
