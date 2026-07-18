// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EXPORT PERSONAL — "reverse create" your personalised bootstrap from the DB.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// Run: `pnpm seed:personal:capture`
//
// READ-ONLY. Snapshots the configured state of THIS install (settings, masters,
// chart of accounts, org structure, RBAC, workflow, POS setup — everything
// EXCEPT tickets, vouchers, customers, products) into a committed JSON
// (scrubbed of password hashes):
//
//     prisma/seeds/data/personal.local.json
//
// Re-run it any time you tune settings — it refreshes the snapshot from live
// data. Then `pnpm seed:personal` replays it on top of a fresh generic
// bootstrap. See docs/seeds.md.

import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { exportPersonal } from "./lib/personalSnapshot";
import { PERSONAL_SNAPSHOT_PATH } from "./lib/personalSnapshotPath";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");
const pool = new Pool({ connectionString: rawUrl, ssl: /@(localhost|127\.0\.0\.1)/.test(rawUrl) ? false : { rejectUnauthorized: false }, max: 3 });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    console.log("━━━ Capturing personal config snapshot (read-only) ━━━━━━━━━━━━━━━━");
    const snap = await exportPersonal(prisma);

    const sections = Object.entries(snap)
        .filter(([k]) => k !== "_meta" && k !== "singletons")
        .map(([k, v]) => `${k}=${Array.isArray(v) ? v.length : 0}`);
    const singletonsPresent = Object.values(snap.singletons).filter(Boolean).length;

    mkdirSync(dirname(PERSONAL_SNAPSHOT_PATH), { recursive: true });
    writeFileSync(PERSONAL_SNAPSHOT_PATH, JSON.stringify(snap, null, 2), "utf8");

    console.log(`      ✓ singletons present: ${singletonsPresent}/${Object.keys(snap.singletons).length}`);
    console.log(`      ✓ ${sections.join("  ")}`);
    console.log(`\n      Written → ${PERSONAL_SNAPSHOT_PATH}`);
    console.log("      (scrubbed of secrets — no password hashes; safe to commit)\n");

    await prisma.$disconnect();
    await pool.end();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
