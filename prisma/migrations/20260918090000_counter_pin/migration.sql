-- Counter PIN — a 6-digit way back in, valid on ONE counter.
--
-- One row per person per counter. The per-counter key IS the security model:
-- every till holds a replica of this table, so a PIN that worked everywhere would
-- turn one stolen counter PC into a key to every counter.
--
-- lastPasswordAt / lastLoginAt are the two clocks that stop a PIN replacing the
-- password for good — 10 days since the last password, or 3 idle days, and the
-- sign-in screen asks for the password again. The counter stamps them itself, so
-- the rule still holds with the line down.

CREATE TABLE "user_counter_pins" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "counterId" INTEGER NOT NULL,
    "pinHash" TEXT NOT NULL,
    "lastPasswordAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_counter_pins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_counter_pins_userId_counterId_key" ON "user_counter_pins"("userId", "counterId");
CREATE INDEX "user_counter_pins_counterId_idx" ON "user_counter_pins"("counterId");

-- Cascade both ways: a deleted user or a deleted counter leaves no PIN behind.
ALTER TABLE "user_counter_pins" ADD CONSTRAINT "user_counter_pins_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_counter_pins" ADD CONSTRAINT "user_counter_pins_counterId_fkey"
    FOREIGN KEY ("counterId") REFERENCES "pos_counters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
