-- How long THIS person may be away before being signed out, and before the gap
-- stops counting as duty.
--
-- Owner, 2026-09-22: a counter manager has to be at the till all the time, a
-- technician does not. One global limit could only ever be wrong for one of
-- them — short enough to catch an absent cashier would dock a technician with
-- his head in a machine.
--
-- Null means the default (45 minutes). A separate migration from
-- 20260922100000_hr_duty_time because that one is already applied to live and
-- an applied migration is frozen (AGENTS.md section 3).

ALTER TABLE "staff_profiles" ADD COLUMN "idleLimitMinutes" INTEGER;
