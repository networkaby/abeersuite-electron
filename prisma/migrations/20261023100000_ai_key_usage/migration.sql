-- AI Setup: what each key has used (calls today / this month, last call, rest),
-- shared by every server instead of each one's memory (owner, 2026-10-23: "vercel
-- is stateless, and counter restarts every day"). Written only on the cloud DB.
--
-- RELEASE GATE: a new table syncs to the counters, so every till must run the
-- build that carries it BEFORE the d_office push applies this (AGENTS.md §3).

-- CreateTable
CREATE TABLE "ai_key_usage" (
    "keyId" INTEGER NOT NULL,
    "day" TEXT NOT NULL,
    "callsToday" INTEGER NOT NULL DEFAULT 0,
    "month" TEXT NOT NULL,
    "callsMonth" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "restUntil" TIMESTAMP(3),
    "lastOkAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_key_usage_pkey" PRIMARY KEY ("keyId")
);
