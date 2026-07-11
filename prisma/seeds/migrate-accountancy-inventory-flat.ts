/**
 * One-shot, data-preserving migration: flatten the accountancy + inventory
 * permission scopes to branch-radius flat ids (:own/:br/:branch/:org retired).
 *
 *   accountancy:view:own | :br | :org      ─►  accountancy:view
 *   inventory:view:branch | :org           ─►  inventory:view
 *   inventory:edit:branch | :org           ─►  inventory:edit
 *
 *   accountancy:create:own                 ─►  DROPPED (dead — writes run through
 *   accountancy:edit:own | :br | :org      ─►  DROPPED   the voucher matrix +
 *   accountancy:delete:own | :br | :org    ─►  DROPPED   accountancy:masters:*)
 *
 * REMAP ids are repointed onto their flat target (de-duplicating per role/dept);
 * DROP ids are removed outright. Then every dead Permission row is deleted. The
 * flat targets are created first (idempotent, matches bootstrap-seed).
 *
 * Cross-branch ("all branches") views are now admin-only, so the retired :org
 * grants carried no extra power — dropping them loses nothing for holders.
 *
 * Safe to re-run. Does NOT delete or reset any other data.
 *
 * Run: pnpm tsx prisma/seeds/migrate-accountancy-inventory-flat.ts
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

// old id → flat target id
const REMAP: Record<string, string> = {
  "accountancy:view:own": "accountancy:view",
  "accountancy:view:br":  "accountancy:view",
  "accountancy:view:org": "accountancy:view",
  "inventory:view:branch": "inventory:view",
  "inventory:view:org":    "inventory:view",
  "inventory:edit:branch": "inventory:edit",
  "inventory:edit:org":    "inventory:edit",
};

// dead ids removed outright (no flat target — enforced nothing)
const DROP = [
  "accountancy:create:own",
  "accountancy:edit:own", "accountancy:edit:br", "accountancy:edit:org",
  "accountancy:delete:own", "accountancy:delete:br", "accountancy:delete:org",
];

// flat Permission rows to ensure exist (mirrors bootstrap-seed).
const FLAT_ROWS: { id: string; label: string; description: string }[] = [
  { id: "accountancy:view", label: "View accountancy", description: "View the Accountancy module (day-book, ledgers, reports, vouchers) for the user's branch. This is the gate that shows / hides the Accountancy sidebar section." },
  { id: "inventory:view",   label: "View inventory",   description: "View vouchers, stock, and reports for the user's branch (radius is always branch; cross-branch view is admin-only)." },
  { id: "inventory:edit",   label: "Edit inventory",   description: "Create and post inventory vouchers (GRN / Challan / etc.) for the user's branch." },
];

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Ensure the flat Permission rows exist.
    for (const r of FLAT_ROWS) {
      await client.query(
        `INSERT INTO "Permission" (id, label, module, description)
         VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
        [r.id, r.label, r.id.split(":")[0], r.description],
      );
    }

    // 2. Remap grants onto the flat target, skipping rows that would collide with
    //    an existing target grant; then drop the leftover source grants.
    for (const table of ["RolePermission", "DepartmentPermission"] as const) {
      const fk = table === "RolePermission" ? "roleId" : "departmentId";
      for (const [oldId, flatId] of Object.entries(REMAP)) {
        await client.query(
          `UPDATE "${table}" t SET "permissionId" = $1
            WHERE t."permissionId" = $2
              AND NOT EXISTS (SELECT 1 FROM "${table}" x
                               WHERE x."${fk}" = t."${fk}" AND x."permissionId" = $1)`,
          [flatId, oldId],
        );
      }
      // Remove any still-remaining source grants (their flat target already exists)
      // plus every DROP grant.
      const { rowCount } = await client.query(
        `DELETE FROM "${table}" WHERE "permissionId" = ANY($1::text[])`,
        [[...Object.keys(REMAP), ...DROP]],
      );
      console.log(`  ${table}: cleaned ${rowCount ?? 0} legacy grant(s)`);
    }

    // 3. Delete every dead Permission row (remapped sources + dropped ids).
    const { rowCount: perms } = await client.query(
      `DELETE FROM "Permission" WHERE id = ANY($1::text[])`,
      [[...Object.keys(REMAP), ...DROP]],
    );
    console.log(`  Permission: deleted ${perms ?? 0} dead row(s)`);

    await client.query("COMMIT");
    console.log("\n✓ accountancy + inventory scopes flattened to branch radius.\n");
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
