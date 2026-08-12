/**
 * One-off, idempotent migration — run with:
 *   pnpm tsx prisma/seeds/rename-update-prices-permission.ts
 *
 * TWO jobs, in order:
 *
 * 1. Rename `ui:sidebar:pricing-strategy:update-print-labels`
 *              → `ui:sidebar:pricing-strategy:update-prices`.
 *    The "Update & print labels" page was split into "Update prices" and
 *    "Print labels", so the combined id no longer describes the link it sits on
 *    (its sibling `…:print-labels` is the one that prints). Sidebar permission
 *    ids are derived from the nav label, so the rename in MODULE_SECTIONS mints
 *    the new id; this moves the row and every grant that points at the old one.
 *
 * 2. R1 (Admin) full permission top-up — grants every non-systemOnly catalog
 *    permission, same rule as personal-bootstrap Step 3, without the cost of a
 *    full seed. `systemOnly` rows (admin:bypass) stay excluded by design.
 *
 * Safe to re-run: every write is an upsert / createMany-skipDuplicates, and the
 * old-id cleanup is a no-op once the row is gone. Delete this file once applied.
 */
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { PERMISSION_CATALOG } from "./lib/codeOwnedCatalog";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const OLD_ID = "ui:sidebar:pricing-strategy:update-print-labels";
const NEW_ID = "ui:sidebar:pricing-strategy:update-prices";
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
        // ── 1. Rename ────────────────────────────────────────────────────────────
        // The new row must exist before any grant can reference it (FK).
        await prisma.permission.upsert({
            where: { id: NEW_ID },
            update: {
                label: "Pricing Strategy → Update prices",
                module: "ui",
                description: 'Show the "Update prices" link under Pricing Strategy in the sidebar.',
            },
            create: {
                id: NEW_ID,
                label: "Pricing Strategy → Update prices",
                module: "ui",
                description: 'Show the "Update prices" link under Pricing Strategy in the sidebar.',
            },
        });

        // Carry every reference across, then drop the old row — its own grants go
        // with it via onDelete: Cascade, so the copy has to happen first.
        const roleGrants = await prisma.rolePermission.findMany({
            where: { permissionId: OLD_ID },
            select: { roleId: true },
        });
        const deptPools = await prisma.departmentPermission.findMany({
            where: { permissionId: OLD_ID },
            select: { departmentId: true },
        });
        const userOverrides = await prisma.userPermission.findMany({
            where: { permissionId: OLD_ID },
            select: { userId: true, type: true, reason: true, expiresAt: true },
        });

        const r = await prisma.rolePermission.createMany({
            data: roleGrants.map((g) => ({ roleId: g.roleId, permissionId: NEW_ID })),
            skipDuplicates: true,
        });
        const d = await prisma.departmentPermission.createMany({
            data: deptPools.map((g) => ({ departmentId: g.departmentId, permissionId: NEW_ID })),
            skipDuplicates: true,
        });
        const u = await prisma.userPermission.createMany({
            data: userOverrides.map((o) => ({ ...o, permissionId: NEW_ID })),
            skipDuplicates: true,
        });

        const removed = await prisma.permission.deleteMany({ where: { id: OLD_ID } });

        console.log(`✓ rename ${OLD_ID} → ${NEW_ID}`);
        console.log(`    carried: roles=${r.count} deptPools=${d.count} userOverrides=${u.count}`);
        console.log(`    old row removed: ${removed.count}`);

        // ── 2. R1 full top-up ────────────────────────────────────────────────────
        const r1 = await prisma.role.findUnique({ where: { id: ADMIN_ROLE_ID }, select: { id: true } });
        if (!r1) {
            console.log(`    • Role ${ADMIN_ROLE_ID} not present — top-up skipped`);
        } else {
            const grantable = PERMISSION_CATALOG.filter((p) => !p.systemOnly).map((p) => p.id);
            // The catalog is code; only ids with a real row can be granted (FK).
            const present = await prisma.permission.findMany({
                where: { id: { in: grantable } },
                select: { id: true },
            });
            const { count } = await prisma.rolePermission.createMany({
                data: present.map((p) => ({ roleId: ADMIN_ROLE_ID, permissionId: p.id })),
                skipDuplicates: true,
            });
            const total = await prisma.rolePermission.count({ where: { roleId: ADMIN_ROLE_ID } });
            const unseeded = grantable.filter((id) => !present.some((p) => p.id === id));
            console.log(`✓ ${ADMIN_ROLE_ID} top-up: ${count} new grant(s); now holds ${total}`);
            if (unseeded.length) console.log(`    • in catalog but not in DB (skipped): ${unseeded.join(", ")}`);
        }
    } finally {
        await pool.end();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
