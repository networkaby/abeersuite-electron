// TEMPORARY ONE-OFF — delete this file once it has been run on the office DB.
//
// Pricing Strategy stopped having a per-page edit key: doing the work on those
// pages now rides page access (`requireModuleAccess("pricing-strategy")`), and
// only `pricing:strategy:reset` survives as a real gate. Three keys were removed
// from the code catalog in the same commit:
//
//     pricing:strategy:set · pricing:costing:manage · pricing:labels:apply
//
// Nothing reads them any more, so the rows left behind in the database are inert —
// a full `pnpm prisma db seed` would prune them on its own. This script is the
// small version of that prune, for when a full seed is not wanted: it removes the
// three Permission rows, and their grants go with them by cascade
// (RolePermission / DepartmentPermission / UserPermission all ON DELETE CASCADE).
//
// NO SESSION REVOKE. A signed-in user's token may still carry one of these three
// strings; that is harmless, because no route checks them any more. Nobody has to
// sign in again, so nobody gets logged out mid-shift.
//
// Run (from the OFFICE machine — a counter PC is refused):
//   pnpm tsx prisma/seeds/drop-pricing-edit-permissions.ts            # dry run
//   pnpm tsx prisma/seeds/drop-pricing-edit-permissions.ts --apply

import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { assertNotCounterReplica } from "./lib/assertNotCounter";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");
const pool = new Pool({
    connectionString: rawUrl,
    ssl: /@(localhost|127\.0\.0\.1)/.test(rawUrl) ? false : { rejectUnauthorized: false },
    max: 2,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const apply = process.argv.includes("--apply");

const DEAD_IDS = ["pricing:strategy:set", "pricing:costing:manage", "pricing:labels:apply"];

function targetLabel(): string {
    try {
        const u = new URL(rawUrl);
        return `${u.host}${u.pathname}`;
    } catch {
        return "(unparseable DATABASE_URL)";
    }
}

async function main(): Promise<void> {
    assertNotCounterReplica("drop-pricing-edit-permissions");

    if (!rawUrl) {
        console.error("\n✖ No DIRECT_URL or DATABASE_URL found in .env.local / .env\n");
        process.exit(1);
    }

    console.log(`\n━━━ drop-pricing-edit-permissions ━━━`);
    console.log(`  Database : ${targetLabel()}`);
    console.log(`  Mode     : ${apply ? "APPLY (writes)" : "dry run (writes nothing)"}\n`);

    const rows = await prisma.permission.findMany({
        where:  { id: { in: DEAD_IDS } },
        select: {
            id:    true,
            label: true,
            _count: { select: { roleGrants: true, departmentPool: true, userOverrides: true, works: true, workGroups: true } },
        },
    });

    if (rows.length === 0) {
        console.log("  Nothing to do — none of the three permissions is in this database.\n");
        return;
    }

    // Work / WorkGroup do NOT cascade. If a work item points at one of these keys,
    // deleting the Permission would fail — better to say so than to crash.
    let blocked = false;
    for (const r of rows) {
        const c = r._count;
        console.log(`  ${r.id}`);
        console.log(`      role grants ${c.roleGrants} · department pool ${c.departmentPool} · user overrides ${c.userOverrides}`);
        if (c.works > 0 || c.workGroups > 0) {
            blocked = true;
            console.log(`      ⚠ still referenced by ${c.works} work(s) and ${c.workGroups} work group(s) — repoint those first`);
        }
    }

    if (blocked) {
        console.log("\n✖ Stopped: a Work / WorkGroup still points at one of these keys.\n");
        process.exit(1);
    }

    if (!apply) {
        console.log("\n🔍 DRY RUN — nothing written. Re-run with --apply.\n");
        return;
    }

    const res = await prisma.permission.deleteMany({ where: { id: { in: DEAD_IDS } } });
    console.log(`\n✅ ${res.count} permission row(s) deleted, grants gone with them by cascade.`);
    console.log("   Nobody is signed out — no route reads these keys any more.");
    console.log("   You can now delete this script.\n");
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(async () => { await prisma.$disconnect(); await pool.end(); });
