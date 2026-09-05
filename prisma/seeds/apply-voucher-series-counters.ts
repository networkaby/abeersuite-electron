// Targeted, idempotent: give every VoucherSeries its counter-1 row in
// VoucherSeriesCounter, carrying the legacy nextSeq / fyStartYear across.
//
// Voucher numbers are allocated per (kind, counter) since 2026-09-05 so that only
// the machine numbering on a row ever writes it (two machines sharing one row
// overwrote each other's next number under sync's last-write-wins). Counter 1 is
// the office; other counters create their own row on first use. Existing rows are
// never touched, so this is safe on live and safe to re-run.
//
//   pnpm seed:apply-voucher-series-counters
//
// Requires the table to exist: `pnpm prisma db push` first.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });
import { Pool } from "pg";

function normalize(url: string | undefined): string | undefined {
    return url?.replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
}

async function main() {
    const connStr = normalize(process.env.DIRECT_URL ?? process.env.DATABASE_URL);
    if (!connStr) throw new Error("Missing DATABASE_URL / DIRECT_URL in environment");
    const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connStr);
    const pool = new Pool({ connectionString: connStr, ssl: isLocal ? false : { rejectUnauthorized: false } });

    try {
        const res = await pool.query(`
            INSERT INTO "VoucherSeriesCounter" ("kind", "counterNumber", "nextSeq", "fyStartYear", "updatedAt")
            SELECT "kind", 1, "nextSeq", "fyStartYear", now()
              FROM "VoucherSeries"
            ON CONFLICT ("kind", "counterNumber") DO NOTHING`);
        const { rows } = await pool.query(
            `SELECT count(*)::int AS kinds, count(*) FILTER (WHERE "counterNumber" = 1)::int AS office FROM "VoucherSeriesCounter"`,
        );
        console.log(`inserted ${res.rowCount} counter-1 row(s); table now holds ${rows[0].kinds} row(s), ${rows[0].office} for the office.`);
    } finally {
        await pool.end();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
