// DUMMY DATA — demo CRM leads/deals on the P6 "crm-leads" pipeline.
// Seeds a handful of CrmLead rows across the sales stages (S35 Lead … S41 Lost),
// assigned to positions (seats), with deal values, follow-up dates, and a few
// activities, so the board at /office/crm shows realistic content in dev.
//
// Run: pnpm seed:dummy-crm-leads
//
// Requires bootstrap-seed.ts (P6 pipeline + stages S35–S41, admin user, positions).
// `pnpm seed:hard-clean` wipes CrmLead / CrmLeadActivity rows (transactional).

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

const PIPELINE_ID = "P6";
const DAY = 24 * 60 * 60 * 1000;

// status: S35 Lead · S36 Contacted · S37 Qualified · S38 Proposal Sent · S39 Negotiation · S40 Won · S41 Lost
const DEMO_LEADS = [
    { title: "NVR upgrade — Lalit Hotel", contactName: "Ravi", phone: "9864000011", companyName: "Lalit Hotel", valuePaise: 3000000, source: "Walk-in", priority: "MEDIUM" as const, status: "S35", followInDays: 1 },
    { title: "Annual AMC renewal — Green Mart", contactName: "Bhaskar", phone: "9864000022", companyName: "Green Mart", valuePaise: 1200000, source: "Phone", priority: "LOW" as const, status: "S36", followInDays: 3 },
    { title: "16-ch CCTV — Sharma Stores", contactName: "Sharma", phone: "9864000033", companyName: "Sharma Stores", valuePaise: 4500000, source: "Referral", priority: "HIGH" as const, status: "S37", followInDays: 2 },
    { title: "Office PCs (10) — Apex Traders", contactName: "Nabajit", phone: "9864000044", companyName: "Apex Traders", valuePaise: 6500000, source: "Website", priority: "MEDIUM" as const, status: "S38", followInDays: 5 },
    { title: "Biometric access — City Hospital", contactName: "Dr. Das", phone: "9864000055", companyName: "City Hospital", valuePaise: 8000000, source: "Exhibition", priority: "URGENT" as const, status: "S39", followInDays: -1 },
    { title: "Laptop bulk — Sunrise School", contactName: "Principal", phone: "9864000066", companyName: "Sunrise School", valuePaise: 9500000, source: "Referral", priority: "HIGH" as const, status: "S40", followInDays: null },
    { title: "CCTV quote — Roy Brothers", contactName: "Roy", phone: "9864000077", companyName: "Roy Brothers", valuePaise: 2000000, source: "Website", priority: "LOW" as const, status: "S41", followInDays: null, lostReason: "Chose a cheaper vendor" },
] as const;

async function main() {
    console.log("\n⚠️  DUMMY DATA — demo CRM leads. DO NOT run in production.\n");

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
    const adminPos = admin.userPositions[0]?.position ?? null;
    const createdBy = {
        userId: admin.id,
        userName: admin.name,
        avatarUrl: admin.avatarUrl ?? null,
        positionId: adminPos?.id ?? null,
        positionTitle: adminPos?.title ?? null,
    };

    const positions = await prisma.position.findMany({ select: { id: true }, orderBy: { title: "asc" } });
    const now = Date.now();

    console.log(`[1/1] Creating ${DEMO_LEADS.length} leads on pipeline ${PIPELINE_ID}…`);
    let i = 0;
    for (const l of DEMO_LEADS) {
        const assignedPositionId = positions.length ? positions[i % positions.length].id : null;
        const isTerminal = l.status === "S40" || l.status === "S41";
        const lead = await prisma.crmLead.create({
            data: {
                pipelineId: PIPELINE_ID,
                status: l.status,
                title: l.title,
                contactName: l.contactName,
                phone: l.phone,
                companyName: l.companyName,
                valuePaise: l.valuePaise,
                source: l.source,
                priority: l.priority,
                nextFollowUpAt: l.followInDays != null ? new Date(now + l.followInDays * DAY) : null,
                closedAt: isTerminal ? new Date() : null,
                lostReason: "lostReason" in l ? l.lostReason : null,
                assignedPositionId,
                createdBy,
            },
            select: { id: true },
        });

        // A couple of activities on the active deals.
        if (l.status === "S37" || l.status === "S39") {
            await prisma.crmLeadActivity.createMany({
                data: [
                    { leadId: lead.id, author: createdBy, kind: "CALL", body: "Spoke with the contact; sending a quote." },
                    { leadId: lead.id, author: createdBy, kind: "TASK", body: "Follow up on the quote", dueAt: new Date(now + 2 * DAY) },
                ],
            });
        }
        console.log(`  + [${l.status}] ${l.title}`);
        i++;
    }

    console.log(`\n✅ Seeded ${DEMO_LEADS.length} demo leads. Open /office/crm to view the board.`);
    console.log("   Run pnpm seed:hard-clean to remove them.\n");
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
