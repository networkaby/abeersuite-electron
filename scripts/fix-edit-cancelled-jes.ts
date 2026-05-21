// One-off cleanup for the voucher-edit bug that marked original JEs as
// CANCELLED while their reversal JEs stayed POSTED. Flips those originals
// back to POSTED so the ledger running balance is correct again.
//
// Heuristic: a CANCELLED JournalEntry whose cancelReason contains
// "edited. Reversal:" was cancelled by the buggy edit flow. Account.balance
// was never decremented when those rows were cancelled (only the
// counter-entry's delta was applied), so flipping status back to POSTED
// restores the correct math — no balance recompute needed.
//
// Run:
//   pnpm tsx scripts/fix-edit-cancelled-jes.ts          # dry-run, lists matches
//   pnpm tsx scripts/fix-edit-cancelled-jes.ts --apply  # actually restore

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");
const pool = new Pool({ connectionString: rawUrl, ssl: { rejectUnauthorized: false }, max: 2 });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const apply = process.argv.includes("--apply");

async function main() {
    const candidates = await prisma.journalEntry.findMany({
        where: {
            status: "CANCELLED",
            cancelReason: { contains: "edited. Reversal:" },
        },
        select: { id: true, reference: true, description: true, cancelReason: true },
    });

    if (candidates.length === 0) {
        console.log("No matching CANCELLED entries found.");
        return;
    }

    console.log(`Found ${candidates.length} entries:`);
    for (const c of candidates) {
        console.log(`  - JE ${c.id} ${c.reference}: ${c.description}`);
        console.log(`    reason: ${c.cancelReason}`);
    }

    if (!apply) {
        console.log("\nDry-run only. Re-run with --apply to restore them to POSTED.");
        return;
    }

    await prisma.journalEntry.updateMany({
        where: { id: { in: candidates.map((c) => c.id) } },
        data: {
            status: "POSTED",
            cancelledAt: null,
            cancelledById: null,
            cancelReason: null,
        },
    });

    console.log(`\nRestored ${candidates.length} entries to POSTED.`);
}

main()
    .then(() => prisma.$disconnect().then(() => process.exit(0)))
    .catch((e) => { console.error(e); prisma.$disconnect().then(() => process.exit(1)); });
