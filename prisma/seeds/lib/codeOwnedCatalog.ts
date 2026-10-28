// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CODE-OWNED CATALOG — the seed data that belongs to the CODE, not to any
// client's configuration. Shared by BOTH seeds:
//
//   • bootstrap-seed.ts   (generic new-client installer) — imports the
//     permission list and seeds it alongside its generic demo world.
//   • catalog-seed.ts     (`pnpm prisma db seed`) — calls
//     `applyCodeOwnedCatalog()` so any DB gets what the code owns, without
//     touching config.
//
// This module owns:
//   1. The Permission catalog (definitions — grants live in the DB)
//   2. VoucherSeries + BooksConfig (voucher numbering; seedVoucherSeries)
//   3. The Phone/Email XOR CHECK constraints (raw DDL, not data)
//   4. The EXISTENCE of the BackupConfig row. The schedule inside it is the
//      owner's config — but "a row is there at all" is an invariant the code
//      must guarantee, because a missing row means no backups and says nothing
//      about it. Created here with the schema defaults.
// Add new permissions in src/shared/lib/auth/permissionCatalog.ts (single source), never inline in either seed.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { PrismaClient } from "../../../src/generated/prisma/client";
import type { Pool } from "pg";
import { seedVoucherSeries } from "../../../src/modules/accountancy/lib/seedVoucherSeries";
// The catalog itself lives in src/shared so the app can create rows on first use
// (see ensurePermissions.ts). Re-exported here so both seeds keep importing from
// this file.
import { PERMISSION_CATALOG } from "../../../src/shared/lib/auth/permissionCatalog";
export { PERMISSION_CATALOG, type PermissionSeed } from "../../../src/shared/lib/auth/permissionCatalog";

// ── XOR CHECK constraints (raw DDL — cannot live in the snapshot) ──────────
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

/**
 * Apply everything code-owned to the DB: permission catalog (upsert + prune of
 * retired ids, keeping Work/WorkGroup-referenced ones), the Phone/Email XOR
 * constraints, and the voucher numbering series. Idempotent; deletes ONLY
 * permissions that no longer exist in code. Used by catalog-seed so it
 * never needs the generic installer.
 */
export async function applyCodeOwnedCatalog(prisma: PrismaClient, pool: Pool): Promise<{ permissions: number; pruned: number }> {
    for (const p of PERMISSION_CATALOG) {
        await prisma.permission.upsert({
            where: { id: p.id },
            update: { label: p.label, module: p.module, description: p.description },
            create: p,
        });
    }

    // Prune retired permission ids — same rule as the generic installer: keep
    // everything in the catalog plus any id referenced by a Work / WorkGroup.
    const keepIds = new Set(PERMISSION_CATALOG.map((p) => p.id));
    const workRefs = await prisma.$queryRaw<{ permissionId: string }[]>`
        SELECT "permissionId" FROM "Work"      WHERE "permissionId" IS NOT NULL
        UNION
        SELECT "permissionId" FROM "WorkGroup" WHERE "permissionId" IS NOT NULL`;
    for (const r of workRefs) keepIds.add(r.permissionId);
    const pruned = await prisma.permission.deleteMany({ where: { id: { notIn: [...keepIds] } } });

    await ensureXorCheck(pool, "Phone", "Phone_owner_xor");
    await ensureXorCheck(pool, "Email", "Email_owner_xor");
    await ensurePortalProfileColumns(pool);

    await seedVoucherSeries(prisma);

    // The scheduled-backup row must EXIST from the first boot — `/api/cron/backup-due`
    // reads it hourly, and no row means no backup, silently, which nobody discovers
    // until the day they need one. Its existence is a code-owned invariant even though
    // the schedule inside it is the owner's config: this runs in Step 1 of
    // catalog-seed, so a fresh DB is covered.
    //
    // Create-only. The schema defaults (every weekday, hour 22 — daily 10 PM IST) are
    // the safe-not-clever fallback; an admin's edit from Settings → Backup & Restore
    // is never overwritten, and the snapshot overlay re-asserts their real schedule
    // moments later in Step 2.
    await prisma.backupConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });

    return { permissions: PERMISSION_CATALOG.length, pruned: pruned.count };
}
