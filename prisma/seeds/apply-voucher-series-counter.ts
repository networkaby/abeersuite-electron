import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });
import { Pool } from "pg";

function normalize(url: string | undefined): string | undefined {
    return url?.replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
}

async function main() {
    const connStr = normalize(process.env.DIRECT_URL ?? process.env.DATABASE_URL);
    if (!connStr) {
        throw new Error("Missing DATABASE_URL / DIRECT_URL in environment");
    }

    const pool = new Pool({
        connectionString: connStr,
        ssl: { rejectUnauthorized: false },
    });

    try {
        console.log("Applying counterEnabled and counter numbering to voucher_series...");

        // 1. Add counterEnabled if not exists
        await pool.query(`ALTER TABLE "VoucherSeries" ADD COLUMN IF NOT EXISTS "counterEnabled" BOOLEAN NOT NULL DEFAULT true;`);

        // 2. Drop userEnabled and userMaxWidth if they exist
        await pool.query(`ALTER TABLE "VoucherSeries" DROP COLUMN IF EXISTS "userEnabled";`);
        await pool.query(`ALTER TABLE "VoucherSeries" DROP COLUMN IF EXISTS "userMaxWidth";`);

        // 3. Update partOrder on existing rows: replace 'user' with 'counter', or set default with counter
        await pool.query(`
            UPDATE "VoucherSeries"
            SET "partOrder" = REPLACE("partOrder", 'user', 'counter')
            WHERE "partOrder" LIKE '%user%';
        `);

        await pool.query(`
            UPDATE "VoucherSeries"
            SET "partOrder" = 'type,-,year,-,counter,number'
            WHERE "partOrder" = 'type,-,year,-,number';
        `);

        const { rows } = await pool.query(`SELECT kind, label, "counterEnabled", "partOrder" FROM "VoucherSeries" ORDER BY kind`);
        console.table(rows);
        console.log("✓ Successfully updated VoucherSeries in database");
    } finally {
        await pool.end();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
