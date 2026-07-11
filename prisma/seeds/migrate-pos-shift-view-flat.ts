/**
 * One-shot, data-preserving migration: collapse the POS shift-view permission
 * family to a single flat id (radius is always branch; the :org scope is retired).
 *
 *   pos:shift:view:branch  ─┐
 *   pos:shift:view:org     ─┴─►  pos:shift:view
 *
 * Remaps every RolePermission + DepartmentPermission grant onto the flat id
 * (de-duplicating where a role/dept held both), then deletes the two dead
 * Permission rows. Cross-branch ("all branches") view is now admin-only, so the
 * old :org grant carries no extra power — dropping it loses nothing for holders.
 *
 * Safe to re-run (idempotent). Does NOT delete or reset any other data.
 *
 * Run: pnpm tsx prisma/seeds/migrate-pos-shift-view-flat.ts
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

const FLAT = "pos:shift:view";
const OLD = ["pos:shift:view:branch", "pos:shift:view:org"];

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Ensure the flat Permission row exists (matches bootstrap-seed).
    await client.query(
      `INSERT INTO "Permission" (id, label, module, description)
       VALUES ($1, 'View POS shifts', 'pos',
               'View the shift report and counter board for the user''s branch (cross-branch view is admin-only).')
       ON CONFLICT (id) DO NOTHING`,
      [FLAT],
    );

    // 2. Remap grants onto the flat id, skipping rows that would collide with an
    //    existing flat grant (a role/dept that already holds both scopes).
    for (const table of ["RolePermission", "DepartmentPermission"] as const) {
      const fk = table === "RolePermission" ? "roleId" : "departmentId";
      const { rowCount: moved } = await client.query(
        `UPDATE "${table}" t
            SET "permissionId" = $1
          WHERE t."permissionId" = ANY($2::text[])
            AND NOT EXISTS (
              SELECT 1 FROM "${table}" x
               WHERE x."${fk}" = t."${fk}" AND x."permissionId" = $1
            )`,
        [FLAT, OLD],
      );
      // 3. Drop any leftover old-scope grants (their flat equivalent already exists).
      const { rowCount: dropped } = await client.query(
        `DELETE FROM "${table}" WHERE "permissionId" = ANY($1::text[])`,
        [OLD],
      );
      console.log(`  ${table}: remapped ${moved ?? 0}, removed ${dropped ?? 0} duplicate(s)`);
    }

    // 4. Delete the two dead Permission rows.
    const { rowCount: perms } = await client.query(
      `DELETE FROM "Permission" WHERE id = ANY($1::text[])`,
      [OLD],
    );
    console.log(`  Permission: deleted ${perms ?? 0} dead row(s)`);

    await client.query("COMMIT");
    console.log("\n✓ pos:shift:view collapsed to flat.\n");
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
