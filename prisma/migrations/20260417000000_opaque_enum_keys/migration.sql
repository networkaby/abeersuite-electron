-- Rename Status enum values to opaque keys.
-- ALTER TYPE RENAME VALUE is safe: PostgreSQL updates all existing rows automatically.
ALTER TYPE "Status" RENAME VALUE 'RECEIVED'      TO 'S1';
ALTER TYPE "Status" RENAME VALUE 'DIAGNOSING'    TO 'S2';
ALTER TYPE "Status" RENAME VALUE 'REPAIRING'     TO 'S3';
ALTER TYPE "Status" RENAME VALUE 'ESCALATED'     TO 'S4';
ALTER TYPE "Status" RENAME VALUE 'RECEIVED_BACK' TO 'S5';
ALTER TYPE "Status" RENAME VALUE 'READY'         TO 'S6';
ALTER TYPE "Status" RENAME VALUE 'RETURNED'      TO 'S7';

-- Rename Priority enum values
ALTER TYPE "Priority" RENAME VALUE 'LOW'    TO 'P1';
ALTER TYPE "Priority" RENAME VALUE 'NORMAL' TO 'P2';
ALTER TYPE "Priority" RENAME VALUE 'HIGH'   TO 'P3';
ALTER TYPE "Priority" RENAME VALUE 'URGENT' TO 'P4';

-- Rename Role enum values
ALTER TYPE "Role" RENAME VALUE 'ADMIN'      TO 'R1';
ALTER TYPE "Role" RENAME VALUE 'TECHNICIAN' TO 'R2';
ALTER TYPE "Role" RENAME VALUE 'FRONT_DESK' TO 'R3';
