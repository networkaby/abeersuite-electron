// Bring the DB's Permission rows up to date with the code-owned catalog, and
// optionally grant one of them to named roles — WITHOUT running a full seed.
//
// WHY THIS EXISTS. Some permissions are not typed by hand at all: adding a nav
// entry to SETTINGS_NAV / MODULE_SECTIONS makes `sidebarModules.ts` derive a new
// `ui:sidebar:<module>:<link>` id, which `permissionCatalog.ts` folds into the
// catalog. The row is then real in code and absent from every database.
//
// SINCE 2026-09-20 the app creates such rows itself: the Departments pool save
// and the Role save call `ensureCatalogPermissions()` first, so a new nav link
// needs no script at all. This script remains for creating rows ahead of any
// save, for granting / revoking one id across roles in bulk, and as the
// catalog ↔ DB diff report.
//
// The documented cure is `pnpm prisma db seed`, and for one new nav link that is
// far too big a hammer: Step 2 of catalog-seed tops R1 up with every
// non-systemOnly permission in the catalog (~109 grants at the time of writing)
// and resurrects anything deliberately taken away from R1 in the Role Matrix.
//
// IT CARRIES NO DATA OF ITS OWN. The old `apply-permissions.ts` was deleted
// because its hardcoded ADDITIONS list had become a third copy of the catalog
// (docs/seeds.md, "Shipping a permission"). This script imports PERMISSION_CATALOG
// and takes the policy — who holds what — from the command line, so there is
// nothing here to drift.
//
// IT NEVER DELETES A PERMISSION ROW. `applyCodeOwnedCatalog()` owns the prune; a
// row in the DB that is not in the catalog is REPORTED here and left alone.
// Deleting a live permission is exactly the risk this script exists to avoid.
//
// It CAN take a grant back, but only when asked: `--revoke-from` is the symmetric
// twin of `--roles`, for the ordinary case of deciding after the fact that a link
// belongs to fewer roles than you first thought. That removes a `RolePermission`
// row, never the `Permission` itself.
//
// Run:
//   pnpm seed:sync-permissions                                  # dry run — show the catalog ↔ DB diff
//   pnpm seed:sync-permissions --apply                          # create/update the missing rows
//   pnpm seed:sync-permissions --grant <id> --roles R1,R2,R3    # dry run, with grants
//   pnpm seed:sync-permissions --grant <id> --roles R1,R2,R3 --apply
//   pnpm seed:sync-permissions --grant <id> --revoke-from R2,R3 --apply   # take it back
//   pnpm seed:sync-permissions --grant-missing --roles R1 [--apply]   # every non-systemOnly id R1 lacks
//
//   --no-revoke   leave sessions alone (see below)
//
// SESSIONS. Permissions ride the JWT (`src/auth.ts` stamps `token.permissions` at
// login), so a granted row is invisible until the holder signs in again. The Role
// page always calls `revokeRoleSessions` for that reason, and this script mirrors
// it. That logs every holder out — including a cashier mid-shift — so `--no-revoke`
// is there for trading hours: the grant still lands, it just waits for the next
// natural login.

import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { PERMISSION_CATALOG } from "./lib/codeOwnedCatalog";
import { assertNotCounterReplica } from "./lib/assertNotCounter";
import { crudSatisfied } from "../../src/shared/lib/auth/crudLadder";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");
const pool = new Pool({ connectionString: rawUrl, ssl: /@(localhost|127\.0\.0\.1)/.test(rawUrl) ? false : { rejectUnauthorized: false }, max: 2 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const apply = process.argv.includes("--apply");
const noRevoke = process.argv.includes("--no-revoke");
const grantMissing = process.argv.includes("--grant-missing");

/** `--flag value` — returns undefined when the flag is absent or has no value. */
function flag(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    if (i === -1) return undefined;
    const v = process.argv[i + 1];
    return v && !v.startsWith("--") ? v : undefined;
}

const grantId = flag("--grant");
const roleIds = (flag("--roles") ?? "").split(",").map((r) => r.trim()).filter(Boolean);
const revokeFrom = (flag("--revoke-from") ?? "").split(",").map((r) => r.trim()).filter(Boolean);

/** Which database is about to be written to. Printed because this script is safe
 *  on live BY CONSTRUCTION, not by configuration — the operator still gets to see
 *  which one they picked before anything is written. */
function targetLabel(): string {
    try {
        const u = new URL(rawUrl);
        return `${u.host}${u.pathname}`;
    } catch {
        return "(unparseable DATABASE_URL)";
    }
}

async function main(): Promise<void> {
    assertNotCounterReplica("sync-permissions");

    if (!rawUrl) {
        console.error("\n✖ No DIRECT_URL or DATABASE_URL found in .env.local / .env\n");
        process.exit(1);
    }

    console.log(`\n━━━ sync-permissions ━━━`);
    console.log(`  Database : ${targetLabel()}`);
    console.log(`  Mode     : ${apply ? "APPLY (writes)" : "dry run (writes nothing)"}\n`);

    // ── 1. Catalog ↔ DB diff ─────────────────────────────────────────────────
    const existing = await prisma.permission.findMany({
        select: { id: true, label: true, module: true, description: true },
    });
    const byId = new Map(existing.map((p) => [p.id, p]));

    const missing = PERMISSION_CATALOG.filter((p) => !byId.has(p.id));
    const drifted = PERMISSION_CATALOG.filter((p) => {
        const cur = byId.get(p.id);
        return cur && (cur.label !== p.label || cur.module !== p.module || cur.description !== p.description);
    });
    const catalogIds = new Set(PERMISSION_CATALOG.map((p) => p.id));
    const stale = existing.filter((p) => !catalogIds.has(p.id));

    console.log(`  Catalog ${PERMISSION_CATALOG.length} · DB ${existing.length}`);
    console.log(`    ${missing.length} missing · ${drifted.length} drifted · ${stale.length} stale (reported, never deleted)`);
    for (const p of missing) console.log(`      + ${p.id}  "${p.label}"`);
    for (const p of drifted) console.log(`      ~ ${p.id}`);
    for (const p of stale) console.log(`      ? ${p.id}  — in DB, not in catalog; left alone`);

    if (apply) {
        for (const p of [...missing, ...drifted]) {
            await prisma.permission.upsert({
                where: { id: p.id },
                update: { label: p.label, module: p.module, description: p.description },
                create: p,
            });
        }
        console.log(`  → ${missing.length} created, ${drifted.length} updated.`);
    }

    // ── 2. Grants ────────────────────────────────────────────────────────────
    let changed = 0;
    // Everyone whose sessions this run could invalidate — granted TO or taken FROM.
    const touchedRoles = [...new Set([...roleIds, ...revokeFrom])];
    if (grantId) {
        // A typo must fail loudly. Granting an id that is not in the catalog would
        // either break the FK or leave a row a later prune silently removes.
        if (!catalogIds.has(grantId)) {
            console.error(`\n✖ "${grantId}" is not in the permission catalog. Nothing changed.\n`);
            process.exit(1);
        }
        if (touchedRoles.length === 0) {
            console.error(`\n✖ --grant needs --roles and/or --revoke-from (e.g. --roles R1 --revoke-from R2,R3).\n`);
            process.exit(1);
        }
        const overlap = roleIds.filter((r) => revokeFrom.includes(r));
        if (overlap.length) {
            console.error(`\n✖ ${overlap.join(", ")} is in both --roles and --revoke-from. Nothing changed.\n`);
            process.exit(1);
        }
        const roles = await prisma.role.findMany({ where: { id: { in: touchedRoles } }, select: { id: true } });
        const unknown = touchedRoles.filter((r) => !roles.some((x) => x.id === r));
        if (unknown.length) {
            console.error(`\n✖ Unknown role(s): ${unknown.join(", ")}. Nothing changed.\n`);
            process.exit(1);
        }

        const held = await prisma.rolePermission.findMany({
            where: { permissionId: grantId, roleId: { in: touchedRoles } },
            select: { roleId: true },
        });
        const heldSet = new Set(held.map((h) => h.roleId));
        const toGrant = roleIds.filter((r) => !heldSet.has(r));
        const toRevoke = revokeFrom.filter((r) => heldSet.has(r));

        console.log(`\n  Grant ${grantId}`);
        if (roleIds.length) {
            console.log(`    ${toGrant.length} to add (${toGrant.join(", ") || "none"}) · ${roleIds.filter((r) => heldSet.has(r)).length} already held`);
        }
        if (revokeFrom.length) {
            console.log(`    ${toRevoke.length} to remove (${toRevoke.join(", ") || "none"}) · ${revokeFrom.filter((r) => !heldSet.has(r)).length} already absent`);
        }

        if (apply && toGrant.length) {
            // The composite @@id([roleId, permissionId]) makes this idempotent even
            // if two runs race.
            const res = await prisma.rolePermission.createMany({
                data: toGrant.map((roleId) => ({ roleId, permissionId: grantId })),
                skipDuplicates: true,
            });
            changed += res.count;
            console.log(`  → ${res.count} grant(s) added.`);
        }
        if (apply && toRevoke.length) {
            // Scoped to this one permission and these named roles on purpose: a
            // deleteMany that could reach further is not a tool anyone should have
            // pointed at a live RBAC table.
            const res = await prisma.rolePermission.deleteMany({
                where: { permissionId: grantId, roleId: { in: toRevoke } },
            });
            changed += res.count;
            console.log(`  → ${res.count} grant(s) removed.`);
        }
    }

    // ── 2b. Every catalog permission the roles lack ─────────────────────────
    // The full seed's R1 top-up (catalog-seed Step 2), without the rest of
    // the seed. Adds only — and resurrects anything deliberately taken away, so
    // read the dry-run list first.
    if (grantMissing) {
        if (grantId) {
            console.error(`\n✖ --grant-missing and --grant are separate runs. Nothing changed.\n`);
            process.exit(1);
        }
        if (roleIds.length === 0) {
            console.error(`\n✖ --grant-missing needs --roles (e.g. --roles R1).\n`);
            process.exit(1);
        }
        const roles = await prisma.role.findMany({ where: { id: { in: roleIds } }, select: { id: true } });
        const unknown = roleIds.filter((r) => !roles.some((x) => x.id === r));
        if (unknown.length) {
            console.error(`\n✖ Unknown role(s): ${unknown.join(", ")}. Nothing changed.\n`);
            process.exit(1);
        }
        const grantable = PERMISSION_CATALOG.filter((p) => !p.systemOnly);
        const held = await prisma.rolePermission.findMany({
            where: { roleId: { in: roleIds } },
            select: { roleId: true, permissionId: true },
        });
        for (const roleId of roleIds) {
            const has = new Set(held.filter((h) => h.roleId === roleId).map((h) => h.permissionId));
            // A lower CRUD rung (create / edit) is implied by a held higher one and is
            // never stored (crudLadder.ts) — granting it would only be noise.
            const toGrant = grantable.filter((p) => !has.has(p.id) && !crudSatisfied(has, p.id));
            console.log(`\n  ${roleId}: ${toGrant.length} missing of ${grantable.length} grantable (lower CRUD rungs implied, skipped)`);
            for (const p of toGrant) console.log(`      + ${p.id}  "${p.label}"`);
            if (apply && toGrant.length) {
                const res = await prisma.rolePermission.createMany({
                    data: toGrant.map((p) => ({ roleId, permissionId: p.id })),
                    skipDuplicates: true,
                });
                changed += res.count;
                console.log(`  → ${res.count} grant(s) added to ${roleId}.`);
            }
        }
    }

    // ── 3. Sessions ──────────────────────────────────────────────────────────
    if (apply && changed > 0 && !noRevoke) {
        // Mirrors revokeRoleSessions() in src/shared/lib/auth/revokeSessions.ts —
        // a direct User.role assignment, or any held Position carrying the role.
        const res = await prisma.user.updateMany({
            where: {
                OR: [
                    { role: { in: touchedRoles } },
                    { userPositions: { some: { position: { roleTemplates: { some: { roleId: { in: touchedRoles } } } } } } },
                ],
            },
            data: { tokensValidFrom: new Date() },
        });
        console.log(`\n  ${res.count} user session(s) revoked — those staff must sign in again to see the change.`);
    } else if (apply && changed > 0) {
        console.log(`\n  Sessions left alone (--no-revoke). The change lands at each holder's next sign-in.`);
    }

    console.log(apply ? "\n✅ Applied.\n" : "\n🔍 DRY RUN — nothing written. Re-run with --apply.\n");
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(async () => { await prisma.$disconnect(); await pool.end(); });
