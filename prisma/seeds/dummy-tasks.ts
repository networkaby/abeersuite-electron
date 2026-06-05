// DUMMY DATA — demo internal-management tasks on the Administration work board.
// Seeds a handful of Task rows across the P4 (internal-management) pipeline stages
// so the board at /office/administration shows realistic content in dev.
//
// Run: pnpm seed:dummy-tasks  (npx tsx prisma/seeds/dummy-tasks.ts)
//
// Requires bootstrap-seed.ts (P4 pipeline + stages S24–S28, admin user) to have run.
// `pnpm seed:hard-clean` wipes Task / TaskComment rows (they're transactional).

import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
const pool = new Pool({ connectionString: rawUrl, ssl: { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const PIPELINE_ID = "P4";

// status = a TicketStatus id on P4: S24 Open · S25 In Review · S26 In Progress · S27 On Hold · S28 Done
const DEMO_TASKS = [
    { title: "Renew shop trade license", description: "Annual renewal due at the municipal office.", category: "Compliance", priority: "HIGH" as const, status: "S24" },
    { title: "File monthly GST return (GSTR-3B)", description: "Reconcile sales + ITC before filing.", category: "Finance", priority: "URGENT" as const, status: "S24" },
    { title: "Hire a junior repair technician", description: "Shortlist CVs and schedule interviews.", category: "HR", priority: "MEDIUM" as const, status: "S25" },
    { title: "Fix the showroom air conditioner", description: "Cooling weak — call AMC vendor.", category: "Facilities", priority: "MEDIUM" as const, status: "S26" },
    { title: "Negotiate new courier rates", description: "Compare quotes from two providers.", category: "Operations", priority: "LOW" as const, status: "S27" },
    { title: "Update staff attendance policy", description: "Drafted and circulated to managers.", category: "HR", priority: "LOW" as const, status: "S28" },
] as const;

async function main() {
    console.log("\n⚠️  DUMMY DATA — demo Administration work-board tasks. DO NOT run in production.\n");

    const admin = await prisma.user.findFirst({
        where: { email: "admin@networkservice.in" },
        select: {
            id: true,
            name: true,
            avatarUrl: true,
            userPositions: { take: 1, select: { position: { select: { id: true, title: true } } } },
        },
    });
    if (!admin) {
        console.error("✗ admin user not found — run `pnpm prisma db seed` first.");
        process.exit(1);
    }

    // Actor snapshot (frozen JSON, no User FK) — matches TaskActor in
    // src/modules/administration/lib/types.ts.
    const adminPos = admin.userPositions[0]?.position ?? null;
    const createdBy = {
        userId: admin.id,
        userName: admin.name,
        avatarUrl: admin.avatarUrl ?? null,
        positionId: adminPos?.id ?? null,
        positionTitle: adminPos?.title ?? null,
    };

    // Tasks are owned by Positions (seats). Spread across whatever seats exist.
    const positions = await prisma.position.findMany({ select: { id: true }, orderBy: { title: "asc" } });

    console.log(`[1/1] Creating ${DEMO_TASKS.length} tasks on pipeline ${PIPELINE_ID}…`);
    let i = 0;
    for (const t of DEMO_TASKS) {
        const assignedPositionId = positions.length ? positions[i % positions.length].id : null;
        await prisma.task.create({
            data: {
                title: t.title,
                description: t.description,
                category: t.category,
                priority: t.priority,
                pipelineId: PIPELINE_ID,
                status: t.status,
                assignedPositionId,
                createdBy,
                completedAt: t.status === "S28" ? new Date() : null,
            },
        });
        console.log(`  + [${t.status}] ${t.title}`);
        i++;
    }

    console.log(`\n✅ Seeded ${DEMO_TASKS.length} demo tasks. Open /office/administration to view the board.`);
    console.log("   Run pnpm seed:hard-clean to remove them.\n");
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
