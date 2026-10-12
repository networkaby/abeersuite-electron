-- Put every old WhatsApp message into a conversation (MessageConversation).
--
-- Why: conversations arrived with migration 20261012120000_message_conversation;
-- rows from before it carry no `conversationId`. Owner's call (2026-10-12): move
-- the old chats into the new table — every old conversation is a normal one
-- (topic NEW), no ticket is created, and existing Message.ticketId links stay as
-- they are (ticket history is untouched).
--
-- Grouping: per number, messages in time order; a gap of more than 2 hours
-- (WA_CONVERSATION_TIMEOUT_MS) starts a new conversation. Every backfilled
-- conversation is CLOSED (reason TIMEOUT, at last message + 2 h), so the
-- customer's next message opens a fresh one and gets the menu as usual.
--
-- Only rows with a phone and no conversationId are touched, so a second run
-- changes nothing. `updatedAt` is set so the counters' watermark pull carries it.
-- Needs the migration applied first (the d_office deploy on live).
--
-- Dry run (counts, writes nothing — ends in ROLLBACK):
--   psql "$DIRECT_URL" -f scripts/backfill-message-conversations.sql
-- Apply:
--   psql "$DIRECT_URL" -v apply=1 -f scripts/backfill-message-conversations.sql

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE _m AS
SELECT id, phone, "occurredAt",
       CASE WHEN lag("occurredAt") OVER w IS NULL
              OR "occurredAt" - lag("occurredAt") OVER w > interval '2 hours'
            THEN 1 ELSE 0 END AS starts
FROM "Message"
WHERE phone IS NOT NULL AND "conversationId" IS NULL
WINDOW w AS (PARTITION BY phone ORDER BY "occurredAt", id);

CREATE TEMP TABLE _g AS
SELECT id, phone, "occurredAt",
       sum(starts) OVER (PARTITION BY phone ORDER BY "occurredAt", id) AS grp
FROM _m;

-- One row per conversation, with its id taken from the table's own sequence.
CREATE TEMP TABLE _c AS
SELECT nextval(pg_get_serial_sequence('"MessageConversation"', 'id'))::int AS cid,
       phone, grp, min("occurredAt") AS s, max("occurredAt") AS e, count(*) AS n
FROM _g GROUP BY phone, grp;

\echo '— to backfill —'
SELECT count(DISTINCT phone) AS numbers, count(*) AS conversations, coalesce(sum(n), 0) AS messages FROM _c;

INSERT INTO "MessageConversation"
    (id, phone, topic, "startedAt", "lastMessageAt", "closedAt", "closedReason", "createdAt", "updatedAt")
SELECT cid, phone, 'NEW', s, e, e + interval '2 hours', 'TIMEOUT', now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC'
FROM _c;

UPDATE "Message" m SET "conversationId" = c.cid, "updatedAt" = now() AT TIME ZONE 'UTC'
FROM _g g JOIN _c c ON c.phone = g.phone AND c.grp = g.grp
WHERE m.id = g.id AND m."conversationId" IS NULL;

\echo '— messages with a phone still outside a conversation after this run —'
SELECT count(*) FROM "Message" WHERE phone IS NOT NULL AND "conversationId" IS NULL;

\if :{?apply}
  COMMIT;
  \echo 'APPLIED.'
\else
  ROLLBACK;
  \echo 'DRY RUN — rolled back. Re-run with -v apply=1 to write.'
\endif
