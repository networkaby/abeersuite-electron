// READ-ONLY. Finds vouchers whose goods lines were saved with the bill-level
// discount apportioned into the line (commit 6c6c1027), i.e. rows that break
// the documented invariant  amount = (qty x rate) - discountAmt + taxAmount.
// Delete this file once the affected vouchers are healed.
import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");
if (!rawUrl) throw new Error("No DIRECT_URL / DATABASE_URL in env");

const pool = new Pool({
    connectionString: rawUrl,
    ssl: /@(localhost|127\.0\.0\.1)/.test(rawUrl) ? false : { rejectUnauthorized: false },
    max: 2,
});

async function main() {
const { rows } = await pool.query(`
    SELECT uv."voucherNo",
           uv."type",
           vd."id"          AS "detailId",
           vd."discountAmt" AS "billDiscount",
           vd."subtotal",
           vd."taxAmount",
           vd."totalAmount",
           count(*)         AS "badLines",
           sum(l."amount" - round(l."quantity" * l."rate" - l."discountAmt" + l."taxAmount", 2)) AS "drift"
      FROM "VoucherInventoryLine" l
      JOIN "UniversalVoucher" uv ON uv."id" = l."universalVoucherId"
      JOIN "VoucherDetail"    vd ON vd."universalVoucherId" = uv."id"
     WHERE COALESCE(vd."discountAmt", 0) > 0
       AND abs(l."amount" - round(l."quantity" * l."rate" - l."discountAmt" + l."taxAmount", 2)) > 0.01
     GROUP BY uv."voucherNo", uv."type", vd."id", vd."discountAmt", vd."subtotal", vd."taxAmount", vd."totalAmount"
     ORDER BY vd."id"
`);

console.log(`Vouchers with apportioned (invariant-breaking) lines: ${rows.length}`);
for (const r of rows) {
    console.log(
        `  ${r.voucherNo} (${r.type}) detail#${r.detailId}  billDisc=${r.billDiscount}  ` +
        `subtotal=${r.subtotal} tax=${r.taxAmount} total=${r.totalAmount}  ` +
        `badLines=${r.badLines} drift=${r.drift}`,
    );
}

await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
