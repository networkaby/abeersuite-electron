/**
 * One-shot data-preserving migration: Position.roleTemplateId → PositionRole M2M.
 * Run before `pnpm exec prisma db push` when upgrading from the single-role column.
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

async function columnExists(table: string, column: string): Promise<boolean> {
    const { rows } = await pool.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
        [table, column],
    );
    return rows.length > 0;
}

async function tableExists(table: string): Promise<boolean> {
    const { rows } = await pool.query(`SELECT to_regclass($1) AS tbl`, [`public."${table}"`]);
    return rows[0]?.tbl != null;
}

async function main() {
    const hasJoin = await tableExists("PositionRole");
    const hasLegacyCol = await columnExists("Position", "roleTemplateId");

    if (!hasLegacyCol) {
        console.log("✓ Position.roleTemplateId already removed — nothing to migrate");
        await pool.end();
        return;
    }

    if (!hasJoin) {
        console.log("+ Creating PositionRole table (run db push if this fails)");
        await pool.query(`
            CREATE TABLE IF NOT EXISTS "PositionRole" (
                "positionId" TEXT NOT NULL,
                "roleId"     TEXT NOT NULL,
                CONSTRAINT "PositionRole_pkey" PRIMARY KEY ("positionId", "roleId"),
                CONSTRAINT "PositionRole_positionId_fkey"
                    FOREIGN KEY ("positionId") REFERENCES "Position"(id) ON DELETE CASCADE ON UPDATE CASCADE,
                CONSTRAINT "PositionRole_roleId_fkey"
                    FOREIGN KEY ("roleId") REFERENCES "Role"(id) ON DELETE RESTRICT ON UPDATE CASCADE
            )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS "PositionRole_roleId_idx" ON "PositionRole"("roleId")`);
    }

    const { rowCount } = await pool.query(`
        INSERT INTO "PositionRole" ("positionId", "roleId")
        SELECT id, "roleTemplateId"
        FROM "Position"
        WHERE "roleTemplateId" IS NOT NULL
        ON CONFLICT ("positionId", "roleId") DO NOTHING
    `);
    console.log(`✓ Migrated ${rowCount ?? 0} position→role link(s) into PositionRole`);
    console.log("  Next: pnpm exec prisma db push");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => pool.end());
