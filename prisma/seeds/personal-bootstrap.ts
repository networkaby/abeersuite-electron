// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PERSONAL BOOTSTRAP — self-complete restore of YOUR configuration.
// This is what `pnpm prisma db seed` runs (see prisma.config.ts).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
//     pnpm prisma db seed                  # = this seed (catalog + overlay)
//     pnpm seed:personal                   # same thing, direct
//     pnpm seed:personal --overlay-only    # skip the code-owned catalog step
//     pnpm seed:generic                    # the generic new-client installer
//
// SELF-COMPLETE: this seed does NOT run the generic installer. It stands up a
// working install from two sources and nothing else:
//
//   Step 1 — CODE-OWNED CATALOG (./lib/codeOwnedCatalog.ts): the permission
//            catalog (upsert + prune of retired ids), the Phone/Email XOR
//            CHECK constraints, and the voucher numbering series — exactly
//            the three things the personal snapshot deliberately never
//            carries because they belong to the code.
//   Step 2 — YOUR SNAPSHOT (prisma/seeds/data/personal.local.json, captured
//            by `pnpm seed:personal:capture`): every piece of real config —
//            org, chart of accounts, RBAC grants, pipeline, POS, templates.
//   Step 3 — R1 top-up: R1 (Admin) is granted any catalog permission it does
//            not already hold, so code-added permissions reach the admin role
//            without waiting for a re-capture.
//
// The overlay is UPSERT-ONLY — it never deletes (the only delete anywhere is
// the catalog's prune of permissions retired from code). Safe to re-run on a
// live DB: it re-asserts config without touching transactions.
//
// The dev loop is CAPTURE → EDIT → SEED: configure in the UI, capture to the
// snapshot, (optionally hand-edit it), then `pnpm prisma db seed` re-applies.
// The generic installer (`pnpm seed:generic`) is ONLY for a brand-new client
// who has no snapshot — it creates the generic demo world this seed avoids.

import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { existsSync, readFileSync } from "fs";
import { importPersonal, type PersonalSnapshot } from "./lib/personalSnapshot";
import { PERSONAL_SNAPSHOT_PATH } from "./lib/personalSnapshotPath";
import { applyCodeOwnedCatalog, PERMISSION_CATALOG } from "./lib/codeOwnedCatalog";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const overlayOnly = process.argv.includes("--overlay-only");

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");
const pool = new Pool({ connectionString: rawUrl, ssl: /@(localhost|127\.0\.0\.1)/.test(rawUrl) ? false : { rejectUnauthorized: false }, max: 5 });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const ADMIN_ROLE_ID = "R1";

async function main() {
    // ── Step 1: code-owned catalog (permissions + XOR constraints + voucher series) ──
    if (!overlayOnly) {
        console.log("━━━ Step 1/3 — code-owned catalog (permissions · constraints · series) ━━");
        const { permissions, pruned } = await applyCodeOwnedCatalog(prisma, pool);
        console.log(`      ✓ ${permissions} permissions upserted · ${pruned} retired pruned · XOR checks · voucher series\n`);
    } else {
        console.log("━━━ --overlay-only — skipping the code-owned catalog step ━━━━━━━━━\n");
    }

    // ── Step 2: overlay your real config ──
    console.log("━━━ Step 2/3 — overlay personal config ━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    if (!existsSync(PERSONAL_SNAPSHOT_PATH)) {
        console.log(`\n      • No snapshot at ${PERSONAL_SNAPSHOT_PATH}`);
        console.log("      • Nothing to overlay — only the code-owned catalog was applied.");
        console.log("      • New client with no config yet? Run the generic installer: `pnpm seed:generic`.");
        console.log("      • Have a configured DB? Capture it with `pnpm seed:personal:capture`, then re-run.\n");
        await prisma.$disconnect();
        await pool.end();
        return;
    }

    const snap = JSON.parse(readFileSync(PERSONAL_SNAPSHOT_PATH, "utf8")) as PersonalSnapshot;
    console.log(`      Loaded snapshot from ${snap._meta?.exportedAt ?? "unknown time"}\n`);

    const stats = await importPersonal(prisma, snap);

    const rows = Object.entries(stats.sections).map(([k, n]) => `${k}=${n}`);
    console.log(`      ✓ overlaid: ${rows.join("  ")}`);
    for (const s of stats.skipped) console.log(`      • note: ${s}`);

    // ── Step 3: R1 top-up — code-added permissions reach Admin without re-capture ──
    console.log("\n━━━ Step 3/3 — R1 (Admin) permission top-up ━━━━━━━━━━━━━━━━━━━━━━━");
    const r1 = await prisma.role.findUnique({ where: { id: ADMIN_ROLE_ID }, select: { id: true } });
    if (r1) {
        const grants = PERMISSION_CATALOG
            .filter((p) => !p.systemOnly)
            .map((p) => ({ roleId: ADMIN_ROLE_ID, permissionId: p.id }));
        const { count } = await prisma.rolePermission.createMany({ data: grants, skipDuplicates: true });
        console.log(`      ✓ ${count} new grant(s) added to ${ADMIN_ROLE_ID}`);
    } else {
        console.log(`      • Role ${ADMIN_ROLE_ID} not present — skipped (snapshot carries no roles?)`);
    }

    console.log("\n━━━ Personal seed complete ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    await prisma.$disconnect();
    await pool.end();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
