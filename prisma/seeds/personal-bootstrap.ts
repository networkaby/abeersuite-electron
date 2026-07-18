// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PERSONAL BOOTSTRAP — seed YOUR install: generic bootstrap + your real config.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// Run instead of `pnpm prisma db seed` on your own install:
//
//     pnpm seed:personal                  # generic bootstrap, then overlay
//     pnpm seed:personal --overlay-only    # skip bootstrap, just re-apply
//
// Step 1 runs the UNTOUCHED generic `bootstrap-seed.ts` as a subprocess (the
// new-client installer — structure + schema-current defaults). Step 2 overlays
// the git-ignored snapshot captured by `pnpm seed:personal:capture`, replacing
// baseline values with YOUR real ones and adding your custom rows.
//
// The overlay is UPSERT-ONLY — it never deletes. `--overlay-only` is the quick
// fix for "I ran `db seed` and it reset my settings" — it re-applies your real
// config without a full rebuild. See docs/seeds.md.

import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { existsSync, readFileSync } from "fs";
import { execSync } from "child_process";
import { importPersonal, type PersonalSnapshot } from "./lib/personalSnapshot";
import { PERSONAL_SNAPSHOT_PATH } from "./lib/personalSnapshotPath";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const overlayOnly = process.argv.includes("--overlay-only");

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");
const pool = new Pool({ connectionString: rawUrl, ssl: /@(localhost|127\.0\.0\.1)/.test(rawUrl) ? false : { rejectUnauthorized: false }, max: 5 });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    // ── Step 1: generic bootstrap (untouched new-client installer) ──
    if (!overlayOnly) {
        console.log("━━━ Step 1/2 — generic bootstrap (subprocess) ━━━━━━━━━━━━━━━━━━━━\n");
        execSync("pnpm exec tsx prisma/seeds/bootstrap-seed.ts", { stdio: "inherit" });
        console.log("");
    } else {
        console.log("━━━ --overlay-only — skipping generic bootstrap ━━━━━━━━━━━━━━━━━━\n");
    }

    // ── Step 2: overlay your real config ──
    console.log("━━━ Step 2/2 — overlay personal config ━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    if (!existsSync(PERSONAL_SNAPSHOT_PATH)) {
        console.log(`\n      • No snapshot at ${PERSONAL_SNAPSHOT_PATH}`);
        console.log("      • Nothing to overlay — this install has plain generic bootstrap defaults.");
        console.log("      • Capture your real config with `pnpm seed:personal:capture`, then re-run.\n");
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

    console.log("\n━━━ Personal seed complete ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    await prisma.$disconnect();
    await pool.end();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
