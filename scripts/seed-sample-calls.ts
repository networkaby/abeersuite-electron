// One-off: seed sample Call rows so the CRM Call Log UI + Reconnect timeline can
// be checked without a live PBX. Idempotent (upsert on the unique `raw` line).
//
//   Run:    pnpm tsx scripts/seed-sample-calls.ts
//   Clean:  pnpm tsx scripts/seed-sample-calls.ts --clean   (removes SAMPLE-% rows)
//
// The matched rows use REAL customer phone numbers already in the DB, so they show
// up in that customer's Reconnect timeline. Delete this script when done.

import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");

const MIN = 60_000, HR = 3_600_000, DAY = 86_400_000;
const now = Date.now();

type Row = {
    tag: string;
    direction: "INCOMING" | "OUTGOING" | "INTERNAL" | "UNKNOWN";
    phone: string | null;
    fromExt?: string; toExt?: string; trunk?: string; status?: string;
    durationSec?: number; speechSec?: number; answerSec?: number; holdSec?: number;
    amount?: number; units?: number;
    ago: number; note?: string; spam?: boolean;
};

// Matched rows reuse real customer numbers (from the DB) so they land on a
// customer's timeline. Unknown rows use 98000xxxxx (not in the DB) → "Unknown".
const rows: Row[] = [
    // ── matched to real customers ──────────────────────────────────────────
    { tag: "01", direction: "INCOMING", phone: "6002146527", toExt: "22", trunk: "C001", status: "N", speechSec: 47, answerSec: 5, ago: 2 * HR, note: "Asked about CCTV AMC renewal" },
    { tag: "02", direction: "OUTGOING", phone: "9957162449", fromExt: "24", trunk: "C001", status: "R", durationSec: 132, amount: 2.4, units: 2, ago: 5 * HR },
    { tag: "03", direction: "INCOMING", phone: "9954844521", toExt: "22", trunk: "C002", status: "M", speechSec: 0, holdSec: 18, ago: DAY + 3 * HR }, // missed
    { tag: "09", direction: "INCOMING", phone: "6002146527", toExt: "22", trunk: "C001", status: "M", speechSec: 0, ago: 30 * MIN }, // same customer, missed, recent
    // ── unknown callers (triage: create lead / flag spam) ──────────────────
    { tag: "04", direction: "INCOMING", phone: "9800011111", toExt: "21", trunk: "C001", status: "N", speechSec: 88, answerSec: 4, ago: 40 * MIN, note: "New enquiry — laptop repair pricing" },
    { tag: "05", direction: "INCOMING", phone: "9800022222", toExt: "22", trunk: "C002", status: "M", speechSec: 0, ago: 20 * MIN }, // unknown missed
    { tag: "06", direction: "OUTGOING", phone: "9800033333", fromExt: "23", trunk: "C001", status: "R", durationSec: 64, amount: 1.1, units: 1, ago: 3 * HR },
    { tag: "10", direction: "OUTGOING", phone: "9800055555", fromExt: "24", trunk: "C001", status: "U", durationSec: 0, ago: 90 * MIN }, // unanswered outgoing
    // ── internal (hidden unless "Include internal") ────────────────────────
    { tag: "07", direction: "INTERNAL", phone: null, fromExt: "22", toExt: "21", durationSec: 22, ago: 6 * HR },
    // ── spam (hidden unless "Spam") ────────────────────────────────────────
    { tag: "08", direction: "INCOMING", phone: "9800044444", toExt: "22", trunk: "C002", status: "N", speechSec: 12, ago: 8 * HR, spam: true },
];

async function main() {
    if (!rawUrl) throw new Error("No DIRECT_URL / DATABASE_URL in env");
    const pool = new Pool({ connectionString: rawUrl, ssl: { rejectUnauthorized: false } });

    try {
        if (process.argv.includes("--clean")) {
            const del = await pool.query(`DELETE FROM "Call" WHERE raw LIKE 'SAMPLE-%'`);
            console.log(`Removed ${del.rowCount} sample call(s).`);
            return;
        }

        // Clean slate first, so re-running is idempotent without relying on a
        // unique constraint on `raw` (the live DB currently has only a plain index).
        await pool.query(`DELETE FROM "Call" WHERE raw LIKE 'SAMPLE-%'`);

        let n = 0;
        for (const r of rows) {
            const occurredAt = new Date(now - r.ago);
            const receivedAt = new Date(now - r.ago + 1500);
            const raw = `SAMPLE-${r.tag}`;
            await pool.query(
                `INSERT INTO "Call"
                   (direction, phone, "rawNumber", "fromExt", "toExt", trunk, status,
                    "durationSec", "speechSec", "answerSec", "holdSec", amount, units,
                    "occurredAt", "receivedAt", raw, note, spam)
                 VALUES ($1::"CallDirection",$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
                [
                    r.direction, r.phone, r.phone, r.fromExt ?? null, r.toExt ?? null, r.trunk ?? null, r.status ?? null,
                    r.durationSec ?? 0, r.speechSec ?? 0, r.answerSec ?? 0, r.holdSec ?? 0, r.amount ?? null, r.units ?? null,
                    occurredAt, receivedAt, raw, r.note ?? null, r.spam ?? false,
                ],
            );
            n++;
        }
        console.log(`Seeded/updated ${n} sample calls (raw = SAMPLE-01 … SAMPLE-10).`);
        console.log(`Matched customers: 6002146527, 9957162449, 9954844521 → check their Reconnect timeline.`);
        console.log(`Clean up later:  pnpm tsx scripts/seed-sample-calls.ts --clean`);
    } finally {
        await pool.end();
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
