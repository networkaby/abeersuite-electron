import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL?.replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 1 });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as never);

async function main() {
    await (prisma as never as { pipeline: { upsert: (args: unknown) => Promise<{ id: string; label: string }> } }).pipeline.upsert({
        where: { id: "P1" },
        update: {},
        create: {
            id: "P1",
            name: "service",
            label: "Service & Repair",
            description: "Electronics repair and service workflow",
            color: "bg-blue-100 text-blue-600",
            isDefault: true,
            isActive: true,
            order: 0,
        },
    });
    console.log("Upserted pipeline P1 — Service & Repair");

    const db = prisma as unknown as {
        ticketStatus: { updateMany: (args: unknown) => Promise<{ count: number }> };
        ticketSubStatus: { updateMany: (args: unknown) => Promise<{ count: number }> };
        ticket: { updateMany: (args: unknown) => Promise<{ count: number }> };
    };

    const s = await db.ticketStatus.updateMany({ where: { pipelineId: null }, data: { pipelineId: "P1" } });
    console.log(`Updated ${s.count} statuses → P1`);

    const ss = await db.ticketSubStatus.updateMany({ where: { pipelineId: null }, data: { pipelineId: "P1" } });
    console.log(`Updated ${ss.count} sub-statuses → P1`);

    const t = await db.ticket.updateMany({ where: { pipelineId: null }, data: { pipelineId: "P1" } });
    console.log(`Updated ${t.count} tickets → P1`);
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(async () => { await pool.end(); });
