// One database client for one-off `tsx src/scripts/*` jobs.
//
// Scripts cannot use the app singleton (prismaClient.ts): it reads its env at
// import time, and tsx does not load .env.local for us. Each script used to
// copy the same few lines below; now they import this instead.
//
// Import it FIRST in a script, so .env.local is loaded before anything else
// reads process.env.
//
// Usage:
//   import { prisma, pool } from "@/shared/lib/db/scriptPrisma";
//   ... .finally(async () => { await prisma.$disconnect(); await pool.end(); });

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { scriptDbUrl } from "./dbTargets";

export const rawUrl = scriptDbUrl().replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
// Local Postgres speaks plaintext; Supabase needs SSL. Same check as prismaClient.ts.
export const isLocalDb = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(rawUrl);

export const pool = new Pool({ connectionString: rawUrl, ssl: isLocalDb ? false : { rejectUnauthorized: false }, max: 2 });
export const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
