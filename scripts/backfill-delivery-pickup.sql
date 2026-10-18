-- Rename the retired "PICKUP" delivery carrier to STORE_PICKUP.
--
-- Why: the Delivery Board's manual "Pickup" used to save PICKUP, while the shop
-- checkout saves STORE_PICKUP for the same thing. Code now knows only
-- STORE_PICKUP, so old rows must carry it too, or their card shows the raw word
-- and the edit dialog has no carrier selected.
--
-- The parent Ticket's `updatedAt` is bumped (TicketDelivery has none) so the
-- counters' watermark pull carries the change. Only PICKUP rows are touched, so
-- a second run changes nothing.
--
-- Dry run (lists, writes nothing — ends in ROLLBACK):
--   psql "$DIRECT_URL" -f scripts/backfill-delivery-pickup.sql
-- Apply:
--   psql "$DIRECT_URL" -v apply=1 -f scripts/backfill-delivery-pickup.sql

\set ON_ERROR_STOP on
BEGIN;

\echo '— deliveries still on PICKUP —'
SELECT "ticketId", "orderSource", "orderId" FROM "TicketDelivery" WHERE carrier = 'PICKUP' ORDER BY "ticketId";

UPDATE "Ticket" t SET "updatedAt" = now() AT TIME ZONE 'UTC'
FROM "TicketDelivery" d WHERE d."ticketId" = t.id AND d.carrier = 'PICKUP';

UPDATE "TicketDelivery" SET carrier = 'STORE_PICKUP' WHERE carrier = 'PICKUP';

\echo '— left on PICKUP after this run (should be 0) —'
SELECT count(*) FROM "TicketDelivery" WHERE carrier = 'PICKUP';

\if :{?apply}
  COMMIT;
  \echo 'APPLIED.'
\else
  ROLLBACK;
  \echo 'DRY RUN — rolled back. Re-run with -v apply=1 to write.'
\endif
