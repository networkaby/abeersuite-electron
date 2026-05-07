import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL?.replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");

// On Vercel serverless: prefer the Supabase pooler URL (port 6543, pgbouncer transaction mode)
// in DATABASE_URL. With pooler, max can stay modest per container. Without pooler, raising max
// risks exhausting Postgres' direct-connection limit under concurrent invocations.
const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 10,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000,
});
const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });