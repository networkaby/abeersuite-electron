// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CODE-OWNED CATALOG — the seed data that belongs to the CODE, not to any
// client's configuration. Used by:
//
//   • bootstrap-seed.ts   (`pnpm seed:generic`, fresh install) — the permission
//     list, the XOR checks and the portal-profile columns.
//   • sync-permissions.ts (`pnpm prisma db seed`) — the permission list.
//
// This module owns:
//   1. The Permission catalog re-export (definitions — grants live in the DB)
//   2. The Phone/Email XOR CHECK constraints (raw DDL, not data)
//   3. The portal-profile columns backfill
// Add new permissions in src/shared/lib/auth/permissionCatalog.ts (single source), never inline in either seed.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Pool } from "pg";
// The catalog itself lives in src/shared so the app can create rows on first use
// (see ensurePermissions.ts). Re-exported here so both seeds keep importing from
// this file.
export { PERMISSION_CATALOG, type PermissionSeed } from "../../../src/shared/lib/auth/permissionCatalog";

// ── XOR CHECK constraints (raw DDL) ─────────────────────────────────────────
export async function ensureXorCheck(pool: Pool, table: "Phone" | "Email", constraintName: string) {
    const { rows } = await pool.query(
        `SELECT conname FROM pg_constraint WHERE conname = $1`,
        [constraintName],
    );
    if (rows.length > 0) return;
    await pool.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${constraintName}"
         CHECK (("personId" IS NULL) <> ("companyId" IS NULL))`,
    );
}

/**
 * Portal profile columns (2026-09-07) — the data-move half of a schema change.
 *
 * `prisma db push` adds `Person.avatarUrl` and `Phone/Email.verifiedAt` and
 * DROPS `CustomerSocialProfile.avatarUrl`, so this must run BEFORE the push on
 * a DB that still has the old column: it adds the new columns itself, copies
 * every social photo onto the Person, and backfills `verifiedAt` — every
 * contact that exists today was typed in by staff who met the customer, so all
 * of them count as verified. Idempotent: every step is IF NOT EXISTS / WHERE
 * NULL, and the copy is skipped once the old column is gone.
 */
export async function ensurePortalProfileColumns(pool: Pool) {
    await pool.query(`ALTER TABLE "Person" ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT`);
    await pool.query(`ALTER TABLE "Phone"  ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP(3)`);
    await pool.query(`ALTER TABLE "Email"  ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP(3)`);

    const { rows } = await pool.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = 'CustomerSocialProfile' AND column_name = 'avatarUrl'`,
    );
    if (rows.length > 0) {
        await pool.query(
            `UPDATE "Person" p SET "avatarUrl" = s."avatarUrl"
               FROM "CustomerSocialProfile" s
              WHERE s."personId" = p.id AND s."avatarUrl" IS NOT NULL AND p."avatarUrl" IS NULL`,
        );
    }

    // Rows created before the column existed pre-date the portal's self-service
    // add, so they are staff-entered → verified as of when they were created.
    await pool.query(`UPDATE "Phone" SET "verifiedAt" = "createdAt" WHERE "verifiedAt" IS NULL`);
    await pool.query(`UPDATE "Email" SET "verifiedAt" = "createdAt" WHERE "verifiedAt" IS NULL`);
}
