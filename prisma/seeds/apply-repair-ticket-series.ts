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
        console.log("Applying ticketNo to TicketRepair and REPAIR_TICKET to VoucherSeries...");

        // 1. Add ticketNo column to TicketRepair
        await pool.query(`ALTER TABLE "TicketRepair" ADD COLUMN IF NOT EXISTS "ticketNo" TEXT;`);

        // 2. Count existing TicketRepair rows
        const countRes = await pool.query(`SELECT COUNT(*)::int as count FROM "TicketRepair"`);
        const repairCount = countRes.rows[0]?.count ?? 0;

        // 3. Upsert REPAIR_TICKET into VoucherSeries
        const now = new Date();
        const fyStart = now.getUTCMonth() < 3 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();

        await pool.query(`
            INSERT INTO "VoucherSeries" (
                "kind", "label", "fyStartYear", "typeEnabled", "typeValue",
                "counterEnabled", "yearEnabled", "yearFormat", "startFrom",
                "padWidth", "nextSeq", "partOrder", "updatedAt"
            ) VALUES (
                'REPAIR_TICKET', 'Service Repair Ticket', $1, true, 'RT',
                true, true, 'FY_SHORT', 1,
                4, $2, 'type,-,year,-,counter,number', NOW()
            )
            ON CONFLICT ("kind") DO UPDATE SET
                "label" = EXCLUDED."label",
                "typeValue" = EXCLUDED."typeValue";
        `, [fyStart, repairCount]);

        const { rows } = await pool.query(`SELECT kind, label, "typeValue", "counterEnabled", "nextSeq", "partOrder" FROM "VoucherSeries" WHERE kind = 'REPAIR_TICKET'`);
        console.table(rows);
        console.log("✓ Successfully applied REPAIR_TICKET to VoucherSeries in database");
    } finally {
        await pool.end();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
