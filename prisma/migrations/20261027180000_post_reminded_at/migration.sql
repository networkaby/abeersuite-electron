-- When staff were last pushed "Post due — share now" for a post, so the reminder
-- repeats every POST_REMINDER_EVERY_MIN however often the communications job is
-- rung. Nullable: existing posts were never reminded.
ALTER TABLE "Post" ADD COLUMN "lastRemindedAt" TIMESTAMP(3);
