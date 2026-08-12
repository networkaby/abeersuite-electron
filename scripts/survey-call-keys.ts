// READ-ONLY survey. Counts OUTGOING calls whose stored `phone` match key was
// built by the old last-10 rule and would change under normalizeDialedNumber
// (dial-string overflow keypresses trimmed). Prints the total, how many of the
// corrected keys actually belong to a known customer, and a sample.
//
//   Survey: pnpm tsx scripts/survey-call-keys.ts
//   Backfill: pnpm tsx scripts/survey-call-keys.ts --apply
//
// Survey writes nothing. `--apply` rewrites ONLY the `phone` match key on the
// rows the survey listed — never `rawNumber`, which is the audit record of what
// the PBX actually sent. Idempotent: re-running finds nothing left to change.

import { Pool } from "pg";
import * as dotenv from "dotenv";
import { normalizeDialedNumber, phoneMatchKey, phoneKeyVariants } from "../src/shared/lib/format/phone";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");

async function main() {
    if (!rawUrl) throw new Error("No DIRECT_URL / DATABASE_URL in env");
    const pool = new Pool({ connectionString: rawUrl, ssl: { rejectUnauthorized: false } });

    try {
        const { rows } = await pool.query<{ id: number; rawNumber: string | null; phone: string | null; occurredAt: Date }>(
            `SELECT id, "rawNumber", phone, "occurredAt"
               FROM "Call"
              WHERE direction = 'OUTGOING' AND "rawNumber" IS NOT NULL AND "rawNumber" <> ''
              ORDER BY "occurredAt" DESC`,
        );

        const changed = rows
            .map((r) => ({ ...r, next: phoneMatchKey(normalizeDialedNumber(r.rawNumber)) }))
            .filter((r) => r.next && r.next !== r.phone);

        console.log(`Outgoing calls with a number : ${rows.length}`);
        console.log(`Keys that would change       : ${changed.length}`);

        if (!changed.length) return;

        // Of the corrected keys, how many now reach a real customer? That is the
        // number that actually matters — it is the count of calls that would stop
        // showing "Unknown" and start landing on the right timeline.
        const keys = Array.from(new Set(changed.map((c) => c.next!)));
        const { rows: known } = await pool.query<{ phone: string }>(
            `SELECT DISTINCT phone FROM "Phone" WHERE phone = ANY($1)`,
            [keys.flatMap(phoneKeyVariants)],
        );
        const knownKeys = new Set(known.map((k) => phoneMatchKey(k.phone)).filter(Boolean) as string[]);
        const matched = changed.filter((c) => knownKeys.has(c.next!));

        console.log(`…of those, now match a customer: ${matched.length}`);
        console.log(`Distinct numbers affected      : ${keys.length}`);
        console.log("\nSample (newest 15):");
        for (const c of changed.slice(0, 15)) {
            const flag = knownKeys.has(c.next!) ? "→ customer" : "";
            console.log(`  #${String(c.id).padEnd(6)} ${new Date(c.occurredAt).toISOString().slice(0, 16)}  raw=${String(c.rawNumber).padEnd(16)} ${c.phone} → ${c.next}  ${flag}`);
        }

        if (!process.argv.includes("--apply")) {
            console.log("\nSurvey only — nothing written. Re-run with --apply to fix these keys.");
            return;
        }

        // One statement per row: the set is tiny (this is repairing a rare
        // misdial), and a per-row update keeps the log readable and the blast
        // radius obvious. `rawNumber` is deliberately not in the SET clause.
        for (const c of changed) {
            await pool.query(`UPDATE "Call" SET phone = $1 WHERE id = $2`, [c.next, c.id]);
        }
        console.log(`\nUpdated ${changed.length} call key(s). rawNumber left untouched.`);
    } finally {
        await pool.end();
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
