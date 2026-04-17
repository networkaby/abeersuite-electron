import { PrismaClient } from './generated/prisma/client';
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
const pool = new Pool({ connectionString: rawUrl, ssl: { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    console.log("Seeding...");

    // ── Ticket Statuses ───────────────────────────────────────────────────────
    await prisma.ticketStatus.createMany({
        data: [
            { id: "S1", label: "Received",        color: "bg-gray-100 text-gray-600",     order: 1 },
            { id: "S2", label: "Diagnosing",      color: "bg-yellow-100 text-yellow-700", order: 2 },
            { id: "S3", label: "Repairing",       color: "bg-blue-100 text-blue-700",     order: 3 },
            { id: "S4", label: "Escalated",       color: "bg-orange-100 text-orange-700", order: 4 },
            { id: "S5", label: "Received Back",   color: "bg-purple-100 text-purple-700", order: 5 },
            { id: "S6", label: "Ready",           color: "bg-green-100 text-green-700",   order: 6 },
            { id: "S7", label: "Returned",        color: "bg-gray-200 text-gray-500",     order: 7, isTerminal: true },
            { id: "S8", label: "Closed — No Fix", color: "bg-red-100 text-red-600",       order: 8, isTerminal: true },
            { id: "S9", label: "Cancelled",       color: "bg-gray-100 text-gray-400",     order: 9, isTerminal: true },
        ],
        skipDuplicates: true,
    });

    // ── Status Transitions ────────────────────────────────────────────────────
    await prisma.statusTransition.createMany({
        data: [
            { fromStatusId: "S1", toStatusId: "S2" },
            { fromStatusId: "S1", toStatusId: "S9" }, // cancel before diagnosis
            { fromStatusId: "S2", toStatusId: "S3" },
            { fromStatusId: "S2", toStatusId: "S4" },
            { fromStatusId: "S2", toStatusId: "S8" }, // BER at diagnosis
            { fromStatusId: "S2", toStatusId: "S9" }, // cancel during diagnosis
            { fromStatusId: "S3", toStatusId: "S4" },
            { fromStatusId: "S3", toStatusId: "S6" },
            { fromStatusId: "S3", toStatusId: "S8" }, // BER found during repair
            { fromStatusId: "S4", toStatusId: "S5" },
            { fromStatusId: "S5", toStatusId: "S3" },
            { fromStatusId: "S5", toStatusId: "S6" },
            { fromStatusId: "S6", toStatusId: "S7" },
            { fromStatusId: "S7", toStatusId: "S1" }, // reopen
            { fromStatusId: "S8", toStatusId: "S1" }, // reopen after no-fix
        ],
        skipDuplicates: true,
    });

    // ── Sub-Statuses ──────────────────────────────────────────────────────────
    // Groups: customer_comm | approval | parts | qc | escalated | ready | no_fix
    await prisma.ticketSubStatus.createMany({
        data: [
            // ── Group A: Customer Communication (S2, S3, S6) ─────────────────
            {
                id: "SS1", label: "Waiting: Customer Info", order: 1,
                color: "bg-yellow-50 text-yellow-700",
                group: "customer_comm",
                applicableStatusIds: ["S2", "S3", "S6"],
                allowedRoles: ["R1", "R2"],        // Technician / Admin
                notifyRoles: ["R3"],               // → Front Desk
            },
            {
                id: "SS2", label: "Waiting: Customer to Bring Item", order: 2,
                color: "bg-yellow-50 text-yellow-700",
                group: "customer_comm",
                applicableStatusIds: ["S2", "S3"],
                allowedRoles: ["R1", "R2"],
                notifyRoles: ["R3"],               // → Front Desk
            },
            {
                id: "SS3", label: "Customer Unreachable", order: 3,
                color: "bg-red-50 text-red-600",
                group: "customer_comm",
                applicableStatusIds: ["S2", "S3", "S6"],
                allowedRoles: ["R1", "R3"],        // Front Desk / Admin
                notifyRoles: ["R1"],               // → Admin/Manager
            },
            {
                id: "SS4", label: "Customer Responded", order: 4,
                color: "bg-green-50 text-green-700",
                group: "customer_comm",
                applicableStatusIds: ["S2", "S3", "S6"],
                allowedRoles: ["R1", "R3"],        // Front Desk / Admin
                notifyRoles: ["R2"],               // → Technician
            },

            // ── Group B: Quote & Approval (S2) ────────────────────────────────
            {
                id: "SS5", label: "Quote Prepared", order: 5,
                color: "bg-blue-50 text-blue-600",
                group: "approval",
                applicableStatusIds: ["S2"],
                allowedRoles: ["R1", "R2"],
                notifyRoles: ["R3"],               // → Front Desk (to call customer)
            },
            {
                id: "SS6", label: "Awaiting Customer Approval", order: 6,
                color: "bg-yellow-50 text-yellow-700",
                group: "approval",
                applicableStatusIds: ["S2"],
                allowedRoles: ["R1", "R3"],
                notifyRoles: [],
            },
            {
                id: "SS7", label: "Awaiting Insurance / Warranty", order: 7,
                color: "bg-purple-50 text-purple-600",
                group: "approval",
                applicableStatusIds: ["S2"],
                allowedRoles: ["R1", "R3"],
                notifyRoles: ["R1"],               // → Admin
            },
            {
                id: "SS8", label: "Customer Approved", order: 8,
                color: "bg-green-50 text-green-700",
                group: "approval",
                applicableStatusIds: ["S2"],
                allowedRoles: ["R1", "R3"],
                notifyRoles: ["R2"],               // → Technician
                triggerStatusId: "S3",             // → auto-move to Repairing
            },
            {
                id: "SS9", label: "Customer Declined", order: 9,
                color: "bg-red-50 text-red-600",
                group: "approval",
                applicableStatusIds: ["S2"],
                allowedRoles: ["R1", "R3"],
                notifyRoles: ["R2"],               // → Technician
                triggerStatusId: "S8",             // → auto-move to Closed — No Fix
            },

            // ── Group C: Parts (S3) ───────────────────────────────────────────
            {
                id: "SS10", label: "Awaiting Parts", order: 10,
                color: "bg-orange-50 text-orange-600",
                group: "parts",
                applicableStatusIds: ["S3"],
                allowedRoles: ["R1", "R2"],
                notifyRoles: ["R1"],               // → Admin (to order)
            },
            {
                id: "SS11", label: "Parts Delayed", order: 11,
                color: "bg-orange-50 text-orange-600",
                group: "parts",
                applicableStatusIds: ["S3"],
                allowedRoles: ["R1"],
                notifyRoles: ["R2", "R3"],         // → Technician + Front Desk
            },
            {
                id: "SS12", label: "Parts Issue", order: 12,
                color: "bg-red-50 text-red-600",
                group: "parts",
                applicableStatusIds: ["S3"],
                allowedRoles: ["R1"],
                notifyRoles: ["R2", "R3"],         // wrong/unavailable — customer decision
            },
            {
                id: "SS13", label: "Parts Arrived", order: 13,
                color: "bg-green-50 text-green-700",
                group: "parts",
                applicableStatusIds: ["S3"],
                allowedRoles: ["R1"],
                notifyRoles: ["R2"],               // → Technician (back to work)
            },

            // ── Group D: Quality Check (S3) ───────────────────────────────────
            {
                id: "SS14", label: "QC In Progress", order: 14,
                color: "bg-blue-50 text-blue-600",
                group: "qc",
                applicableStatusIds: ["S3"],
                allowedRoles: ["R1", "R2"],
                notifyRoles: [],
            },
            {
                id: "SS15", label: "QC Passed", order: 15,
                color: "bg-green-50 text-green-700",
                group: "qc",
                applicableStatusIds: ["S3"],
                allowedRoles: ["R1", "R2"],
                notifyRoles: ["R3"],               // → Front Desk (notify customer)
                triggerStatusId: "S6",             // → auto-move to Ready
            },
            {
                id: "SS16", label: "QC Failed", order: 16,
                color: "bg-red-50 text-red-600",
                group: "qc",
                applicableStatusIds: ["S3"],
                allowedRoles: ["R1", "R2"],
                notifyRoles: [],                   // stays in Repairing
            },
            {
                id: "SS17", label: "Partial Fix", order: 17,
                color: "bg-yellow-50 text-yellow-700",
                group: "qc",
                applicableStatusIds: ["S3"],
                allowedRoles: ["R1", "R2"],
                notifyRoles: ["R3"],               // → Front Desk (discuss with customer)
            },

            // ── Group E: Escalated — Engineer Visit (S4) ─────────────────────
            {
                id: "SS18", label: "Engineer Visit Requested", order: 18,
                color: "bg-orange-50 text-orange-600",
                group: "escalated",
                applicableStatusIds: ["S4"],
                allowedRoles: ["R1", "R2"],
                notifyRoles: ["R1"],               // → Admin to arrange
            },
            {
                id: "SS19", label: "Engineer Visit Scheduled", order: 19,
                color: "bg-blue-50 text-blue-600",
                group: "escalated",
                applicableStatusIds: ["S4"],
                allowedRoles: ["R1"],
                notifyRoles: ["R2"],               // → Technician
            },
            {
                id: "SS20", label: "Engineer On-Site", order: 20,
                color: "bg-blue-50 text-blue-600",
                group: "escalated",
                applicableStatusIds: ["S4"],
                allowedRoles: ["R1"],
                notifyRoles: ["R2"],
            },
            {
                id: "SS21", label: "Engineer Work Complete", order: 21,
                color: "bg-green-50 text-green-700",
                group: "escalated",
                applicableStatusIds: ["S4"],
                allowedRoles: ["R1", "R2"],
                notifyRoles: ["R1"],
                triggerStatusId: "S3",             // → back to Repairing
            },

            // ── Group E: Escalated — Service Centre (S4) ─────────────────────
            {
                id: "SS22", label: "Pending Despatch", order: 22,
                color: "bg-orange-50 text-orange-700",
                group: "escalated",
                applicableStatusIds: ["S4"],
                allowedRoles: ["R1", "R2"],
                notifyRoles: ["R4"],               // → Despatch
            },
            {
                id: "SS23", label: "Dispatched", order: 23,
                color: "bg-blue-50 text-blue-600",
                group: "escalated",
                applicableStatusIds: ["S4"],
                allowedRoles: ["R1", "R4"],
                notifyRoles: ["R1"],               // → Admin (courier logged)
            },
            {
                id: "SS24", label: "Received by Service Centre", order: 24,
                color: "bg-blue-50 text-blue-600",
                group: "escalated",
                applicableStatusIds: ["S4"],
                allowedRoles: ["R1", "R4"],
                notifyRoles: [],
            },
            {
                id: "SS25", label: "Being Repaired", order: 25,
                color: "bg-blue-50 text-blue-600",
                group: "escalated",
                applicableStatusIds: ["S4"],
                allowedRoles: ["R1", "R4"],
                notifyRoles: [],
            },
            {
                id: "SS26", label: "Service Centre Delayed", order: 26,
                color: "bg-red-50 text-red-600",
                group: "escalated",
                applicableStatusIds: ["S4"],
                allowedRoles: ["R1", "R4"],
                notifyRoles: ["R1"],               // → Admin
            },
            {
                id: "SS27", label: "Shipped Back to Us", order: 27,
                color: "bg-purple-50 text-purple-600",
                group: "escalated",
                applicableStatusIds: ["S4"],
                allowedRoles: ["R1", "R4"],
                notifyRoles: [],
            },
            {
                id: "SS28", label: "Received by Us", order: 28,
                color: "bg-green-50 text-green-700",
                group: "escalated",
                applicableStatusIds: ["S4"],
                allowedRoles: ["R1", "R4"],
                notifyRoles: ["R2"],               // → Technician
                triggerStatusId: "S5",             // → auto-move to Received Back
            },

            // ── Group F: Ready for Collection (S6) ───────────────────────────
            {
                id: "SS29", label: "Customer Notified", order: 29,
                color: "bg-green-50 text-green-700",
                group: "ready",
                applicableStatusIds: ["S6"],
                allowedRoles: ["R1", "R3"],
                notifyRoles: [],
            },
            {
                id: "SS30", label: "Reminder Sent", order: 30,
                color: "bg-yellow-50 text-yellow-700",
                group: "ready",
                applicableStatusIds: ["S6"],
                allowedRoles: ["R1", "R3"],
                notifyRoles: [],
            },
            {
                id: "SS31", label: "Uncollected — Action Needed", order: 31,
                color: "bg-red-50 text-red-600",
                group: "ready",
                applicableStatusIds: ["S6"],
                allowedRoles: ["R1", "R3"],
                notifyRoles: ["R1"],               // → Admin
            },

            // ── Group G: No Fix (S8) ──────────────────────────────────────────
            {
                id: "SS32", label: "Beyond Economical Repair", order: 32,
                color: "bg-red-50 text-red-600",
                group: "no_fix",
                applicableStatusIds: ["S8"],
                allowedRoles: ["R1", "R2"],
                notifyRoles: ["R3"],               // → Front Desk (inform customer)
            },
            {
                id: "SS33", label: "Customer Informed", order: 33,
                color: "bg-gray-50 text-gray-600",
                group: "no_fix",
                applicableStatusIds: ["S8"],
                allowedRoles: ["R1", "R3"],
                notifyRoles: [],
            },
            {
                id: "SS34", label: "Collecting Unrepaired", order: 34,
                color: "bg-gray-50 text-gray-600",
                group: "no_fix",
                applicableStatusIds: ["S8"],
                allowedRoles: ["R1", "R3"],
                notifyRoles: [],
                triggerStatusId: "S7",             // → Returned
            },
            {
                id: "SS35", label: "Scrapped with Consent", order: 35,
                color: "bg-gray-50 text-gray-600",
                group: "no_fix",
                applicableStatusIds: ["S8"],
                allowedRoles: ["R1", "R3"],
                notifyRoles: ["R1"],               // → Admin (for records)
            },
        ],
        skipDuplicates: true,
    });

    // ── Priorities ────────────────────────────────────────────────────────────
    await prisma.priority.createMany({
        data: [
            { id: "P1", label: "Low",    color: "bg-gray-100 text-gray-500",     order: 1 },
            { id: "P2", label: "Normal", color: "bg-blue-50 text-blue-500",      order: 2 },
            { id: "P3", label: "High",   color: "bg-orange-100 text-orange-500", order: 3 },
            { id: "P4", label: "Urgent", color: "bg-red-100 text-red-600",       order: 4 },
        ],
        skipDuplicates: true,
    });

    // ── Roles ─────────────────────────────────────────────────────────────────
    await prisma.role.createMany({
        data: [
            { id: "R1", label: "Admin",      color: "bg-red-100 text-red-600" },
            { id: "R2", label: "Technician", color: "bg-blue-100 text-blue-600" },
            { id: "R3", label: "Front Desk", color: "bg-green-100 text-green-600" },
            { id: "R4", label: "Despatch",   color: "bg-purple-100 text-purple-600" },
        ],
        skipDuplicates: true,
    });

    // ── Admin User ────────────────────────────────────────────────────────────
    const password = await bcrypt.hash("admin123", 10);
    await prisma.user.upsert({
        where: { email: "admin@example.com" },
        update: {},
        create: {
            name: "Admin",
            email: "admin@example.com",
            password,
            role: "R1",
        },
    });

    console.log("Done.");
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
