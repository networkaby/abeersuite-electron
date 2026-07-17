/**
 * One-shot, data-preserving migration: adopt pre-period spend-tier levels onto a
 * CustomerTierPeriod.
 *
 * Spend tiers used to be a single flat ladder matched on LIFETIME spend. They are now
 * grouped under CustomerTierPeriod — a title ("Best of the month") plus the rolling
 * window its spend is counted over. Levels that predate periods have periodId = NULL
 * and are inert (the POS snapshot only reads levels through their period), so this
 * script gives them a home and they keep working.
 *
 *   CustomerTier(periodId NULL) ──► CustomerTier(periodId = the existing/created period)
 *
 * Your existing levels are NOT edited — names, amounts, percentages, enabled flags and
 * order are all left exactly as they are. The only columns written are periodId and the
 * updatedAt stamp.
 *
 * Adopts onto the lowest-sortOrder period if one already exists; otherwise creates
 * "Best of 6 months" (180 days), which matches the window tiers effectively had before.
 * Rename it afterwards on /office/customer-retention/customer-tiers.
 *
 * Safe to re-run (idempotent) — a second run finds no orphans and does nothing. Does
 * NOT delete or reset any other data.
 *
 * TEMPORARY: delete this script once production has been migrated. It only exists to
 * carry pre-period installs across; fresh deployments get their starter period from
 * bootstrap-seed.ts instead.
 *
 * Run: pnpm tsx prisma/seeds/migrate-tier-periods.ts
 */
import pg from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
  .replace(/[?&]sslmode=[^&]*/g, "")
  .replace(/[?&]$/, "");

const pool = new pg.Pool({
  connectionString: rawUrl,
  ssl: /@(localhost|127\.0\.0\.1)/.test(rawUrl) ? false : { rejectUnauthorized: false },
});

const FALLBACK_PERIOD_NAME = "Best of 6 months";
const FALLBACK_WINDOW_DAYS = 180;

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Anything to do? Levels with no period are the only rows this touches.
    const { rows: [{ count: orphanCount }] } = await client.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM "CustomerTier" WHERE "periodId" IS NULL`,
    );
    if (Number(orphanCount) === 0) {
      console.log("  No pre-period levels found — nothing to adopt.");
      await client.query("COMMIT");
      console.log("\n✓ Already migrated.\n");
      return;
    }

    // 2. Adopt onto the existing period when there is one, so a second run (or a
    //    half-done migration) never spawns a duplicate.
    const { rows: existing } = await client.query<{ id: number; name: string }>(
      `SELECT id, name FROM "CustomerTierPeriod" ORDER BY "sortOrder" ASC, id ASC LIMIT 1`,
    );

    let periodId: number;
    let periodName: string;
    if (existing.length > 0) {
      ({ id: periodId, name: periodName } = existing[0]);
      console.log(`  Using existing period "${periodName}" (#${periodId}).`);
    } else {
      const { rows: [created] } = await client.query<{ id: number; name: string }>(
        `INSERT INTO "CustomerTierPeriod" (name, "windowDays", enabled, "sortOrder", "createdAt", "updatedAt")
         VALUES ($1, $2, true, 0, NOW(), NOW())
         RETURNING id, name`,
        [FALLBACK_PERIOD_NAME, FALLBACK_WINDOW_DAYS],
      );
      ({ id: periodId, name: periodName } = created);
      console.log(`  Created period "${periodName}" (#${periodId}, last ${FALLBACK_WINDOW_DAYS} days).`);
    }

    // 3. Point the orphans at it. Only periodId (+ the updatedAt bookkeeping stamp) is
    //    written — names, amounts, percentages, enabled and order are untouched.
    const { rowCount: adopted } = await client.query(
      `UPDATE "CustomerTier" SET "periodId" = $1, "updatedAt" = NOW() WHERE "periodId" IS NULL`,
      [periodId],
    );
    console.log(`  CustomerTier: adopted ${adopted ?? 0} level(s) onto "${periodName}".`);

    await client.query("COMMIT");
    console.log(`\n✓ Spend-tier levels adopted onto a period. Rename it at /office/customer-retention/customer-tiers.\n`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
