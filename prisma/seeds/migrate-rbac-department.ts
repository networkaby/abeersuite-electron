/**
 * One-shot data-preserving migration: old RBAC schema → department-homed roles.
 * Safe to re-run (idempotent checks). Does NOT delete or reset any data.
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

/** Known role → home department from bootstrap + helper-roles seeds. */
const ROLE_HOME: Record<string, string> = {
  R1: "DEP-ADMIN",
  R2: "DEP-REPAIR",
  R3: "DEP-DESK",
  R4: "DEP-DESP",
  R5: "DEP-ADMIN",
  R6: "DEP-FIN",
  R7: "DEP-SALES",
};

async function columnExists(table: string, column: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return rows.length > 0;
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── 1. Ensure all-access admin department exists (R1 home) ─────────────────
    const hasIsAllAccess = await columnExists("Department", "isAllAccess");
    if (!hasIsAllAccess) {
      console.log("+ Department.isAllAccess");
      await client.query(
        `ALTER TABLE "Department" ADD COLUMN "isAllAccess" BOOLEAN NOT NULL DEFAULT false`,
      );
    }

    await client.query(
      `INSERT INTO "Department" (id, name, description, "branchId", "isAllAccess", "createdAt")
       VALUES ('DEP-ADMIN', 'Administration', 'Org-wide administration — all-access role authoring', NULL, true, NOW())
       ON CONFLICT (id) DO UPDATE SET "isAllAccess" = true`,
    );
    console.log("✓ DEP-ADMIN ready (isAllAccess=true)");

    // ── 2. Backfill Role.departmentId ────────────────────────────────────────
    const hasDeptId = await columnExists("Role", "departmentId");
    if (!hasDeptId) {
      console.log("+ Role.departmentId (nullable, backfill, then NOT NULL)");
      await client.query(`ALTER TABLE "Role" ADD COLUMN "departmentId" TEXT`);
    }

    const { rows: roles } = await client.query<{ id: string; label: string }>(
      `SELECT id, label FROM "Role" ORDER BY id`,
    );
    const { rows: depts } = await client.query<{ id: string }>(
      `SELECT id FROM "Department"`,
    );
    const deptIds = new Set(depts.map((d) => d.id));
    const fallbackDept = deptIds.has("DEP-ADMIN")
      ? "DEP-ADMIN"
      : depts[0]?.id;

    if (!fallbackDept) {
      throw new Error("No Department rows found — cannot backfill Role.departmentId");
    }

    for (const role of roles) {
      let home = ROLE_HOME[role.id];
      if (!home || !deptIds.has(home)) {
        // Custom / renamed role (e.g. R2 "Office Staff") — pick first existing dept
        // that isn't all-access, else fallback.
        home =
          deptIds.has("DEP-OP")
            ? "DEP-OP"
            : deptIds.has("DEP-REPAIR")
              ? "DEP-REPAIR"
              : fallbackDept;
        console.log(`  ~ ${role.id} (${role.label}) → ${home} (heuristic — review in Role Matrix)`);
      } else {
        console.log(`  ~ ${role.id} (${role.label}) → ${home}`);
      }
      await client.query(
        `UPDATE "Role" SET "departmentId" = $1 WHERE id = $2 AND ("departmentId" IS NULL OR "departmentId" = '')`,
        [home, role.id],
      );
    }

    // Ensure no nulls remain
    const { rows: nulls } = await client.query(
      `SELECT id FROM "Role" WHERE "departmentId" IS NULL`,
    );
    if (nulls.length > 0) {
      throw new Error(`Role rows still missing departmentId: ${nulls.map((r: { id: string }) => r.id).join(", ")}`);
    }

    // NOT NULL + FK (skip if already enforced)
    await client.query(`ALTER TABLE "Role" ALTER COLUMN "departmentId" SET NOT NULL`);

    const { rows: fk } = await client.query(
      `SELECT 1 FROM information_schema.table_constraints
       WHERE table_schema = 'public' AND table_name = 'Role'
         AND constraint_type = 'FOREIGN KEY' AND constraint_name = 'Role_departmentId_fkey'`,
    );
    if (fk.length === 0) {
      await client.query(
        `ALTER TABLE "Role"
         ADD CONSTRAINT "Role_departmentId_fkey"
         FOREIGN KEY ("departmentId") REFERENCES "Department"(id)
         ON DELETE RESTRICT ON UPDATE CASCADE`,
      );
      console.log("✓ Role.departmentId FK added");
    }

    await client.query("COMMIT");
    console.log("\n✓ RBAC department migration complete — run: pnpm exec prisma db push");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
