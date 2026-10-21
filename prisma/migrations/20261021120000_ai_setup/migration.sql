-- AI Setup (2026-10-21): the AI keys and, per AI use + step, which keys it tries
-- in order (Settings → AI Setup; src/shared/lib/ai/aiKeys.ts). Replaces the
-- hard-coded .env chain (AI_WRITE_KEY_CHAIN), which is carried over below as
-- env-source rows so product copy keeps the keys it uses today.
--
-- RELEASE GATE: both tables sync to the counters, so every till must run the
-- build that carries them BEFORE the d_office push applies this migration
-- (AGENTS.md §3).

-- CreateTable
CREATE TABLE "ai_keys" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'gemini',
    "model" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "envName" TEXT,
    "secretEnc" TEXT,
    "keyHint" TEXT NOT NULL DEFAULT '',
    "canPhoto" BOOLEAN NOT NULL DEFAULT false,
    "canSearch" BOOLEAN NOT NULL DEFAULT false,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validTill" DATE,
    "gapSeconds" INTEGER NOT NULL DEFAULT 10,
    "dailyLimit" INTEGER,
    "limitRestSeconds" INTEGER NOT NULL DEFAULT 120,
    "failRestSeconds" INTEGER NOT NULL DEFAULT 1800,
    "timeoutSeconds" INTEGER NOT NULL DEFAULT 150,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_chain_steps" (
    "id" SERIAL NOT NULL,
    "use" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "keyId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_chain_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_chain_steps_keyId_idx" ON "ai_chain_steps"("keyId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_chain_steps_use_step_keyId_key" ON "ai_chain_steps"("use", "step", "keyId");

-- AddForeignKey
ALTER TABLE "ai_chain_steps" ADD CONSTRAINT "ai_chain_steps_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "ai_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry over today's .env chain: six free keys (10 s gap) then the paid key
-- (0 s gap, the only one that can search). A name missing from a machine's
-- .env is simply skipped there, as before.
INSERT INTO "ai_keys" ("name", "model", "source", "envName", "keyHint", "canPhoto", "canSearch", "paid", "gapSeconds", "updatedAt") VALUES
    ('Gemini free 1', 'gemini-3.8-flash', 'env', 'GOOGLE_GENERATIVE_AI_API_KEY',  'GOOGLE_GENERATIVE_AI_API_KEY',  true, false, false, 10, CURRENT_TIMESTAMP),
    ('Gemini free 2', 'gemini-3.8-flash', 'env', 'GOOGLE_GENERATIVE_AI_API_KEY1', 'GOOGLE_GENERATIVE_AI_API_KEY1', true, false, false, 10, CURRENT_TIMESTAMP),
    ('Gemini free 3', 'gemini-3.8-flash', 'env', 'GOOGLE_GENERATIVE_AI_API_KEY2', 'GOOGLE_GENERATIVE_AI_API_KEY2', true, false, false, 10, CURRENT_TIMESTAMP),
    ('Gemini free 4', 'gemini-3.8-flash', 'env', 'GOOGLE_GENERATIVE_AI_API_KEY3', 'GOOGLE_GENERATIVE_AI_API_KEY3', true, false, false, 10, CURRENT_TIMESTAMP),
    ('Gemini free 5', 'gemini-3.8-flash', 'env', 'GOOGLE_GENERATIVE_AI_API_KEY4', 'GOOGLE_GENERATIVE_AI_API_KEY4', true, false, false, 10, CURRENT_TIMESTAMP),
    ('Gemini free 6', 'gemini-3.8-flash', 'env', 'GOOGLE_GENERATIVE_AI_API_KEY5', 'GOOGLE_GENERATIVE_AI_API_KEY5', true, false, false, 10, CURRENT_TIMESTAMP),
    ('Gemini paid',   'gemini-3.8-flash', 'env', 'GOOGLE_AI_SEARCH_API_KEY',      'GOOGLE_AI_SEARCH_API_KEY',      true, true,  true,  0,  CURRENT_TIMESTAMP);

-- Draft and polish: every key in that order; search: the paid key only.
INSERT INTO "ai_chain_steps" ("use", "step", "keyId", "position")
SELECT 'product_copy', s.step, k."id", k."id"
FROM "ai_keys" k CROSS JOIN (VALUES ('draft'), ('polish')) AS s(step);
INSERT INTO "ai_chain_steps" ("use", "step", "keyId", "position")
SELECT 'product_copy', 'search', k."id", 1 FROM "ai_keys" k WHERE k."canSearch";

-- sync-touch: ai_chain_steps -> ai_keys (gen-sync-registry.ts --touch-sql)
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "ai_chain_steps";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "ai_chain_steps"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('keyId', 'ai_keys', 'id', 'updatedAt');
