// One-time clean-up: retire the `ui:sidebar:*` permission rows that
// `sync-permissions` reports as stale (in the DB, gone from the catalog), moving
// every grant on them to the link that replaced it FIRST.
//
// WHY MOVE BEFORE DELETE. Module access is "any `ui:sidebar:<module>:*` tick"
// (permissionScope.ts hasModuleNavAccess), and a department pool expands a module
// from any stored link (departmentPool.ts). A role or department whose only tick
// in a module is a stale key would lose the whole module if the row just went.
//
// Each holder — role grant, department pool, user override — gets the
// replacement key (skipped if already held), then the stale Permission row is
// deleted; its RolePermission / DepartmentPermission / UserPermission rows go
// with it (onDelete: Cascade).
//
// Sessions are left alone: the moved grant lands at each holder's next sign-in,
// and a stale id still in an old JWT matches no link, so it is harmless.
//
// Run:
//   npx tsx prisma/seeds/retire-stale-permissions.ts            # dry run — report holders
//   npx tsx prisma/seeds/retire-stale-permissions.ts --apply    # move + delete

import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { PERMISSION_CATALOG } from "./lib/codeOwnedCatalog";
import { assertNotCounterReplica } from "./lib/assertNotCounter";
import { scriptDbUrl } from "../../src/shared/lib/db/dbTargets";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = scriptDbUrl()
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");
const pool = new Pool({ connectionString: rawUrl, ssl: /@(localhost|127\.0\.0\.1)/.test(rawUrl) ? false : { rejectUnauthorized: false }, max: 2 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const apply = process.argv.includes("--apply");

// Stale id → the link that replaced it (null = nothing to move to).
const RETIRE: Record<string, string | null> = {
    "ui:sidebar:e-commerce:ads": "ui:sidebar:campaigns:shop-ads",
    "ui:sidebar:settings:due-reminders": "ui:sidebar:campaigns:due-reminders",
    "ui:sidebar:settings:pos-services": "ui:sidebar:settings:services",
    // e1b2cadb: Settings → Customer Groups retired into Group pricing.
    "ui:sidebar:settings:customer-groups": "ui:sidebar:pricing-strategy:group-pricing",
    // "My Info" became the Employee Portal at /office/me, which is open to all
    // (pageAccess.ts OPEN_TO_ALL) — no tick needed.
    "ui:sidebar:hr:me": null,
};

async function main() {
    assertNotCounterReplica("retire-stale-permissions");
    const host = rawUrl.replace(/^.*@/, "").replace(/\?.*$/, "");
    console.log(`\n━━━ retire-stale-permissions ━━━\n  Database : ${host}\n  Mode     : ${apply ? "APPLY" : "dry run (writes nothing)"}\n`);

    const catalogIds = new Set(PERMISSION_CATALOG.map((p) => p.id));
    for (const [oldId, newId] of Object.entries(RETIRE)) {
        if (catalogIds.has(oldId)) throw new Error(`${oldId} is back in the catalog — not stale, refusing.`);
        if (newId && !catalogIds.has(newId)) throw new Error(`${newId} is not in the catalog — fix the map.`);
    }

    for (const [oldId, newId] of Object.entries(RETIRE)) {
        const row = await prisma.permission.findUnique({
            where: { id: oldId },
            select: {
                roleGrants: { select: { roleId: true } },
                departmentPool: { select: { departmentId: true } },
                userOverrides: { select: { userId: true, type: true, reason: true, expiresAt: true } },
                _count: { select: { works: true, workGroups: true } },
            },
        });
        console.log(`  ${oldId}  →  ${newId ?? "(nothing — removed)"}`);
        if (!row) { console.log("      not in DB, skipped"); continue; }
        if (row._count.works || row._count.workGroups) {
            console.log(`      ✖ used by ${row._count.works} work / ${row._count.workGroups} work group(s) — left alone`);
            continue;
        }
        const roles = row.roleGrants.map((g) => g.roleId);
        const depts = row.departmentPool.map((d) => d.departmentId);
        console.log(`      roles: ${roles.join(", ") || "none"} · departments: ${depts.join(", ") || "none"} · user overrides: ${row.userOverrides.length}`);
        if (!apply) continue;

        await prisma.$transaction(async (tx) => {
            if (newId) {
                await tx.permission.upsert({
                    where: { id: newId },
                    create: (({ id, label, module, description }) => ({ id, label, module, description }))(PERMISSION_CATALOG.find((p) => p.id === newId)!),
                    update: {},
                });
                if (roles.length) await tx.rolePermission.createMany({ data: roles.map((roleId) => ({ roleId, permissionId: newId })), skipDuplicates: true });
                if (depts.length) await tx.departmentPermission.createMany({ data: depts.map((departmentId) => ({ departmentId, permissionId: newId })), skipDuplicates: true });
                if (row.userOverrides.length) await tx.userPermission.createMany({ data: row.userOverrides.map((o) => ({ ...o, permissionId: newId })), skipDuplicates: true });
            }
            await tx.permission.delete({ where: { id: oldId } });
        });
        console.log(`      ✔ moved and deleted`);
    }

    console.log(apply ? "\n  Done. Grants land at each holder's next sign-in.\n" : "\n🔍 DRY RUN — nothing written. Re-run with --apply.\n");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
