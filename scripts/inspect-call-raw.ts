// READ-ONLY. Prints the stored SMDR line for calls matching a number, so a
// mis-parsed field (wrong column offsets in epbx.js parseOG/parseIC) can be
// diagnosed against real bytes instead of guessed.
//
//   Run: pnpm tsx scripts/inspect-call-raw.ts 9954403763
//
// Matches loosely on purpose: a corrupted capture has a DIFFERENT match key
// from the real number, so an exact `phone =` lookup would miss the very row
// we're hunting. Delete this script once the parse bug is fixed.

import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");

const arg = process.argv[2]?.replace(/\D/g, "") ?? "";

async function main() {
    if (!rawUrl) throw new Error("No DIRECT_URL / DATABASE_URL in env");
    if (arg.length < 6) throw new Error("Pass a number, e.g. pnpm tsx scripts/inspect-call-raw.ts 9954403763");

    // Search on the first 9 digits so a trailing-junk capture still matches.
    const stem = arg.slice(0, 9);
    const pool = new Pool({ connectionString: rawUrl, ssl: { rejectUnauthorized: false } });

    try {
        const { rows } = await pool.query(
            `SELECT id, direction, phone, "rawNumber", "fromExt", "toExt", trunk, serial,
                    status, "durationSec", "speechSec", "occurredAt", raw
               FROM "Call"
              WHERE "rawNumber" LIKE $1 OR phone LIKE $1
              ORDER BY "occurredAt" DESC
              LIMIT 20`,
            [`%${stem}%`],
        );

        if (!rows.length) {
            console.log(`No calls found containing "${stem}".`);
            return;
        }

        for (const r of rows) {
            console.log("─".repeat(78));
            console.log(`#${r.id}  ${r.direction}  ${new Date(r.occurredAt).toISOString()}`);
            console.log(`  serial=${r.serial}  fromExt=${r.fromExt}  toExt=${r.toExt}  trunk=${r.trunk}  status=${r.status}`);
            console.log(`  rawNumber=${JSON.stringify(r.rawNumber)}   phone=${JSON.stringify(r.phone)}`);
            console.log(`  dur=${r.durationSec}s speech=${r.speechSec}s`);
            // Column ruler above the raw line — the whole point of this script is
            // to read field boundaries off it by eye.
            const ruler = Array.from({ length: Math.max(0, (r.raw?.length ?? 0)) },
                (_, i) => (i % 10 === 0 ? String((i / 10) % 10) : ".")).join("");
            console.log(`  raw : ${JSON.stringify(r.raw)}`);
            console.log(`  cols: "${ruler}"`);
        }
        console.log("─".repeat(78));
        console.log(`${rows.length} row(s).`);
    } finally {
        await pool.end();
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
