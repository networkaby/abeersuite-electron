-- Whole-drawer cashier handover (2026-09-24).
--
-- A handover no longer names the next cashier or keeps a carry-over float: A
-- counts the drawer and signs out, and whoever signs in next at that counter sees
-- it and takes the whole drawer. So:
--
--   * "toUserId" is empty until somebody accepts — it records who took over, not
--     who was asked to.
--   * "declaredByAPaise" is empty when A signed out without counting at all; the
--     row is then written at takeover, straight as ACCEPTED, as the audit trail.
--   * "denominationsJson" keeps A's note/coin tally so B can check it against the
--     drawer: { "lines": [{ "denom": 500, "count": 3 }], "otherPaise": 0 }.
--
-- Existing rows keep every value; "countedByBPaise" and "carryOverPaise" stay for
-- them and are simply no longer written. The FK on "toUserId" is unchanged
-- (ON DELETE RESTRICT is declared explicitly in the schema to keep it so).

-- AlterTable
ALTER TABLE "pos_handovers" ADD COLUMN     "denominationsJson" JSONB,
ALTER COLUMN "toUserId" DROP NOT NULL,
ALTER COLUMN "declaredByAPaise" DROP NOT NULL;
