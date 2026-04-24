import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL?.replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 1 });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as never);

// ─── Pipeline definitions ──────────────────────────────────────────────────

const PIPELINES = [
    {
        id: "P2",
        name: "customer-support",
        label: "Customer Support",
        description: "General customer support tickets not related to repairs",
        color: "bg-teal-100 text-teal-700",
        order: 2,
        statuses: [
            { id: "S10", label: "New Request",      color: "bg-gray-100 text-gray-600",   order: 1, isEntryPoint: true,  isTerminal: false },
            { id: "S11", label: "In Triage",         color: "bg-yellow-100 text-yellow-700", order: 2, isEntryPoint: false, isTerminal: false },
            { id: "S12", label: "Assigned",          color: "bg-blue-100 text-blue-600",   order: 3, isEntryPoint: false, isTerminal: false },
            { id: "S13", label: "In Progress",       color: "bg-indigo-100 text-indigo-600", order: 4, isEntryPoint: false, isTerminal: false },
            { id: "S14", label: "Pending Customer",  color: "bg-orange-100 text-orange-600", order: 5, isEntryPoint: false, isTerminal: false },
            { id: "S15", label: "Resolved",          color: "bg-green-100 text-green-600", order: 6, isEntryPoint: false, isTerminal: false },
            { id: "S16", label: "Closed",            color: "bg-gray-100 text-gray-400",   order: 7, isEntryPoint: false, isTerminal: true  },
        ],
    },
    {
        id: "P3",
        name: "sales",
        label: "Sales",
        description: "Sales pipeline for new customers and upsell opportunities",
        color: "bg-green-100 text-green-700",
        order: 3,
        statuses: [
            { id: "S17", label: "Lead",           color: "bg-gray-100 text-gray-600",    order: 1, isEntryPoint: true,  isTerminal: false },
            { id: "S18", label: "Contacted",      color: "bg-blue-100 text-blue-600",    order: 2, isEntryPoint: false, isTerminal: false },
            { id: "S19", label: "Qualified",      color: "bg-teal-100 text-teal-600",    order: 3, isEntryPoint: false, isTerminal: false },
            { id: "S20", label: "Proposal Sent",  color: "bg-yellow-100 text-yellow-700", order: 4, isEntryPoint: false, isTerminal: false },
            { id: "S21", label: "Negotiation",    color: "bg-orange-100 text-orange-600", order: 5, isEntryPoint: false, isTerminal: false },
            { id: "S22", label: "Won",            color: "bg-green-100 text-green-700",  order: 6, isEntryPoint: false, isTerminal: true  },
            { id: "S23", label: "Lost",           color: "bg-red-100 text-red-600",      order: 7, isEntryPoint: false, isTerminal: true  },
        ],
    },
    {
        id: "P4",
        name: "internal-management",
        label: "Internal Management",
        description: "Internal tasks, HR, admin, and operational workflows",
        color: "bg-purple-100 text-purple-700",
        order: 4,
        statuses: [
            { id: "S24", label: "Open",        color: "bg-gray-100 text-gray-600",    order: 1, isEntryPoint: true,  isTerminal: false },
            { id: "S25", label: "In Review",   color: "bg-yellow-100 text-yellow-700", order: 2, isEntryPoint: false, isTerminal: false },
            { id: "S26", label: "In Progress", color: "bg-blue-100 text-blue-600",    order: 3, isEntryPoint: false, isTerminal: false },
            { id: "S27", label: "On Hold",     color: "bg-orange-100 text-orange-600", order: 4, isEntryPoint: false, isTerminal: false },
            { id: "S28", label: "Done",        color: "bg-green-100 text-green-600",  order: 5, isEntryPoint: false, isTerminal: true  },
        ],
    },
    {
        id: "P5",
        name: "marketing",
        label: "Marketing",
        description: "Marketing campaigns, content, and outreach initiatives",
        color: "bg-pink-100 text-pink-700",
        order: 5,
        statuses: [
            { id: "S29", label: "Idea",          color: "bg-gray-100 text-gray-600",    order: 1, isEntryPoint: true,  isTerminal: false },
            { id: "S30", label: "Planning",      color: "bg-yellow-100 text-yellow-700", order: 2, isEntryPoint: false, isTerminal: false },
            { id: "S31", label: "In Execution",  color: "bg-blue-100 text-blue-600",    order: 3, isEntryPoint: false, isTerminal: false },
            { id: "S32", label: "Under Review",  color: "bg-orange-100 text-orange-600", order: 4, isEntryPoint: false, isTerminal: false },
            { id: "S33", label: "Live",          color: "bg-teal-100 text-teal-600",    order: 5, isEntryPoint: false, isTerminal: false },
            { id: "S34", label: "Completed",     color: "bg-green-100 text-green-600",  order: 6, isEntryPoint: false, isTerminal: true  },
        ],
    },
];

// ─── Seed ──────────────────────────────────────────────────────────────────

async function main() {
    const db = prisma as unknown as {
        pipeline: {
            upsert: (args: unknown) => Promise<{ id: string; label: string }>;
        };
        ticketStatus: {
            upsert: (args: unknown) => Promise<{ id: string }>;
        };
    };

    for (const p of PIPELINES) {
        await db.pipeline.upsert({
            where: { id: p.id },
            update: { label: p.label, description: p.description, color: p.color, order: p.order },
            create: {
                id: p.id,
                name: p.name,
                label: p.label,
                description: p.description,
                color: p.color,
                isDefault: false,
                isActive: true,
                order: p.order,
            },
        });
        console.log(`✓ Pipeline ${p.id} — ${p.label}`);

        for (const s of p.statuses) {
            await db.ticketStatus.upsert({
                where: { id: s.id },
                update: {
                    label: s.label,
                    color: s.color,
                    order: s.order,
                    isTerminal: s.isTerminal,
                    isEntryPoint: s.isEntryPoint,
                    pipelineId: p.id,
                },
                create: {
                    id: s.id,
                    label: s.label,
                    color: s.color,
                    order: s.order,
                    isTerminal: s.isTerminal,
                    isEntryPoint: s.isEntryPoint,
                    allowedRoles: [],
                    notifyRoles: [],
                    pipelineId: p.id,
                },
            });
            console.log(`  ✓ Status ${s.id} — ${s.label}${s.isEntryPoint ? " ★" : ""}${s.isTerminal ? " [terminal]" : ""}`);
        }
    }

    console.log("\nDone. All business pipelines seeded.");
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(async () => { await pool.end(); });
