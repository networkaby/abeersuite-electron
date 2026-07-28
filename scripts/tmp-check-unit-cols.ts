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

const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'InvUnit' ORDER BY ordinal_position`,
);
console.log("InvUnit columns in DB:", rows.map((r) => r.column_name).join(", "));

const { rows: cnt } = await pool.query(`SELECT count(*)::int AS n FROM "InvUnit"`);
console.log("InvUnit row count:", cnt[0].n);

await pool.end();
