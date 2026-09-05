// Lists voucher numbers issued more than once — the safety net behind per-counter
// numbering (VoucherSeriesCounter). Two machines that shared one series row could
// mint the same reference; this shows whether any such pair reached the books.
//
// Report only; duplicates on printed GST documents need a person's decision. Run it
// before adding a partial unique index on (type, voucherNo) WHERE status <> 'DRAFT'.
//
//   pnpm check:voucher-duplicates            (exit 1 when any are found)

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
const isLocalDb = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(rawUrl);
const pool = new Pool({ connectionString: rawUrl, ssl: isLocalDb ? false : { rejectUnauthorized: false }, max: 2 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
    const dupes = await prisma.$queryRaw<Array<{ type: string; voucherNo: string; n: number; ids: number[] }>>`
        SELECT type::text AS type, "voucherNo", count(*)::int AS n, array_agg(id ORDER BY id) AS ids
          FROM "UniversalVoucher"
         WHERE status <> 'DRAFT' AND "deletedAt" IS NULL AND "voucherNo" IS NOT NULL
         GROUP BY type, "voucherNo"
        HAVING count(*) > 1
         ORDER BY type, "voucherNo"`;
    if (dupes.length === 0) {
        console.log("No duplicate voucher numbers among posted vouchers.");
        return;
    }
    console.log(`${dupes.length} voucher number(s) issued more than once:`);
    for (const d of dupes) console.log(`  ${d.type.padEnd(22)} ${d.voucherNo.padEnd(24)} x${d.n}  ids=${d.ids.join(",")}`);
    process.exitCode = 1;
}

main()
    .catch((e) => { console.error(e); process.exitCode = 2; })
    .finally(async () => { await prisma.$disconnect(); await pool.end(); });
