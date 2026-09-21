-- Duty time: measure the day actually worked, and grade it.
--
-- `lastSeenAt` is the last real sign of life (a click or a keypress, never a
-- background poll); `workedMinutes` accumulates the gaps between those signs,
-- skipping any gap longer than the idle-logout limit. An idle stretch therefore
-- adds nothing, which is the whole rule: time away from the counter is not duty,
-- whether or not the auto-logout managed to fire.
--
-- `dutyMinutes` is per person, null meaning the org default. A part-timer's full
-- day is shorter than a counter hand's, and a fixed hour rule would mis-grade it.

ALTER TABLE "attendance_days" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
ALTER TABLE "attendance_days" ADD COLUMN "workedMinutes" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "staff_profiles" ADD COLUMN "dutyMinutes" INTEGER;
