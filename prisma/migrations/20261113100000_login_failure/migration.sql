-- Security review (2026-11-13): wrong sign-in / OTP / PIN guesses counted in the
-- database, so the limit holds across every Vercel instance. Rows are short-lived
-- (15-minute window) and pruned by the app; nothing to carry over.
CREATE TABLE "LoginFailure" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginFailure_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoginFailure_key_createdAt_idx" ON "LoginFailure"("key", "createdAt");

CREATE INDEX "LoginFailure_createdAt_idx" ON "LoginFailure"("createdAt");
