-- Account.balance was a running cache of each ledger's posted GL lines. Every
-- screen, report and the credit check sum the ledger itself (closingForAccounts)
-- since 2026-10-12, and the writers that kept the cache are gone, so the column
-- goes too. Nothing is carried: the ledger is the figure.
--
-- Old counter replicas keep their copy (NOT NULL DEFAULT 0, harmless); push only
-- sends the columns the office has.
ALTER TABLE "Account" DROP COLUMN "balance";
