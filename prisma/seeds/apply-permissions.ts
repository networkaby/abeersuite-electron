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
    // Help Desk module (front-desk enquiry tickets — counter + office).
    { id: "ui:sidebar:help:help-desk", label: "Help Desk → Help Desk", module: "ui", description: "Show the \"Help Desk\" link under Help Desk in the sidebar." },
    { id: "help:create", label: "Create help tickets", module: "help", description: "Log a front-desk enquiry (the New Help + quick action and the POS counter Enquiry button)." },
    { id: "help:edit", label: "Edit help tickets", module: "help", description: "Advise, move stage, close with an outcome, and convert a help ticket into a repair / deal / sale." },
    { id: "help:delete", label: "Delete help tickets", module: "help", description: "Delete a help ticket." },
    // CRM → Reconnect (customer-centric re-engagement page). Rides only its sidebar link.
    { id: "ui:sidebar:crm:reconnect", label: "CRM → Reconnect", module: "ui", description: "Show the \"Reconnect\" link under CRM in the sidebar." },
    // CRM → Call Log (raw PBX call stream + triage). Rides only its sidebar link.
    { id: "ui:sidebar:crm:call-log", label: "CRM → Call Log", module: "ui", description: "Show the \"Call Log\" link under CRM in the sidebar." },
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
