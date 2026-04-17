-- Drop Prisma enum constraints, convert columns to plain TEXT.
-- Data is already in opaque-key format (S1, S2... P1... R1...) from the previous migration.
-- Validation of valid values moves to the application layer (Zod schemas).

-- Drop defaults first (they reference the enum types)
ALTER TABLE "Ticket" ALTER COLUMN "status"   DROP DEFAULT;
ALTER TABLE "Ticket" ALTER COLUMN "priority" DROP DEFAULT;
ALTER TABLE "User"   ALTER COLUMN "role"     DROP DEFAULT;

-- Convert to TEXT
ALTER TABLE "Ticket"    ALTER COLUMN "status"   TYPE TEXT USING "status"::TEXT;
ALTER TABLE "Ticket"    ALTER COLUMN "priority"  TYPE TEXT USING "priority"::TEXT;
ALTER TABLE "TicketLog" ALTER COLUMN "status"    TYPE TEXT USING "status"::TEXT;
ALTER TABLE "User"      ALTER COLUMN "role"      TYPE TEXT USING "role"::TEXT;

-- Re-apply defaults as plain strings
ALTER TABLE "Ticket" ALTER COLUMN "status"   SET DEFAULT 'S1';
ALTER TABLE "Ticket" ALTER COLUMN "priority" SET DEFAULT 'P2';
ALTER TABLE "User"   ALTER COLUMN "role"     SET DEFAULT 'R2';

DROP TYPE "Status";
DROP TYPE "Priority";
DROP TYPE "Role";
