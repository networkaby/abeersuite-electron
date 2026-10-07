-- Due reminders: skip a party still well inside its credit limit (0 = off).
ALTER TABLE "DueReminderSettings" ADD COLUMN "minPctAutoLimit" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DueReminderSettings" ADD COLUMN "minPctCreditLimit" INTEGER NOT NULL DEFAULT 0;
