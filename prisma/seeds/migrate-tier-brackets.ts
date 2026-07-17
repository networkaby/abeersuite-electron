/**
 * One-shot, data-preserving migration: lay the tiled brackets onto the existing
 * spend-tier periods after `windowDays` is replaced by `fromDay`/`toDay`.
 *
 * Periods used to carry a single `windowDays` — a window from today back N days. Windows
 * all ended at today, so they nested (spend(30d) <= spend(365d)) and every short title
 * came free with every longer one. Periods now carry a BRACKET instead: a slice of the
 * past, `fromDay <= age < toDay`. Tiled brackets partition spend, so each sale feeds
 * exactly one period.
 *
 *   Month       windowDays 30    ──►  0-30
 *   Quarter     windowDays 90    ──►  30-90
 *   Half Yearly windowDays 180   ──►  90-180
 *   Yearly      windowDays 365   ──►  180-365
 *   Life        windowDays 1095  ──►  365-1095
 *
 * Each period starts where the previous one ended, so the old lengths are preserved as a
 * clean tiling with no gap and no overlap. The values below were captured from the live
 * rows BEFORE the `windowDays` column was dropped — that column is gone by the time this
 * runs, so they cannot be re-derived.
 *
 * Only fromDay/toDay are written. Names, levels, amounts, percentages, enabled flags and
 * order are untouched.
 *
 * Safe to re-run (idempotent): it only writes a period still sitting at the 0/180 default,
 * so an admin who has already tuned their brackets never gets clobbered.
 *
 * TEMPORARY: delete once production has been migrated. Fresh deployments get their
 * starter period straight from bootstrap-seed.ts.
 *
 * Run AFTER: npx prisma db push --accept-data-loss
 * Run: pnpm tsx prisma/seeds/migrate-tier-brackets.ts
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

/** Captured from the live rows on 2026-07-17, keyed by id and checked against name. */
const TILES: Array<{ id: number; name: string; fromDay: number; toDay: number }> = [
  { id: 2, name: "Month",       fromDay: 0,   toDay: 30 },
  { id: 3, name: "Quarter",     fromDay: 30,  toDay: 90 },
  { id: 4, name: "Half Yearly", fromDay: 90,  toDay: 180 },
  { id: 5, name: "Yearly",      fromDay: 180, toDay: 365 },
  { id: 6, name: "Life",        fromDay: 365, toDay: 1095 },
];

// The @default landing zone a period sits in until someone sets a real bracket.
const DEFAULT_FROM = 0;
const DEFAULT_TO = 180;

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const t of TILES) {
      // Match on id AND name — if this database isn't the one the tiles were captured
      // from, the name won't line up and the row is left alone rather than mangled.
      const { rowCount } = await client.query(
        `UPDATE "CustomerTierPeriod"
            SET "fromDay" = $1, "toDay" = $2, "updatedAt" = NOW()
          WHERE id = $3 AND name = $4
            AND "fromDay" = $5 AND "toDay" = $6`,
        [t.fromDay, t.toDay, t.id, t.name, DEFAULT_FROM, DEFAULT_TO],
      );
      console.log(
        rowCount
          ? `  ✓ ${t.name} (#${t.id}) → days ${t.fromDay}-${t.toDay}`
          : `  • ${t.name} (#${t.id}) skipped — already set, renamed, or missing`,
      );
    }

    await client.query("COMMIT");

    const { rows } = await client.query<{ name: string; fromDay: number; toDay: number }>(
      `SELECT name, "fromDay", "toDay" FROM "CustomerTierPeriod" ORDER BY "fromDay" ASC`,
    );
    console.log("\nBrackets now:");
    for (const r of rows) console.log(`  ${r.name.padEnd(12)} ${r.fromDay}-${r.toDay} days ago`);
    console.log("\n✓ Tiled brackets laid.\n");
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
