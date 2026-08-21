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
    // Login location control — when granted, the user may log in from any machine.
    // Without it, login is restricted to counter machines (bridge-present).
    {
        id: "auth:login:outside-counter",
        label: "Can login outside counter",
        module: "core",
        description: "Allow login from a non-counter machine (without bridge).",
    },
    // Recurring Tasks nav link (Administration). Derived automatically by
    // sidebarPermissionSeeds() from the MODULE_SECTIONS child in utils/constants.ts —
    // the row below just mirrors it so an existing DB gets it without a full seed.
    // No tasks:* additions: a recurrence is a task definition and reuses
    // tasks:create / tasks:edit / tasks:delete.
    {
        id: "ui:sidebar:administration:recurring-tasks",
        label: "Administration → Recurring Tasks",
        module: "ui",
        description: 'Show the "Recurring Tasks" link under Administration in the sidebar.',
    },
    // Usable Fund nav link (Accountancy) — design-preview page, mock data only.
    // Derived automatically by sidebarPermissionSeeds() from the MODULE_SECTIONS
    // child in utils/constants.ts; mirrored here so an existing DB gets it without
    // a full seed.
    {
        id: "ui:sidebar:accountancy:usable-fund",
        label: "Accountancy → Usable Fund",
        module: "ui",
        description: 'Show the "Usable Fund" link under Accountancy in the sidebar.',
    },
    // E-Commerce → Masters nav link (storefront presentation editor for
    // Group/Category/Brand — slug/image/description). Derived automatically by
    // sidebarPermissionSeeds() from the MODULE_SECTIONS child in utils/constants.ts;
    // mirrored here so an existing DB gets it without a full seed.
    {
        id: "ui:sidebar:e-commerce:masters",
        label: "E-Commerce → Masters",
        module: "ui",
        description: 'Show the "Masters" link under E-Commerce in the sidebar.',
    },
    // E-Commerce → Customize Home nav link (on/off + reorder for the storefront
    // home page's existing sections). Derived automatically by
    // sidebarPermissionSeeds() from the MODULE_SECTIONS child in utils/constants.ts;
    // mirrored here so an existing DB gets it without a full seed.
    {
        id: "ui:sidebar:e-commerce:customize-home",
        label: "E-Commerce → Customize Home",
        module: "ui",
        description: 'Show the "Customize Home" link under E-Commerce in the sidebar.',
    },
    // Reset on Pricing Strategy → Strategies clears every point in one click.
    // Split out of pricing:strategy:set so routine point tuning doesn't carry the
    // authority to wipe the lot. Grantable via the Strategies link's extra toggle.
    {
        id: "pricing:strategy:reset",
        label: "Reset all strategy points",
        module: "inventory",
        description: "Clear every strategy point at once on the Pricing Strategy → Strategies page.",
    },
    // Pricing Strategy → Print labels nav link — the printing half of the label
    // job on its own page (search/scan/voucher, shared queue with Update & print
    // labels). Derived automatically by sidebarPermissionSeeds() from the
    // MODULE_SECTIONS child in utils/constants.ts; mirrored here so an existing DB
    // gets it without a full seed.
    {
        id: "ui:sidebar:pricing-strategy:print-labels",
        label: "Pricing Strategy → Print labels",
        module: "ui",
        description: 'Show the "Print labels" link under Pricing Strategy in the sidebar.',
    },
    // Pricing Strategy → Update prices. Replaces the pre-split
    // `…:update-print-labels` id: that page was divided into "Update prices" and
    // "Print labels", so the combined name no longer describes either link. The
    // old row is dropped by rename-update-prices-permission.ts; this row is what
    // the sidebar now mints (derived from the MODULE_SECTIONS label).
    {
        id: "ui:sidebar:pricing-strategy:update-prices",
        label: "Pricing Strategy → Update prices",
        module: "ui",
        description: 'Show the "Update prices" link under Pricing Strategy in the sidebar.',
    },
    {
        id: "ui:sidebar:bi:gst-purchase-planning",
        label: "Business Intelligence → GST Purchase Planning",
        module: "ui",
        description: 'Show the "GST Purchase Planning" link under Business Intelligence in the sidebar.',
    },
    // Retention → Protection nav link. Derived automatically by
    // sidebarPermissionSeeds() from the MODULE_SECTIONS child in utils/constants.ts;
    // mirrored here so an existing DB gets it without a full seed.
    {
        id: "ui:sidebar:retention:protection",
        label: "Retention → Protection",
        module: "ui",
        description: 'Show the "Protection" link under Retention in the sidebar.',
    },
    // Retention → Protection GRANULAR capability — the page/API gate behind the
    // Protection sidebar link (the link's own `ui:sidebar:*` row was applied
    // earlier without it, so the DB drifted from the code catalog). It is NOT
    // offered as a create/edit/delete matrix on the Role page — Protection is a
    // single yes/no "manage" capability, so the sidebar-link chip is the grant —
    // but the row must exist for code/catalog parity. Mirrored from
    // codeOwnedCatalog.ts.
    {
        id: "retention:protection:manage",
        label: "Manage product protection",
        module: "retention",
        description: "Add/remove products from the discount blacklist (protection).",
    },
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
