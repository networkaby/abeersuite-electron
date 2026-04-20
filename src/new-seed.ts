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

// ── PHASE 1 PERMISSIONS ─────────────────────────────────────────────────────
const PERMISSIONS = [
    { id: "admin:bypass",          label: "Admin bypass all checks",     module: "core" },
    { id: "tickets:status:set",    label: "Set ticket status",           module: "service" },
    { id: "tickets:substatus:set", label: "Set ticket sub-status",       module: "service" },
    { id: "tickets:create",        label: "Create tickets",              module: "service" },
    { id: "warranty:convert",      label: "Convert warranty status",     module: "service" },
    { id: "users:manage",          label: "Create/edit/delete users",    module: "admin" },
    { id: "roles:manage",          label: "Create/edit custom roles",    module: "admin" },
    { id: "settings:statuses",     label: "Manage ticket statuses",      module: "admin" },
];

const ROLE_PERMISSIONS: Record<string, string[]> = {
    R1: PERMISSIONS.map(p => p.id),
    R2: [
        "tickets:status:set", "tickets:substatus:set", "tickets:create",
        "warranty:convert",
    ],
    R3: [
        "tickets:status:set", "tickets:substatus:set", "tickets:create",
    ],
    R4: [
        "tickets:substatus:set",
    ],
};

// ── ASSIGNMENT PERMISSIONS ──────────────────────────────────────────────────
const ASSIGNMENT_PERMISSIONS = [
    {
        id: "tickets:assign",
        label: "Assign Tickets",
        description: "Claim, pass, or reject ticket primary ownership",
        module: "tickets",
    },
    {
        id: "tickets:manage-participants",
        label: "Manage Ticket Participants",
        description: "Add or remove secondary owners on tickets",
        module: "tickets",
    },
];

const ASSIGNMENT_ROLE_PERMISSIONS = [
    // tickets:assign → R1, R2, R3, R4
    { roleId: "R1", permissionId: "tickets:assign" },
    { roleId: "R2", permissionId: "tickets:assign" },
    { roleId: "R3", permissionId: "tickets:assign" },
    { roleId: "R4", permissionId: "tickets:assign" },
    // tickets:manage-participants → R1, R2
    { roleId: "R1", permissionId: "tickets:manage-participants" },
    { roleId: "R2", permissionId: "tickets:manage-participants" },
];

// ── TRIGGER MAPS ────────────────────────────────────────────────────────────
const triggerMaps: { id: string; triggerMap: Record<string, string> }[] = [
    { id: "SS8",  triggerMap: { S2: "S3" } },
    { id: "SS9",  triggerMap: { S2: "S8" } },
    { id: "SS15", triggerMap: { S3: "S6" } },
    { id: "SS21", triggerMap: { S4: "S3" } },
    { id: "SS28", triggerMap: { S4: "S5" } },
    { id: "SS34", triggerMap: { S8: "S7" } },
];

async function main() {
    console.log("🌱 Starting comprehensive seed...");

    // ═══════════════════════════════════════════════════════════════════════
    // 1. BASE SEED (from seed.ts)
    // ═══════════════════════════════════════════════════════════════════════
    console.log("\n📋 Seeding base data...");

    // ── Ticket Statuses ─────────────────────────────────────────────────────
    await prisma.ticketStatus.createMany({
        data: [
            { id: "S1", label: "Received",        color: "bg-gray-100 text-gray-600",     order: 1, allowedRoles: [], notifyRoles: [] },
            { id: "S2", label: "Diagnosing",      color: "bg-yellow-100 text-yellow-700", order: 2, allowedRoles: [], notifyRoles: [] },
            { id: "S3", label: "Repairing",       color: "bg-blue-100 text-blue-700",     order: 3, allowedRoles: [], notifyRoles: [] },
            { id: "S4", label: "Escalated",       color: "bg-orange-100 text-orange-700", order: 4, allowedRoles: [], notifyRoles: [] },
            { id: "S5", label: "Received Back",   color: "bg-purple-100 text-purple-700", order: 5, allowedRoles: [], notifyRoles: [] },
            { id: "S6", label: "Ready",           color: "bg-green-100 text-green-700",   order: 6, allowedRoles: [], notifyRoles: [] },
            { id: "S7", label: "Returned",        color: "bg-gray-200 text-gray-500",     order: 7, isTerminal: true, allowedRoles: [], notifyRoles: [] },
            { id: "S8", label: "Closed — No Fix", color: "bg-red-100 text-red-600",       order: 8, isTerminal: true, allowedRoles: [], notifyRoles: [] },
            { id: "S9", label: "Cancelled",       color: "bg-gray-100 text-gray-400",     order: 9, isTerminal: true, allowedRoles: [], notifyRoles: [] },
        ],
        skipDuplicates: true,
    });
    console.log("  ✓ Ticket statuses");

    // ── Status Transitions ─────────────────────────────────────────────────
    await prisma.statusTransition.createMany({
        data: [
            { fromStatusId: "S1", toStatusId: "S2" },
            { fromStatusId: "S1", toStatusId: "S9" },
            { fromStatusId: "S2", toStatusId: "S3" },
            { fromStatusId: "S2", toStatusId: "S4" },
            { fromStatusId: "S2", toStatusId: "S8" },
            { fromStatusId: "S2", toStatusId: "S9" },
            { fromStatusId: "S3", toStatusId: "S4" },
            { fromStatusId: "S3", toStatusId: "S6" },
            { fromStatusId: "S3", toStatusId: "S8" },
            { fromStatusId: "S4", toStatusId: "S5" },
            { fromStatusId: "S5", toStatusId: "S3" },
            { fromStatusId: "S5", toStatusId: "S6" },
            { fromStatusId: "S6", toStatusId: "S7" },
            { fromStatusId: "S7", toStatusId: "S1" },
            { fromStatusId: "S8", toStatusId: "S1" },
        ],
        skipDuplicates: true,
    });
    console.log("  ✓ Status transitions");

    // ── Sub-Statuses ────────────────────────────────────────────────────────
    await prisma.ticketSubStatus.createMany({
        data: [
            { id: "SS1", label: "Waiting: Customer Info", order: 1, color: "bg-yellow-50 text-yellow-700", group: "customer_comm", applicableStatusIds: ["S2", "S3", "S6"], allowedRoles: ["R1", "R2"], notifyRoles: ["R3"] },
            { id: "SS2", label: "Waiting: Customer to Bring Item", order: 2, color: "bg-yellow-50 text-yellow-700", group: "customer_comm", applicableStatusIds: ["S2", "S3"], allowedRoles: ["R1", "R2"], notifyRoles: ["R3"] },
            { id: "SS3", label: "Customer Unreachable", order: 3, color: "bg-red-50 text-red-600", group: "customer_comm", applicableStatusIds: ["S2", "S3", "S6"], allowedRoles: ["R1", "R3"], notifyRoles: ["R1"] },
            { id: "SS4", label: "Customer Responded", order: 4, color: "bg-green-50 text-green-700", group: "customer_comm", applicableStatusIds: ["S2", "S3", "S6"], allowedRoles: ["R1", "R3"], notifyRoles: ["R2"] },
            { id: "SS5", label: "Quote Prepared", order: 5, color: "bg-blue-50 text-blue-600", group: "approval", applicableStatusIds: ["S2"], allowedRoles: ["R1", "R2"], notifyRoles: ["R3"] },
            { id: "SS6", label: "Awaiting Customer Approval", order: 6, color: "bg-yellow-50 text-yellow-700", group: "approval", applicableStatusIds: ["S2"], allowedRoles: ["R1", "R3"], notifyRoles: [] },
            { id: "SS7", label: "Awaiting Insurance / Warranty", order: 7, color: "bg-purple-50 text-purple-600", group: "approval", applicableStatusIds: ["S2"], allowedRoles: ["R1", "R3"], notifyRoles: ["R1"] },
            { id: "SS8", label: "Customer Approved", order: 8, color: "bg-green-50 text-green-700", group: "approval", applicableStatusIds: ["S2"], allowedRoles: ["R1", "R3"], notifyRoles: ["R2"] },
            { id: "SS9", label: "Customer Declined", order: 9, color: "bg-red-50 text-red-600", group: "approval", applicableStatusIds: ["S2"], allowedRoles: ["R1", "R3"], notifyRoles: ["R2"] },
            { id: "SS10", label: "Awaiting Parts", order: 10, color: "bg-orange-50 text-orange-600", group: "parts", applicableStatusIds: ["S3"], allowedRoles: ["R1", "R2"], notifyRoles: ["R1"] },
            { id: "SS11", label: "Parts Delayed", order: 11, color: "bg-orange-50 text-orange-600", group: "parts", applicableStatusIds: ["S3"], allowedRoles: ["R1"], notifyRoles: ["R2", "R3"] },
            { id: "SS12", label: "Parts Issue", order: 12, color: "bg-red-50 text-red-600", group: "parts", applicableStatusIds: ["S3"], allowedRoles: ["R1"], notifyRoles: ["R2", "R3"] },
            { id: "SS13", label: "Parts Arrived", order: 13, color: "bg-green-50 text-green-700", group: "parts", applicableStatusIds: ["S3"], allowedRoles: ["R1"], notifyRoles: ["R2"] },
            { id: "SS14", label: "QC In Progress", order: 14, color: "bg-blue-50 text-blue-600", group: "qc", applicableStatusIds: ["S3"], allowedRoles: ["R1", "R2"], notifyRoles: [] },
            { id: "SS15", label: "QC Passed", order: 15, color: "bg-green-50 text-green-700", group: "qc", applicableStatusIds: ["S3"], allowedRoles: ["R1", "R2"], notifyRoles: ["R3"] },
            { id: "SS16", label: "QC Failed", order: 16, color: "bg-red-50 text-red-600", group: "qc", applicableStatusIds: ["S3"], allowedRoles: ["R1", "R2"], notifyRoles: [] },
            { id: "SS17", label: "Partial Fix", order: 17, color: "bg-yellow-50 text-yellow-700", group: "qc", applicableStatusIds: ["S3"], allowedRoles: ["R1", "R2"], notifyRoles: ["R3"] },
            { id: "SS18", label: "Engineer Visit Requested", order: 18, color: "bg-orange-50 text-orange-600", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1", "R2"], notifyRoles: ["R1"] },
            { id: "SS19", label: "Engineer Visit Scheduled", order: 19, color: "bg-blue-50 text-blue-600", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1"], notifyRoles: ["R2"] },
            { id: "SS20", label: "Engineer On-Site", order: 20, color: "bg-blue-50 text-blue-600", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1"], notifyRoles: ["R2"] },
            { id: "SS21", label: "Engineer Work Complete", order: 21, color: "bg-green-50 text-green-700", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1", "R2"], notifyRoles: ["R1"] },
            { id: "SS22", label: "Pending Despatch", order: 22, color: "bg-orange-50 text-orange-700", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1", "R2"], notifyRoles: ["R4"] },
            { id: "SS23", label: "Dispatched", order: 23, color: "bg-blue-50 text-blue-600", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1", "R4"], notifyRoles: ["R1"] },
            { id: "SS24", label: "Received by Service Centre", order: 24, color: "bg-blue-50 text-blue-600", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1", "R4"], notifyRoles: [] },
            { id: "SS25", label: "Being Repaired", order: 25, color: "bg-blue-50 text-blue-600", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1", "R4"], notifyRoles: [] },
            { id: "SS26", label: "Service Centre Delayed", order: 26, color: "bg-red-50 text-red-600", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1", "R4"], notifyRoles: ["R1"] },
            { id: "SS27", label: "Shipped Back to Us", order: 27, color: "bg-purple-50 text-purple-600", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1", "R4"], notifyRoles: [] },
            { id: "SS28", label: "Received by Us", order: 28, color: "bg-green-50 text-green-700", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1", "R4"], notifyRoles: ["R2"] },
            { id: "SS29", label: "Customer Notified", order: 29, color: "bg-green-50 text-green-700", group: "ready", applicableStatusIds: ["S6"], allowedRoles: ["R1", "R3"], notifyRoles: [] },
            { id: "SS30", label: "Reminder Sent", order: 30, color: "bg-yellow-50 text-yellow-700", group: "ready", applicableStatusIds: ["S6"], allowedRoles: ["R1", "R3"], notifyRoles: [] },
            { id: "SS31", label: "Uncollected — Action Needed", order: 31, color: "bg-red-50 text-red-600", group: "ready", applicableStatusIds: ["S6"], allowedRoles: ["R1", "R3"], notifyRoles: ["R1"] },
            { id: "SS32", label: "Beyond Economical Repair", order: 32, color: "bg-red-50 text-red-600", group: "no_fix", applicableStatusIds: ["S8"], allowedRoles: ["R1", "R2"], notifyRoles: ["R3"] },
            { id: "SS33", label: "Customer Informed", order: 33, color: "bg-gray-50 text-gray-600", group: "no_fix", applicableStatusIds: ["S8"], allowedRoles: ["R1", "R3"], notifyRoles: [] },
            { id: "SS34", label: "Collecting Unrepaired", order: 34, color: "bg-gray-50 text-gray-600", group: "no_fix", applicableStatusIds: ["S8"], allowedRoles: ["R1", "R3"], notifyRoles: [] },
            { id: "SS35", label: "Scrapped with Consent", order: 35, color: "bg-gray-50 text-gray-600", group: "no_fix", applicableStatusIds: ["S8"], allowedRoles: ["R1", "R3"], notifyRoles: ["R1"] },
        ],
        skipDuplicates: true,
    });
    console.log("  ✓ Sub-statuses");

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
    console.log("  ✓ Priorities");

    // ── Roles ─────────────────────────────────────────────────────────────────
    await prisma.role.createMany({
        data: [
            { id: "R1", label: "Admin",      color: "bg-red-100 text-red-600", isSystem: true },
            { id: "R2", label: "Technician", color: "bg-blue-100 text-blue-600", isSystem: true },
            { id: "R3", label: "Front Desk", color: "bg-green-100 text-green-600", isSystem: true },
            { id: "R4", label: "Despatch",   color: "bg-purple-100 text-purple-600", isSystem: true },
        ],
        skipDuplicates: true,
    });
    console.log("  ✓ Roles");

    // ── Admin User ──────────────────────────────────────────────────────────
    const password = await bcrypt.hash("admin123", 10);
    const admin = await prisma.user.upsert({
        where: { email: "admin@example.com" },
        update: {},
        create: {
            name: "Admin",
            email: "admin@example.com",
            password,
            role: "R1",
        },
    });
    console.log("  ✓ Admin user");

    // ── Sub-Status Transitions ────────────────────────────────────────────────
    await prisma.subStatusTransition.createMany({
        data: [
            { fromSubStatusId: null,   toSubStatusId: "SS1" },
            { fromSubStatusId: null,   toSubStatusId: "SS2" },
            { fromSubStatusId: "SS1",  toSubStatusId: "SS3" },
            { fromSubStatusId: "SS1",  toSubStatusId: "SS4" },
            { fromSubStatusId: "SS2",  toSubStatusId: "SS3" },
            { fromSubStatusId: "SS2",  toSubStatusId: "SS4" },
            { fromSubStatusId: "SS3",  toSubStatusId: "SS4" },
            { fromSubStatusId: null,   toSubStatusId: "SS5" },
            { fromSubStatusId: "SS5",  toSubStatusId: "SS6" },
            { fromSubStatusId: "SS6",  toSubStatusId: "SS7" },
            { fromSubStatusId: "SS6",  toSubStatusId: "SS8" },
            { fromSubStatusId: "SS6",  toSubStatusId: "SS9" },
            { fromSubStatusId: "SS7",  toSubStatusId: "SS8" },
            { fromSubStatusId: "SS7",  toSubStatusId: "SS9" },
            { fromSubStatusId: null,   toSubStatusId: "SS10" },
            { fromSubStatusId: "SS10", toSubStatusId: "SS11" },
            { fromSubStatusId: "SS10", toSubStatusId: "SS12" },
            { fromSubStatusId: "SS10", toSubStatusId: "SS13" },
            { fromSubStatusId: "SS11", toSubStatusId: "SS12" },
            { fromSubStatusId: "SS11", toSubStatusId: "SS13" },
            { fromSubStatusId: "SS12", toSubStatusId: "SS13" },
            { fromSubStatusId: null,   toSubStatusId: "SS14" },
            { fromSubStatusId: "SS14", toSubStatusId: "SS15" },
            { fromSubStatusId: "SS14", toSubStatusId: "SS16" },
            { fromSubStatusId: "SS14", toSubStatusId: "SS17" },
            { fromSubStatusId: "SS16", toSubStatusId: "SS14" },
            { fromSubStatusId: "SS17", toSubStatusId: "SS15" },
            { fromSubStatusId: "SS17", toSubStatusId: "SS16" },
            { fromSubStatusId: null,   toSubStatusId: "SS18" },
            { fromSubStatusId: "SS18", toSubStatusId: "SS19" },
            { fromSubStatusId: "SS19", toSubStatusId: "SS20" },
            { fromSubStatusId: "SS20", toSubStatusId: "SS21" },
            { fromSubStatusId: null,   toSubStatusId: "SS22" },
            { fromSubStatusId: "SS22", toSubStatusId: "SS23" },
            { fromSubStatusId: "SS23", toSubStatusId: "SS24" },
            { fromSubStatusId: "SS24", toSubStatusId: "SS25" },
            { fromSubStatusId: "SS25", toSubStatusId: "SS26" },
            { fromSubStatusId: "SS25", toSubStatusId: "SS27" },
            { fromSubStatusId: "SS26", toSubStatusId: "SS27" },
            { fromSubStatusId: "SS27", toSubStatusId: "SS28" },
            { fromSubStatusId: null,   toSubStatusId: "SS29" },
            { fromSubStatusId: "SS29", toSubStatusId: "SS30" },
            { fromSubStatusId: "SS30", toSubStatusId: "SS31" },
            { fromSubStatusId: null,   toSubStatusId: "SS32" },
            { fromSubStatusId: "SS32", toSubStatusId: "SS33" },
            { fromSubStatusId: "SS33", toSubStatusId: "SS34" },
            { fromSubStatusId: "SS33", toSubStatusId: "SS35" },
        ],
        skipDuplicates: true,
    });
    console.log("  ✓ Sub-status transitions");

    // ── Trigger Maps ──────────────────────────────────────────────────────────
    for (const { id, triggerMap } of triggerMaps) {
        await prisma.ticketSubStatus.update({ where: { id }, data: { triggerMap } });
    }
    console.log("  ✓ Trigger maps");

    // ── Backfill UserRole for Admin ───────────────────────────────────────────
    await prisma.userRole.upsert({
        where: { userId_roleId: { userId: admin.id, roleId: "R1" } },
        create: { userId: admin.id, roleId: "R1", isPrimary: true },
        update: {},
    });
    console.log("  ✓ User role backfill");

    // ═══════════════════════════════════════════════════════════════════════
    // 2. PHASE 1 PERMISSIONS (from seed-phase1.ts)
    // ═══════════════════════════════════════════════════════════════════════
    console.log("\n🔐 Seeding Phase 1 permissions...");

    for (const perm of PERMISSIONS) {
        await prisma.permission.upsert({
            where: { id: perm.id },
            create: perm,
            update: { label: perm.label, module: perm.module },
        });
    }
    console.log(`  ✓ ${PERMISSIONS.length} base permissions`);

    for (const [roleId, permIds] of Object.entries(ROLE_PERMISSIONS)) {
        for (const permissionId of permIds) {
            await prisma.userRolePermission.upsert({
                where: { roleId_permissionId: { roleId, permissionId } },
                create: { roleId, permissionId },
                update: {},
            });
        }
    }
    console.log("  ✓ Role-permission grants");

    // ═══════════════════════════════════════════════════════════════════════
    // 3. ASSIGNMENT PERMISSIONS (from seed-assignments.ts)
    // ═══════════════════════════════════════════════════════════════════════
    console.log("\n👤 Seeding assignment permissions...");

    for (const perm of ASSIGNMENT_PERMISSIONS) {
        await prisma.permission.upsert({
            where: { id: perm.id },
            create: perm,
            update: { label: perm.label, description: perm.description, module: perm.module },
        });
    }
    console.log(`  ✓ ${ASSIGNMENT_PERMISSIONS.length} assignment permissions`);

    await prisma.userRolePermission.createMany({
        data: ASSIGNMENT_ROLE_PERMISSIONS,
        skipDuplicates: true,
    });
    console.log("  ✓ Assignment role-permission grants");

    // ═══════════════════════════════════════════════════════════════════════
    // 4. PHASE 2 BRIDGE SUB-STATUSES (from seed-phase2.ts)
    // ═══════════════════════════════════════════════════════════════════════
    console.log("\n🌉 Seeding bridge sub-statuses...");

    await prisma.ticketSubStatus.upsert({
        where: { id: "SS36" },
        create: {
            id: "SS36",
            label: "Warranty Voided — Customer Approval Needed",
            color: "bg-red-100 text-red-600",
            group: "customer_comm",
            order: 36,
            applicableStatusIds: [],
            allowedRoles: [],
            notifyRoles: ["R3"],
            warrantyScope: "any",
            actionLabel: "Call customer — warranty void, confirm paid repair",
        },
        update: { warrantyScope: "any" },
    });

    await prisma.ticketSubStatus.upsert({
        where: { id: "SS37" },
        create: {
            id: "SS37",
            label: "Confirmed Under Warranty — Proceeding",
            color: "bg-green-100 text-green-700",
            group: "customer_comm",
            order: 37,
            applicableStatusIds: [],
            allowedRoles: [],
            notifyRoles: ["R3"],
            warrantyScope: "any",
            actionLabel: "Inform customer — covered under warranty, no charge",
        },
        update: { warrantyScope: "any" },
    });
    console.log("  ✓ Bridge sub-statuses SS36, SS37");

    console.log("\n✅ Seed complete!");
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => { prisma.$disconnect(); pool.end(); });
