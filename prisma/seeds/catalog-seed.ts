// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CATALOG SEED — what `pnpm prisma db seed` runs (see prisma.config.ts).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
//     pnpm prisma db seed     # = this seed
//     pnpm seed:generic       # the generic new-client installer
//
// It applies only what the CODE owns, so it is safe on the live DB:
//
//   Step 1 — CODE-OWNED CATALOG (./lib/codeOwnedCatalog.ts): the permission
//            catalog (upsert + prune of retired ids), the Phone/Email XOR
//            CHECK constraints, the voucher numbering series and the
//            existence of the BackupConfig row.
//   Step 2 — R1 top-up: R1 (Admin) is granted every non-systemOnly catalog
//            permission it does not already hold.
//
// Real config (chart of accounts, RBAC grants, POS, templates…) lives only in
// the running database. A running org is restored from a database backup —
// the old personal snapshot (personal.local.json) is retired.

import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { applyCodeOwnedCatalog, PERMISSION_CATALOG } from "./lib/codeOwnedCatalog";
import { assertNotCounterReplica } from "./lib/assertNotCounter";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");
const pool = new Pool({ connectionString: rawUrl, ssl: /@(localhost|127\.0\.0\.1)/.test(rawUrl) ? false : { rejectUnauthorized: false }, max: 5 });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const ADMIN_ROLE_ID = "R1";

async function main() {
    // A counter PC's database is a replica; seeding it mints ids that collide with
    // real Supabase rows. Checked before anything is written.
    assertNotCounterReplica("catalog-seed");

    // ── Step 1: code-owned catalog (permissions + XOR constraints + voucher series) ──
    console.log("━━━ Step 1/2 — code-owned catalog (permissions · constraints · series) ━━");
    const { permissions, pruned } = await applyCodeOwnedCatalog(prisma, pool);
    console.log(`      ✓ ${permissions} permissions upserted · ${pruned} retired pruned · XOR checks · voucher series · backup row\n`);

    // ── Step 2: R1 top-up — code-added permissions reach Admin ──
    console.log("━━━ Step 2/2 — R1 (Admin) permission top-up ━━━━━━━━━━━━━━━━━━━━━━━");
    const r1 = await prisma.role.findUnique({ where: { id: ADMIN_ROLE_ID }, select: { id: true } });
    if (r1) {
        const grants = PERMISSION_CATALOG
            .filter((p) => !p.systemOnly)
            .map((p) => ({ roleId: ADMIN_ROLE_ID, permissionId: p.id }));
        const { count } = await prisma.rolePermission.createMany({ data: grants, skipDuplicates: true });
        console.log(`      ✓ ${count} new grant(s) added to ${ADMIN_ROLE_ID}`);
    } else {
        console.log(`      • Role ${ADMIN_ROLE_ID} not present — skipped (run pnpm seed:generic on a fresh DB)`);
    }

    console.log("\n━━━ Catalog seed complete ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    await prisma.$disconnect();
    await pool.end();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
