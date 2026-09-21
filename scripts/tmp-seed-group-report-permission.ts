/**
 * TEMPORARY — put the Group Report sidebar-link permission row into the DB so
 * the Role Matrix and the Departments pool can tick it before anyone has saved
 * a Role. Delete this file once it has been run everywhere it is needed;
 * nothing in the app calls it.
 *
 * It touches ONE table, `Permission`, and only rows whose id starts with
 * `ui:sidebar:`. It upserts by id — label and description are refreshed, and an
 * existing row is never duplicated. It grants nothing: no RolePermission, no
 * UserPermission, no DepartmentPermission is written, so nobody gains or loses
 * access by running it. Who may see the page stays the Role Matrix's answer.
 *
 * It is a targeted script on purpose (AGENTS.md §5): a full `prisma db seed`
 * would also re-run the R1 top-up and hand back every permission deliberately
 * taken away from R1 in the Role Matrix.
 *
 * Dry run is the default and it really is a different branch — nothing is
 * written until `--commit`, and the report says which branch actually ran.
 *
 * Usage:
 *   pnpm tsx scripts/tmp-seed-group-report-permission.ts
 *       Dry run against the DB in .env.local / .env. Prints the row and
 *       whether it is already there.
 *
 *   pnpm tsx scripts/tmp-seed-group-report-permission.ts --commit
 *       Writes it.
 *
 *   … --all-sidebar     every ui:sidebar:* row the nav defines, not just this
 *                       one — use when other links are missing too.
 *   … --live            reach past .env.local and write to the database in
 *                       .env (Supabase). Has to be typed on purpose.
 *   … --grant-r1        also give R1 the link, instead of ticking it by hand on
 *                       the Role Matrix. ONLY the sidebar rows in scope, and
 *                       never a systemOnly permission — `admin:bypass` is not
 *                       UI-assignable and this script will not grant it. No
 *                       other role is touched.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { sidebarPermissionSeeds } from "../src/shared/lib/auth/sidebarModules";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const ALL_SIDEBAR = args.includes("--all-sidebar");
const GRANT_R1 = args.includes("--grant-r1");

const TARGET_ID = "ui:sidebar:accountancy:group-report";

// Which database, said out loud rather than inherited. Default is whatever
// .env.local points at (the local copy on this machine); `--live` reaches past
// it to .env's DIRECT_URL, and must be typed on purpose.
const LIVE = args.includes("--live");
const url = (
    LIVE
        ? (process.env.DIRECT_URL_LIVE ?? liveUrlFromDotEnv() ?? "")
        : (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
).replace(/[?&]sslmode=[^&]*/g, "");

// A local Postgres has no TLS; Supabase needs it. Forcing ssl either way is
// what made the first run fail with TlsConnectionError against localhost.
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const pool = new Pool({
    connectionString: url,
    ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
    max: 2,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

/** .env's own DIRECT_URL, read past any .env.local override. */
function liveUrlFromDotEnv(): string | undefined {
    const parsed = dotenv.parse(readFileSync(".env"));
    return parsed.DIRECT_URL ?? parsed.DATABASE_URL;
}

async function main() {
    if (!url) {
        console.error("No DIRECT_URL / DATABASE_URL found in .env.local or .env.");
        process.exit(1);
    }
    // Say which database, before anything is written — the same connection
    // string feeds demo and live, and only the host tells them apart.
    const host = url.replace(/^.*@/, "").replace(/\/.*$/, "");
    console.log(`DB: ${host}${isLocal ? "  (local copy)" : "  (remote)"}`);
    console.log(COMMIT ? "Branch: COMMIT — rows will be written.\n" : "Branch: DRY RUN — nothing will be written.\n");

    const all = sidebarPermissionSeeds();
    const wanted = ALL_SIDEBAR ? all : all.filter((p) => p.id === TARGET_ID);

    if (wanted.length === 0) {
        console.error(`The nav does not define ${TARGET_ID}. Is the sidebar entry still there?`);
        process.exit(1);
    }

    const existing = new Set(
        (await prisma.permission.findMany({
            where: { id: { in: wanted.map((p) => p.id) } },
            select: { id: true },
        })).map((p) => p.id),
    );

    let added = 0;
    let refreshed = 0;
    for (const p of wanted) {
        const isNew = !existing.has(p.id);
        if (isNew) added++; else refreshed++;
        if (wanted.length <= 10 || isNew) {
            console.log(`  ${isNew ? "NEW    " : "present"}  ${p.id}`);
            console.log(`            ${p.label}`);
        }
        if (COMMIT) {
            await prisma.permission.upsert({
                where:  { id: p.id },
                update: { label: p.label, description: p.description, module: p.module },
                create: { id: p.id, label: p.label, description: p.description, module: p.module },
            });
        }
    }

    console.log(
        `\n${COMMIT ? "Wrote" : "Would write"}: ${added} new, ${refreshed} already present ` +
        `(${wanted.length} row${wanted.length === 1 ? "" : "s"} in scope).`,
    );
    if (GRANT_R1) {
        // The grant list is narrower than the rows above, on purpose: only the
        // `ui` sidebar rows in scope, and never a systemOnly permission —
        // `admin:bypass` is not UI-assignable and R1 is deliberately without it,
        // so it is filtered out here rather than trusted not to turn up.
        const grantable = wanted.filter((p) => p.module === "ui" && p.id !== "admin:bypass");
        const blocked = new Set(
            (await prisma.permission.findMany({
                where: { id: { in: grantable.map((p) => p.id) }, systemOnly: true },
                select: { id: true },
            })).map((p) => p.id),
        );
        const held = new Set(
            (await prisma.rolePermission.findMany({
                where: { roleId: "R1", permissionId: { in: grantable.map((p) => p.id) } },
                select: { permissionId: true },
            })).map((r) => r.permissionId),
        );

        let granted = 0;
        console.log("");
        for (const p of grantable) {
            if (blocked.has(p.id)) { console.log(`  skipped (systemOnly)   ${p.id}`); continue; }
            if (held.has(p.id))    { console.log(`  R1 already holds       ${p.id}`); continue; }
            granted++;
            console.log(`  ${COMMIT ? "GRANTED to R1         " : "would grant to R1     "} ${p.id}`);
            if (COMMIT) {
                await prisma.rolePermission.upsert({
                    where:  { roleId_permissionId: { roleId: "R1", permissionId: p.id } },
                    update: {},
                    create: { roleId: "R1", permissionId: p.id },
                });
            }
        }
        console.log(
            `${COMMIT ? "Granted" : "Would grant"} to R1: ${granted}. ` +
            "No other role was touched, and admin:bypass was not granted.",
        );
    }

    if (!COMMIT) console.log("\nNothing was written. Re-run with --commit to apply.");
    else if (!GRANT_R1) console.log("No grant was touched — tick the link on Admin → Role to give it to a role.");
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(async () => { await prisma.$disconnect(); await pool.end(); });
