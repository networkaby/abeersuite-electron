-- Each counter signs in at the office with its own key (owner, 2026-10-13).
-- Replaces the office AUTH_SECRET that v_live installers used to carry; see
-- shared/lib/counter/relayKey.ts. Hashes only. No data to carry.
ALTER TABLE "pos_counters" ADD COLUMN "relayKeyHash" TEXT;
ALTER TABLE "pos_counters" ADD COLUMN "relayKeyPrevHash" TEXT;
ALTER TABLE "pos_counters" ADD COLUMN "relayKeyIssuedAt" TIMESTAMP(3);
ALTER TABLE "pos_counters" ADD COLUMN "relayKeyRevokedAt" TIMESTAMP(3);
