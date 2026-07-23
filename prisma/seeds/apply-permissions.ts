/**
 * Incremental permission applier — adds new Permission rows to the DB and grants
 * them to R1 (Admin) WITHOUT running the full bootstrap seed.
 *
 * Why: `pnpm prisma db seed` re-touches all master data (roles, permissions,
 * pipelines, statuses, workers, ledgers, …) and prunes — expensive and risky on
 * the live production DB. When a change only ADDS a few permissions, that whole
 * pass is wasteful. This script upserts just the rows in ADDITIONS and grants the
 * non-systemOnly ones to R1 — idempotent, no prune, nothing else touched.
 *
 * Workflow for adding a permission:
 *   1. Add it to `src/shared/lib/constants/permissions.ts` (the PERMISSIONS const)
 *      AND `prisma/seeds/lib/codeOwnedCatalog.ts` (the shared catalog both
 *      bootstraps import) — the catalog stays the source of truth for a reseed.
 *   2. Mirror the same rows into ADDITIONS below.
 *   3. Run `pnpm seed:apply-permissions`.
 *      (Or simply run `pnpm prisma db seed` — the personal bootstrap now applies
 *      the whole catalog non-destructively; this script remains as the minimal
 *      "just these rows" alternative.)
 * After the change ships and the DB is applied, ADDITIONS may be cleared (it is a
 * scratchpad, not a record — the seed is the record).
 */
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

// The permissions to add for the CURRENT change. Keep these identical to the rows
// added in bootstrap-seed.ts. `systemOnly` rows are upserted but NOT granted to R1.
const ADDITIONS: { id: string; label: string; module: string; description: string; systemOnly?: boolean }[] = [
    { id: "ui:sidebar:bi:bill-profit", label: "Business Intelligence → Bill Profit", module: "ui", description: "Show the \"Bill Profit\" link under Business Intelligence in the sidebar." },
    { id: "ui:sidebar:bi:party-sale-purchase", label: "Business Intelligence → Party Sale & Purchase", module: "ui", description: "Show the \"Party Sale & Purchase\" link under Business Intelligence in the sidebar." },
    { id: "ui:sidebar:bi:item-by-party", label: "Business Intelligence → Item by Party", module: "ui", description: "Show the \"Item by Party\" link under Business Intelligence in the sidebar." },
];

const ADMIN_ROLE_ID = "R1";

async function main() {
    const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
        .replace(/[?&]sslmode=[^&]*/g, "")
        .replace(/[?&]$/, "");
    if (!rawUrl) throw new Error("No DIRECT_URL / DATABASE_URL in env");

    const pool = new Pool({
        connectionString: rawUrl,
        ssl: /@(localhost|127\.0\.0\.1)/.test(rawUrl) ? false : { rejectUnauthorized: false },
        max: 5,
    });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

    try {
        for (const p of ADDITIONS) {
            await prisma.permission.upsert({
                where: { id: p.id },
                update: { label: p.label, module: p.module, description: p.description },
                create: p,
            });
        }

        // Grant the non-systemOnly additions to R1 (Admin), matching the seed's rule.
        const grants = ADDITIONS.filter((p) => !p.systemOnly).map((p) => ({ roleId: ADMIN_ROLE_ID, permissionId: p.id }));
        const { count } = await prisma.rolePermission.createMany({ data: grants, skipDuplicates: true });

        console.log(`✓ Applied ${ADDITIONS.length} permission(s); granted ${count} new to ${ADMIN_ROLE_ID}.`);
    } finally {
        await pool.end();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
