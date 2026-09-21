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

-- Office hours, "HH:MM" in shop time. They answer who is late, and their length
-- is the duty day unless dutyMinutes overrides it for an unpaid break. Held as
-- text, not time: it is a clock face on a wall, never an instant, and a `time`
-- column invites somebody to compare it against a UTC timestamp directly.
ALTER TABLE "staff_profiles" ADD COLUMN "dutyStart" VARCHAR(5);
ALTER TABLE "staff_profiles" ADD COLUMN "dutyEnd" VARCHAR(5);
