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
            { id: "S1", label: "Received",      color: "bg-gray-100 text-gray-600",    order: 1 },
            { id: "S2", label: "Diagnosing",    color: "bg-yellow-100 text-yellow-700", order: 2 },
            { id: "S3", label: "Repairing",     color: "bg-blue-100 text-blue-700",    order: 3 },
            { id: "S4", label: "Escalated",     color: "bg-orange-100 text-orange-700", order: 4 },
            { id: "S5", label: "Received Back", color: "bg-purple-100 text-purple-700", order: 5 },
            { id: "S6", label: "Ready",         color: "bg-green-100 text-green-700",  order: 6 },
            { id: "S7", label: "Returned",      color: "bg-gray-200 text-gray-500",    order: 7 },
        ],
        skipDuplicates: true,
    });

    // ── Status Transitions ────────────────────────────────────────────────────
    await prisma.statusTransition.createMany({
        data: [
            { fromStatusId: "S1", toStatusId: "S2" },
            { fromStatusId: "S2", toStatusId: "S3" },
            { fromStatusId: "S2", toStatusId: "S4" },
            { fromStatusId: "S3", toStatusId: "S4" },
            { fromStatusId: "S3", toStatusId: "S6" },
            { fromStatusId: "S4", toStatusId: "S5" },
            { fromStatusId: "S5", toStatusId: "S3" },
            { fromStatusId: "S5", toStatusId: "S6" },
            { fromStatusId: "S6", toStatusId: "S7" },
            { fromStatusId: "S7", toStatusId: "S1" },
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
