import { PrismaClient } from "./generated/prisma/client";
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

type PipelineStatusSeed = {
    id: string;
    label: string;
    color: string;
    order: number;
    isEntryPoint: boolean;
    isTerminal: boolean;
    pipelineId: string;
    allowedRoles?: string[];
    notifyRoles?: string[];
    actionLabel?: string | null;
    warrantyScope?: string;
};

type PipelineSeed = {
    id: string;
    name: string;
    label: string;
    description: string;
    color: string;
    order: number;
    isDefault?: boolean;
    statuses: PipelineStatusSeed[];
};

type SubStatusSeed = {
    id: string;
    label: string;
    order: number;
    color: string;
    groupId: string;
    group: string;
    applicableStatusIds: string[];
    allowedRoles: string[];
    notifyRoles: string[];
    pipelineId: string;
    triggerMap?: Record<string, string>;
    warrantyScope?: string;
    actionLabel?: string;
    autoRevertOnClear?: boolean;
    handoffRole?: string | null;
};

const DEFAULT_PIPELINE: PipelineSeed = {
    id: "P1",
    name: "service",
    label: "Service & Repair",
    description: "Electronics repair and service workflow",
    color: "bg-blue-100 text-blue-600",
    order: 0,
    isDefault: true,
    statuses: [
        { id: "S1", label: "Received", color: "bg-gray-100 text-gray-600", order: 1, isEntryPoint: true, isTerminal: false, pipelineId: "P1" },
        { id: "S2", label: "Diagnosing", color: "bg-yellow-100 text-yellow-700", order: 2, isEntryPoint: false, isTerminal: false, pipelineId: "P1" },
        { id: "S3", label: "Repairing", color: "bg-blue-100 text-blue-700", order: 3, isEntryPoint: false, isTerminal: false, pipelineId: "P1" },
        { id: "S4", label: "Escalated", color: "bg-orange-100 text-orange-700", order: 4, isEntryPoint: false, isTerminal: false, pipelineId: "P1" },
        { id: "S5", label: "Received Back", color: "bg-purple-100 text-purple-700", order: 5, isEntryPoint: false, isTerminal: false, pipelineId: "P1" },
        { id: "S6", label: "Ready", color: "bg-green-100 text-green-700", order: 6, isEntryPoint: false, isTerminal: false, pipelineId: "P1" },
        { id: "S7", label: "Returned", color: "bg-gray-200 text-gray-500", order: 7, isEntryPoint: false, isTerminal: true, pipelineId: "P1" },
        { id: "S8", label: "Closed - No Fix", color: "bg-red-100 text-red-600", order: 8, isEntryPoint: false, isTerminal: true, pipelineId: "P1" },
        { id: "S9", label: "Cancelled", color: "bg-gray-100 text-gray-400", order: 9, isEntryPoint: false, isTerminal: true, pipelineId: "P1" },
    ],
};

const BUSINESS_PIPELINES: PipelineSeed[] = [
    {
        id: "P2",
        name: "customer-support",
        label: "Customer Support",
        description: "General customer support tickets not related to repairs",
        color: "bg-teal-100 text-teal-700",
        order: 2,
        statuses: [
            { id: "S10", label: "New Request", color: "bg-gray-100 text-gray-600", order: 1, isEntryPoint: true, isTerminal: false, pipelineId: "P2" },
            { id: "S11", label: "In Triage", color: "bg-yellow-100 text-yellow-700", order: 2, isEntryPoint: false, isTerminal: false, pipelineId: "P2" },
            { id: "S12", label: "Assigned", color: "bg-blue-100 text-blue-600", order: 3, isEntryPoint: false, isTerminal: false, pipelineId: "P2" },
            { id: "S13", label: "In Progress", color: "bg-indigo-100 text-indigo-600", order: 4, isEntryPoint: false, isTerminal: false, pipelineId: "P2" },
            { id: "S14", label: "Pending Customer", color: "bg-orange-100 text-orange-600", order: 5, isEntryPoint: false, isTerminal: false, pipelineId: "P2" },
            { id: "S15", label: "Resolved", color: "bg-green-100 text-green-600", order: 6, isEntryPoint: false, isTerminal: false, pipelineId: "P2" },
            { id: "S16", label: "Closed", color: "bg-gray-100 text-gray-400", order: 7, isEntryPoint: false, isTerminal: true, pipelineId: "P2" },
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
            { id: "S17", label: "Lead", color: "bg-gray-100 text-gray-600", order: 1, isEntryPoint: true, isTerminal: false, pipelineId: "P3" },
            { id: "S18", label: "Contacted", color: "bg-blue-100 text-blue-600", order: 2, isEntryPoint: false, isTerminal: false, pipelineId: "P3" },
            { id: "S19", label: "Qualified", color: "bg-teal-100 text-teal-600", order: 3, isEntryPoint: false, isTerminal: false, pipelineId: "P3" },
            { id: "S20", label: "Proposal Sent", color: "bg-yellow-100 text-yellow-700", order: 4, isEntryPoint: false, isTerminal: false, pipelineId: "P3" },
            { id: "S21", label: "Negotiation", color: "bg-orange-100 text-orange-600", order: 5, isEntryPoint: false, isTerminal: false, pipelineId: "P3" },
            { id: "S22", label: "Won", color: "bg-green-100 text-green-700", order: 6, isEntryPoint: false, isTerminal: true, pipelineId: "P3" },
            { id: "S23", label: "Lost", color: "bg-red-100 text-red-600", order: 7, isEntryPoint: false, isTerminal: true, pipelineId: "P3" },
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
            { id: "S24", label: "Open", color: "bg-gray-100 text-gray-600", order: 1, isEntryPoint: true, isTerminal: false, pipelineId: "P4" },
            { id: "S25", label: "In Review", color: "bg-yellow-100 text-yellow-700", order: 2, isEntryPoint: false, isTerminal: false, pipelineId: "P4" },
            { id: "S26", label: "In Progress", color: "bg-blue-100 text-blue-600", order: 3, isEntryPoint: false, isTerminal: false, pipelineId: "P4" },
            { id: "S27", label: "On Hold", color: "bg-orange-100 text-orange-600", order: 4, isEntryPoint: false, isTerminal: false, pipelineId: "P4" },
            { id: "S28", label: "Done", color: "bg-green-100 text-green-600", order: 5, isEntryPoint: false, isTerminal: true, pipelineId: "P4" },
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
            { id: "S29", label: "Idea", color: "bg-gray-100 text-gray-600", order: 1, isEntryPoint: true, isTerminal: false, pipelineId: "P5" },
            { id: "S30", label: "Planning", color: "bg-yellow-100 text-yellow-700", order: 2, isEntryPoint: false, isTerminal: false, pipelineId: "P5" },
            { id: "S31", label: "In Execution", color: "bg-blue-100 text-blue-600", order: 3, isEntryPoint: false, isTerminal: false, pipelineId: "P5" },
            { id: "S32", label: "Under Review", color: "bg-orange-100 text-orange-600", order: 4, isEntryPoint: false, isTerminal: false, pipelineId: "P5" },
            { id: "S33", label: "Live", color: "bg-teal-100 text-teal-600", order: 5, isEntryPoint: false, isTerminal: false, pipelineId: "P5" },
            { id: "S34", label: "Completed", color: "bg-green-100 text-green-600", order: 6, isEntryPoint: false, isTerminal: true, pipelineId: "P5" },
        ],
    },
];

const GROUPS = [
    { id: "customer_comm", label: "Call", order: 1 },
    { id: "approval", label: "Quote", order: 2 },
    { id: "parts", label: "Parts", order: 3 },
    { id: "qc", label: "QC", order: 4 },
    { id: "escalated", label: "Escalated", order: 5 },
    { id: "ready", label: "Ready", order: 6 },
    { id: "no_fix", label: "No Fix", order: 7 },
] as const;

const ROLES = [
    { id: "R1", label: "Admin", color: "bg-red-100 text-red-600", isSystem: true },
    { id: "R2", label: "Technician", color: "bg-blue-100 text-blue-600", isSystem: true },
    { id: "R3", label: "Front Desk", color: "bg-green-100 text-green-600", isSystem: true },
    { id: "R4", label: "Despatch", color: "bg-purple-100 text-purple-600", isSystem: true },
] as const;


const PERMISSIONS = [
    // core
    { id: "admin:bypass", label: "Bypass all permission checks", module: "core", description: "Grants full access to everything. Skips every permission check in the system." },

    // customers
    { id: "customers:view", label: "View customers & companies", module: "customers", description: "Access the Customers and Companies pages and view records." },
    { id: "customers:manage", label: "Manage customers", module: "customers", description: "Create, edit, and delete customer records." },
    { id: "companies:manage", label: "Manage companies", module: "customers", description: "Create, edit, and delete company records." },
    { id: "customers:view:own", label: "View own customers", module: "customers", description: "View customer records owned by the user." },
    { id: "customers:view:department", label: "View department customers", module: "customers", description: "View customer records within user departments." },
    { id: "customers:view:branch", label: "View branch customers", module: "customers", description: "View customer records within user branches." },
    { id: "customers:view:org", label: "View organisation customers", module: "customers", description: "View customer records across the organisation." },
    { id: "customers:create", label: "Create customers", module: "customers", description: "Create customer records." },
    { id: "customers:edit:own", label: "Edit own customers", module: "customers", description: "Edit customer records owned by the user." },
    { id: "customers:edit:department", label: "Edit department customers", module: "customers", description: "Edit customer records within user departments." },
    { id: "customers:edit:branch", label: "Edit branch customers", module: "customers", description: "Edit customer records within user branches." },
    { id: "customers:edit:org", label: "Edit organisation customers", module: "customers", description: "Edit customer records across the organisation." },
    { id: "customers:delete:own", label: "Delete own customers", module: "customers", description: "Delete customer records owned by the user." },
    { id: "customers:delete:department", label: "Delete department customers", module: "customers", description: "Delete customer records within user departments." },
    { id: "customers:delete:branch", label: "Delete branch customers", module: "customers", description: "Delete customer records within user branches." },
    { id: "customers:delete:org", label: "Delete organisation customers", module: "customers", description: "Delete customer records across the organisation." },
    { id: "companies:create", label: "Create companies", module: "customers", description: "Create company records." },
    { id: "companies:edit:org", label: "Edit companies", module: "customers", description: "Edit company records." },
    { id: "companies:delete:org", label: "Delete companies", module: "customers", description: "Delete company records." },

    // tickets
    { id: "tickets:create", label: "Create tickets", module: "tickets", description: "Open and submit new tickets." },
    { id: "tickets:status:set", label: "Set ticket status", module: "tickets", description: "Move a ticket between pipeline statuses." },
    { id: "tickets:substatus:set", label: "Set ticket sub-status", module: "tickets", description: "Set the sub-status on a ticket." },
    { id: "tickets:assign", label: "Assign tickets", module: "tickets", description: "Claim, pass, or reject primary ownership of a ticket." },
    { id: "tickets:manage-participants", label: "Manage ticket participants", module: "tickets", description: "Add or remove secondary owners on a ticket." },
    { id: "warranty:convert", label: "Edit warranty status", module: "tickets", description: "Change the warranty field on a ticket (in-warranty / out-of-warranty)." },
    { id: "tickets:view:own", label: "View own tickets", module: "tickets", description: "View tickets owned by the user." },
    { id: "tickets:view:department", label: "View department tickets", module: "tickets", description: "View tickets within user departments." },
    { id: "tickets:view:branch", label: "View branch tickets", module: "tickets", description: "View tickets within user branches." },
    { id: "tickets:view:org", label: "View organisation tickets", module: "tickets", description: "View tickets across the organisation." },
    { id: "tickets:edit:own", label: "Edit own tickets", module: "tickets", description: "Edit tickets owned by the user." },
    { id: "tickets:edit:department", label: "Edit department tickets", module: "tickets", description: "Edit tickets in user departments." },
    { id: "tickets:edit:branch", label: "Edit branch tickets", module: "tickets", description: "Edit tickets in user branches." },
    { id: "tickets:edit:org", label: "Edit organisation tickets", module: "tickets", description: "Edit tickets across the organisation." },
    { id: "tickets:delete:own", label: "Delete own tickets", module: "tickets", description: "Delete tickets owned by the user." },
    { id: "tickets:delete:department", label: "Delete department tickets", module: "tickets", description: "Delete tickets in user departments." },
    { id: "tickets:delete:branch", label: "Delete branch tickets", module: "tickets", description: "Delete tickets in user branches." },
    { id: "tickets:delete:org", label: "Delete organisation tickets", module: "tickets", description: "Delete tickets across the organisation." },

    // assignments
    { id: "assignments:view-team", label: "View team assignments", module: "assignments", description: "See the My Team tab — all tickets routed to your role." },
    { id: "assignments:view-org", label: "View organisation assignments", module: "assignments", description: "See the All Organisation tab — every active ticket across all roles." },
    { id: "assignments:view:own", label: "View own assignments", module: "assignments", description: "View assignments directly owned by the user." },
    { id: "assignments:view:department", label: "View department assignments", module: "assignments", description: "View assignments inside user departments." },
    { id: "assignments:view:branch", label: "View branch assignments", module: "assignments", description: "View assignments inside user branches." },
    { id: "assignments:view:org", label: "View organisation assignments", module: "assignments", description: "View assignments across the organisation." },

    // service
    { id: "service-centers:view", label: "View service centers", module: "service", description: "Access the Service Centers page in the sidebar." },
    { id: "service-centers:manage", label: "Manage service centers", module: "service", description: "Add, edit, and delete service center records." },
    { id: "service-centers:view:branch", label: "View branch service centers", module: "service", description: "View service centers in user branches." },
    { id: "service-centers:view:org", label: "View organisation service centers", module: "service", description: "View service centers across the organisation." },
    { id: "service-centers:create", label: "Create service centers", module: "service", description: "Create service center records." },
    { id: "service-centers:edit:org", label: "Edit service centers", module: "service", description: "Edit service center records." },
    { id: "service-centers:delete:org", label: "Delete service centers", module: "service", description: "Delete service center records." },

    // admin
    { id: "users:manage", label: "Manage users", module: "admin", description: "Create, edit, and delete user accounts." },
    { id: "roles:manage", label: "Manage roles", module: "admin", description: "Create and edit roles and their permission sets." },
    { id: "settings:manage", label: "Manage org settings", module: "admin", description: "Manage branches, departments, and posts." },
    { id: "settings:statuses", label: "Manage statuses & sub-statuses", module: "admin", description: "Create, edit, and delete ticket statuses and sub-statuses." },
    { id: "settings:pipelines", label: "Manage pipelines", module: "admin", description: "Create, edit, and configure pipelines." },
    { id: "users:create", label: "Create users", module: "admin", description: "Create user accounts." },
    { id: "users:edit:org", label: "Edit users", module: "admin", description: "Edit user accounts." },
    { id: "users:delete:org", label: "Delete users", module: "admin", description: "Delete user accounts." },
    { id: "roles:create", label: "Create roles", module: "admin", description: "Create role definitions." },
    { id: "roles:edit:org", label: "Edit roles", module: "admin", description: "Edit role definitions and grants." },
    { id: "roles:delete:org", label: "Delete roles", module: "admin", description: "Delete custom role definitions." },
    { id: "settings:edit", label: "Edit settings", module: "admin", description: "Edit organisation-wide settings." },
    { id: "settings:statuses:create", label: "Create statuses", module: "admin", description: "Create ticket statuses and sub-statuses." },
    { id: "settings:statuses:edit", label: "Edit statuses", module: "admin", description: "Edit ticket statuses and sub-statuses." },
    { id: "settings:statuses:delete", label: "Delete statuses", module: "admin", description: "Delete ticket statuses and sub-statuses." },
    { id: "settings:pipelines:create", label: "Create pipelines", module: "admin", description: "Create pipelines." },
    { id: "settings:pipelines:edit", label: "Edit pipelines", module: "admin", description: "Edit pipelines." },
    { id: "settings:pipelines:delete", label: "Delete pipelines", module: "admin", description: "Delete pipelines." },
    { id: "ecommerce:manage", label: "Manage ecommerce catalog & orders", module: "admin", description: "Create shop products and view customer orders." },
] as const;

const ROLE_PERMISSIONS: Record<string, string[]> = {
    R1: (PERMISSIONS as readonly { id: string }[]).map((p) => p.id),
    R2: [
        "customers:view",
        "tickets:create", "tickets:status:set", "tickets:substatus:set",
        "tickets:assign", "tickets:manage-participants", "warranty:convert",
        "assignments:view-team",
        "service-centers:view",
    ],
    R3: [
        "customers:view", "customers:manage", "companies:manage",
        "tickets:create", "tickets:status:set", "tickets:substatus:set", "tickets:assign",
        "assignments:view-team",
    ],
    R4: [
        "customers:view",
        "tickets:substatus:set", "tickets:assign",
        "assignments:view-team",
    ],
};

const STATUS_TRANSITIONS = [
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
] as const;

const SUB_STATUSES: SubStatusSeed[] = [
    { id: "SS1", label: "Waiting: Customer Info", order: 1, color: "bg-yellow-50 text-yellow-700", groupId: "customer_comm", group: "customer_comm", applicableStatusIds: ["S2", "S3", "S6"], allowedRoles: ["R1", "R2"], notifyRoles: ["R3"], pipelineId: "P1" },
    { id: "SS2", label: "Waiting: Customer to Bring Item", order: 2, color: "bg-yellow-50 text-yellow-700", groupId: "customer_comm", group: "customer_comm", applicableStatusIds: ["S2", "S3"], allowedRoles: ["R1", "R2"], notifyRoles: ["R3"], pipelineId: "P1" },
    { id: "SS3", label: "Customer Unreachable", order: 3, color: "bg-red-50 text-red-600", groupId: "customer_comm", group: "customer_comm", applicableStatusIds: ["S2", "S3", "S6"], allowedRoles: ["R1", "R3"], notifyRoles: ["R1"], pipelineId: "P1" },
    { id: "SS4", label: "Customer Responded", order: 4, color: "bg-green-50 text-green-700", groupId: "customer_comm", group: "customer_comm", applicableStatusIds: ["S2", "S3", "S6"], allowedRoles: ["R1", "R3"], notifyRoles: ["R2"], pipelineId: "P1" },
    { id: "SS5", label: "Quote Prepared", order: 5, color: "bg-blue-50 text-blue-600", groupId: "approval", group: "approval", applicableStatusIds: ["S2"], allowedRoles: ["R1", "R2"], notifyRoles: ["R3"], pipelineId: "P1" },
    { id: "SS6", label: "Awaiting Customer Approval", order: 6, color: "bg-yellow-50 text-yellow-700", groupId: "approval", group: "approval", applicableStatusIds: ["S2"], allowedRoles: ["R1", "R3"], notifyRoles: [], pipelineId: "P1" },
    { id: "SS7", label: "Awaiting Insurance / Warranty", order: 7, color: "bg-purple-50 text-purple-600", groupId: "approval", group: "approval", applicableStatusIds: ["S2"], allowedRoles: ["R1", "R3"], notifyRoles: ["R1"], pipelineId: "P1" },
    { id: "SS8", label: "Customer Approved", order: 8, color: "bg-green-50 text-green-700", groupId: "approval", group: "approval", applicableStatusIds: ["S2"], allowedRoles: ["R1", "R3"], notifyRoles: ["R2"], pipelineId: "P1", triggerMap: { S2: "S3" } },
    { id: "SS9", label: "Customer Declined", order: 9, color: "bg-red-50 text-red-600", groupId: "approval", group: "approval", applicableStatusIds: ["S2"], allowedRoles: ["R1", "R3"], notifyRoles: ["R2"], pipelineId: "P1", triggerMap: { S2: "S8" } },
    { id: "SS10", label: "Awaiting Parts", order: 10, color: "bg-orange-50 text-orange-600", groupId: "parts", group: "parts", applicableStatusIds: ["S3"], allowedRoles: ["R1", "R2"], notifyRoles: ["R1"], pipelineId: "P1" },
    { id: "SS11", label: "Parts Delayed", order: 11, color: "bg-orange-50 text-orange-600", groupId: "parts", group: "parts", applicableStatusIds: ["S3"], allowedRoles: ["R1"], notifyRoles: ["R2", "R3"], pipelineId: "P1" },
    { id: "SS12", label: "Parts Issue", order: 12, color: "bg-red-50 text-red-600", groupId: "parts", group: "parts", applicableStatusIds: ["S3"], allowedRoles: ["R1"], notifyRoles: ["R2", "R3"], pipelineId: "P1" },
    { id: "SS13", label: "Parts Arrived", order: 13, color: "bg-green-50 text-green-700", groupId: "parts", group: "parts", applicableStatusIds: ["S3"], allowedRoles: ["R1"], notifyRoles: ["R2"], pipelineId: "P1" },
    { id: "SS14", label: "QC In Progress", order: 14, color: "bg-blue-50 text-blue-600", groupId: "qc", group: "qc", applicableStatusIds: ["S3"], allowedRoles: ["R1", "R2"], notifyRoles: [], pipelineId: "P1" },
    { id: "SS15", label: "QC Passed", order: 15, color: "bg-green-50 text-green-700", groupId: "qc", group: "qc", applicableStatusIds: ["S3"], allowedRoles: ["R1", "R2"], notifyRoles: ["R3"], pipelineId: "P1", triggerMap: { S3: "S6" } },
    { id: "SS16", label: "QC Failed", order: 16, color: "bg-red-50 text-red-600", groupId: "qc", group: "qc", applicableStatusIds: ["S3"], allowedRoles: ["R1", "R2"], notifyRoles: [], pipelineId: "P1" },
    { id: "SS17", label: "Partial Fix", order: 17, color: "bg-yellow-50 text-yellow-700", groupId: "qc", group: "qc", applicableStatusIds: ["S3"], allowedRoles: ["R1", "R2"], notifyRoles: ["R3"], pipelineId: "P1" },
    { id: "SS18", label: "Engineer Visit Requested", order: 18, color: "bg-orange-50 text-orange-600", groupId: "escalated", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1", "R2"], notifyRoles: ["R1"], pipelineId: "P1" },
    { id: "SS19", label: "Engineer Visit Scheduled", order: 19, color: "bg-blue-50 text-blue-600", groupId: "escalated", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1"], notifyRoles: ["R2"], pipelineId: "P1" },
    { id: "SS20", label: "Engineer On-Site", order: 20, color: "bg-blue-50 text-blue-600", groupId: "escalated", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1"], notifyRoles: ["R2"], pipelineId: "P1" },
    { id: "SS21", label: "Engineer Work Complete", order: 21, color: "bg-green-50 text-green-700", groupId: "escalated", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1", "R2"], notifyRoles: ["R1"], pipelineId: "P1", triggerMap: { S4: "S3" } },
    { id: "SS22", label: "Pending Despatch", order: 22, color: "bg-orange-50 text-orange-700", groupId: "escalated", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1", "R2"], notifyRoles: ["R4"], pipelineId: "P1" },
    { id: "SS23", label: "Dispatched", order: 23, color: "bg-blue-50 text-blue-600", groupId: "escalated", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1", "R4"], notifyRoles: ["R1"], pipelineId: "P1" },
    { id: "SS24", label: "Received by Service Centre", order: 24, color: "bg-blue-50 text-blue-600", groupId: "escalated", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1", "R4"], notifyRoles: [], pipelineId: "P1" },
    { id: "SS25", label: "Being Repaired", order: 25, color: "bg-blue-50 text-blue-600", groupId: "escalated", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1", "R4"], notifyRoles: [], pipelineId: "P1" },
    { id: "SS26", label: "Service Centre Delayed", order: 26, color: "bg-red-50 text-red-600", groupId: "escalated", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1", "R4"], notifyRoles: ["R1"], pipelineId: "P1" },
    { id: "SS27", label: "Shipped Back to Us", order: 27, color: "bg-purple-50 text-purple-600", groupId: "escalated", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1", "R4"], notifyRoles: [], pipelineId: "P1" },
    { id: "SS28", label: "Received by Us", order: 28, color: "bg-green-50 text-green-700", groupId: "escalated", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1", "R4"], notifyRoles: ["R2"], pipelineId: "P1", triggerMap: { S4: "S5" } },
    { id: "SS29", label: "Customer Notified", order: 29, color: "bg-green-50 text-green-700", groupId: "ready", group: "ready", applicableStatusIds: ["S6"], allowedRoles: ["R1", "R3"], notifyRoles: [], pipelineId: "P1" },
    { id: "SS30", label: "Reminder Sent", order: 30, color: "bg-yellow-50 text-yellow-700", groupId: "ready", group: "ready", applicableStatusIds: ["S6"], allowedRoles: ["R1", "R3"], notifyRoles: [], pipelineId: "P1" },
    { id: "SS31", label: "Uncollected - Action Needed", order: 31, color: "bg-red-50 text-red-600", groupId: "ready", group: "ready", applicableStatusIds: ["S6"], allowedRoles: ["R1", "R3"], notifyRoles: ["R1"], pipelineId: "P1" },
    { id: "SS32", label: "Beyond Economical Repair", order: 32, color: "bg-red-50 text-red-600", groupId: "no_fix", group: "no_fix", applicableStatusIds: ["S8"], allowedRoles: ["R1", "R2"], notifyRoles: ["R3"], pipelineId: "P1" },
    { id: "SS33", label: "Customer Informed", order: 33, color: "bg-gray-50 text-gray-600", groupId: "no_fix", group: "no_fix", applicableStatusIds: ["S8"], allowedRoles: ["R1", "R3"], notifyRoles: [], pipelineId: "P1" },
    { id: "SS34", label: "Collecting Unrepaired", order: 34, color: "bg-gray-50 text-gray-600", groupId: "no_fix", group: "no_fix", applicableStatusIds: ["S8"], allowedRoles: ["R1", "R3"], notifyRoles: [], pipelineId: "P1", triggerMap: { S8: "S7" } },
    { id: "SS35", label: "Scrapped with Consent", order: 35, color: "bg-gray-50 text-gray-600", groupId: "no_fix", group: "no_fix", applicableStatusIds: ["S8"], allowedRoles: ["R1", "R3"], notifyRoles: ["R1"], pipelineId: "P1" },
    { id: "SS36", label: "Warranty Voided - Customer Approval Needed", order: 36, color: "bg-red-100 text-red-600", groupId: "customer_comm", group: "customer_comm", applicableStatusIds: [], allowedRoles: [], notifyRoles: ["R3"], pipelineId: "P1", warrantyScope: "any", actionLabel: "Call customer - warranty void, confirm paid repair" },
    { id: "SS37", label: "Confirmed Under Warranty - Proceeding", order: 37, color: "bg-green-100 text-green-700", groupId: "customer_comm", group: "customer_comm", applicableStatusIds: [], allowedRoles: [], notifyRoles: ["R3"], pipelineId: "P1", warrantyScope: "any", actionLabel: "Inform customer - covered under warranty, no charge" },
];

const SUB_STATUS_TRANSITIONS = [
    { fromSubStatusId: null, toSubStatusId: "SS1" },
    { fromSubStatusId: null, toSubStatusId: "SS2" },
    { fromSubStatusId: "SS1", toSubStatusId: "SS3" },
    { fromSubStatusId: "SS1", toSubStatusId: "SS4" },
    { fromSubStatusId: "SS2", toSubStatusId: "SS3" },
    { fromSubStatusId: "SS2", toSubStatusId: "SS4" },
    { fromSubStatusId: "SS3", toSubStatusId: "SS4" },
    { fromSubStatusId: null, toSubStatusId: "SS5" },
    { fromSubStatusId: "SS5", toSubStatusId: "SS6" },
    { fromSubStatusId: "SS6", toSubStatusId: "SS7" },
    { fromSubStatusId: "SS6", toSubStatusId: "SS8" },
    { fromSubStatusId: "SS6", toSubStatusId: "SS9" },
    { fromSubStatusId: "SS7", toSubStatusId: "SS8" },
    { fromSubStatusId: "SS7", toSubStatusId: "SS9" },
    { fromSubStatusId: null, toSubStatusId: "SS10" },
    { fromSubStatusId: "SS10", toSubStatusId: "SS11" },
    { fromSubStatusId: "SS10", toSubStatusId: "SS12" },
    { fromSubStatusId: "SS10", toSubStatusId: "SS13" },
    { fromSubStatusId: "SS11", toSubStatusId: "SS12" },
    { fromSubStatusId: "SS11", toSubStatusId: "SS13" },
    { fromSubStatusId: "SS12", toSubStatusId: "SS13" },
    { fromSubStatusId: null, toSubStatusId: "SS14" },
    { fromSubStatusId: "SS14", toSubStatusId: "SS15" },
    { fromSubStatusId: "SS14", toSubStatusId: "SS16" },
    { fromSubStatusId: "SS14", toSubStatusId: "SS17" },
    { fromSubStatusId: "SS16", toSubStatusId: "SS14" },
    { fromSubStatusId: "SS17", toSubStatusId: "SS15" },
    { fromSubStatusId: "SS17", toSubStatusId: "SS16" },
    { fromSubStatusId: null, toSubStatusId: "SS18" },
    { fromSubStatusId: "SS18", toSubStatusId: "SS19" },
    { fromSubStatusId: "SS19", toSubStatusId: "SS20" },
    { fromSubStatusId: "SS20", toSubStatusId: "SS21" },
    { fromSubStatusId: null, toSubStatusId: "SS22" },
    { fromSubStatusId: "SS22", toSubStatusId: "SS23" },
    { fromSubStatusId: "SS23", toSubStatusId: "SS24" },
    { fromSubStatusId: "SS24", toSubStatusId: "SS25" },
    { fromSubStatusId: "SS25", toSubStatusId: "SS26" },
    { fromSubStatusId: "SS25", toSubStatusId: "SS27" },
    { fromSubStatusId: "SS26", toSubStatusId: "SS27" },
    { fromSubStatusId: "SS27", toSubStatusId: "SS28" },
    { fromSubStatusId: null, toSubStatusId: "SS29" },
    { fromSubStatusId: "SS29", toSubStatusId: "SS30" },
    { fromSubStatusId: "SS30", toSubStatusId: "SS31" },
    { fromSubStatusId: null, toSubStatusId: "SS32" },
    { fromSubStatusId: "SS32", toSubStatusId: "SS33" },
    { fromSubStatusId: "SS33", toSubStatusId: "SS34" },
    { fromSubStatusId: "SS33", toSubStatusId: "SS35" },
] as const;

const CHART_OF_ACCOUNTS = [
    { code: "1000", name: "Cash", type: "ASSET", normalBalance: "DEBIT", description: "Physical cash and petty cash" },
    { code: "1010", name: "Bank Account", type: "ASSET", normalBalance: "DEBIT", description: "Main business bank account" },
    { code: "1100", name: "Accounts Receivable", type: "ASSET", normalBalance: "DEBIT", description: "Amounts owed by customers" },
    { code: "1200", name: "Parts Inventory", type: "ASSET", normalBalance: "DEBIT", description: "Spare parts and components in stock" },
    { code: "1300", name: "Prepaid Expenses", type: "ASSET", normalBalance: "DEBIT", description: "Prepaid rent, insurance, subscriptions" },
    { code: "2000", name: "Accounts Payable", type: "LIABILITY", normalBalance: "CREDIT", description: "Amounts owed to suppliers" },
    { code: "2100", name: "Tax Payable", type: "LIABILITY", normalBalance: "CREDIT", description: "VAT / sales tax collected from customers" },
    { code: "2200", name: "Accrued Expenses", type: "LIABILITY", normalBalance: "CREDIT", description: "Expenses incurred but not yet paid" },
    { code: "3000", name: "Owner's Capital", type: "EQUITY", normalBalance: "CREDIT", description: "Owner's investment in the business" },
    { code: "3100", name: "Retained Earnings", type: "EQUITY", normalBalance: "CREDIT", description: "Accumulated profits carried forward" },
    { code: "4000", name: "Service Revenue", type: "REVENUE", normalBalance: "CREDIT", description: "Income from repair and service work" },
    { code: "4100", name: "Parts Revenue", type: "REVENUE", normalBalance: "CREDIT", description: "Income from parts sales" },
    { code: "4200", name: "Warranty Revenue", type: "REVENUE", normalBalance: "CREDIT", description: "Income from warranty claim work" },
    { code: "4900", name: "Other Revenue", type: "REVENUE", normalBalance: "CREDIT", description: "Miscellaneous income" },
    { code: "5000", name: "Cost of Parts Sold", type: "EXPENSE", normalBalance: "DEBIT", description: "Cost of parts used in repairs" },
    { code: "6000", name: "Rent Expense", type: "EXPENSE", normalBalance: "DEBIT", description: "Shop / office rent" },
    { code: "6100", name: "Utilities Expense", type: "EXPENSE", normalBalance: "DEBIT", description: "Electricity, water, internet" },
    { code: "6200", name: "Salaries Expense", type: "EXPENSE", normalBalance: "DEBIT", description: "Staff wages and salaries" },
    { code: "6300", name: "Tools & Equipment", type: "EXPENSE", normalBalance: "DEBIT", description: "Tools, equipment and small asset purchases" },
    { code: "6900", name: "Miscellaneous Expense", type: "EXPENSE", normalBalance: "DEBIT", description: "Other business expenses" },
] as const;

async function upsertPipelines(pipelines: PipelineSeed[]) {
    for (const pipeline of pipelines) {
        await prisma.pipeline.upsert({
            where: { id: pipeline.id },
            update: {
                name: pipeline.name,
                label: pipeline.label,
                description: pipeline.description,
                color: pipeline.color,
                isDefault: pipeline.isDefault ?? false,
                isActive: true,
                order: pipeline.order,
            },
            create: {
                id: pipeline.id,
                name: pipeline.name,
                label: pipeline.label,
                description: pipeline.description,
                color: pipeline.color,
                isDefault: pipeline.isDefault ?? false,
                isActive: true,
                order: pipeline.order,
            },
        });

        for (const status of pipeline.statuses) {
            await prisma.ticketStatus.upsert({
                where: { id: status.id },
                update: {
                    label: status.label,
                    color: status.color,
                    order: status.order,
                    isTerminal: status.isTerminal,
                    isEntryPoint: status.isEntryPoint,
                    allowedRoles: status.allowedRoles ?? [],
                    notifyRoles: status.notifyRoles ?? [],
                    actionLabel: status.actionLabel ?? null,
                    warrantyScope: status.warrantyScope ?? "any",
                    pipelineId: status.pipelineId,
                },
                create: {
                    id: status.id,
                    label: status.label,
                    color: status.color,
                    order: status.order,
                    isTerminal: status.isTerminal,
                    isEntryPoint: status.isEntryPoint,
                    allowedRoles: status.allowedRoles ?? [],
                    notifyRoles: status.notifyRoles ?? [],
                    actionLabel: status.actionLabel ?? null,
                    warrantyScope: status.warrantyScope ?? "any",
                    pipelineId: status.pipelineId,
                },
            });
        }
    }
}

async function upsertSubStatusGroups() {
    for (const group of GROUPS) {
        await prisma.subStatusGroup.upsert({
            where: { id: group.id },
            update: {
                label: group.label,
                order: group.order,
            },
            create: group,
        });
    }
}

async function upsertRoles() {
    for (const role of ROLES) {
        await prisma.role.upsert({
            where: { id: role.id },
            update: {
                label: role.label,
                color: role.color,
                isSystem: role.isSystem,
            },
            create: role,
        });
    }
}


async function upsertPermissions() {
    for (const permission of PERMISSIONS) {
        await prisma.permission.upsert({
            where: { id: permission.id },
            update: {
                label: permission.label,
                module: permission.module,
                description: permission.description,
            },
            create: permission,
        });
    }
}

async function syncRolePermissions() {
    const seededRoleIds = Object.keys(ROLE_PERMISSIONS);

    await prisma.rolePermission.deleteMany({
        where: { roleId: { in: seededRoleIds } },
    });

    const rolePermGrants = Object.entries(ROLE_PERMISSIONS).flatMap(([roleId, permissionIds]) =>
        permissionIds.map((permissionId) => ({ roleId, permissionId }))
    );

    await prisma.rolePermission.createMany({
        data: rolePermGrants,
        skipDuplicates: true,
    });
}

async function upsertServiceSubStatuses() {
    for (const subStatus of SUB_STATUSES) {
        await prisma.ticketSubStatus.upsert({
            where: { id: subStatus.id },
            update: {
                label: subStatus.label,
                color: subStatus.color,
                group: subStatus.group,
                order: subStatus.order,
                applicableStatusIds: subStatus.applicableStatusIds,
                allowedRoles: subStatus.allowedRoles,
                notifyRoles: subStatus.notifyRoles,
                triggerMap: subStatus.triggerMap ?? {},
                actionLabel: subStatus.actionLabel ?? null,
                autoRevertOnClear: subStatus.autoRevertOnClear ?? true,
                handoffRole: subStatus.handoffRole ?? null,
                warrantyScope: subStatus.warrantyScope ?? "any",
                groupId: subStatus.groupId,
                pipelineId: subStatus.pipelineId,
            },
            create: {
                id: subStatus.id,
                label: subStatus.label,
                color: subStatus.color,
                group: subStatus.group,
                order: subStatus.order,
                applicableStatusIds: subStatus.applicableStatusIds,
                allowedRoles: subStatus.allowedRoles,
                notifyRoles: subStatus.notifyRoles,
                triggerMap: subStatus.triggerMap ?? {},
                actionLabel: subStatus.actionLabel ?? null,
                autoRevertOnClear: subStatus.autoRevertOnClear ?? true,
                handoffRole: subStatus.handoffRole ?? null,
                warrantyScope: subStatus.warrantyScope ?? "any",
                groupId: subStatus.groupId,
                pipelineId: subStatus.pipelineId,
            },
        });
    }
}

async function ensureStatusTransitions() {
    for (const transition of STATUS_TRANSITIONS) {
        await prisma.statusTransition.upsert({
            where: {
                fromStatusId_toStatusId: {
                    fromStatusId: transition.fromStatusId,
                    toStatusId: transition.toStatusId,
                },
            },
            update: {},
            create: transition,
        });
    }
}

async function ensureSubStatusTransitions() {
    for (const transition of SUB_STATUS_TRANSITIONS) {
        const existing = await prisma.subStatusTransition.findFirst({
            where: {
                fromSubStatusId: transition.fromSubStatusId,
                toSubStatusId: transition.toSubStatusId,
            },
            select: { id: true },
        });

        if (!existing) {
            await prisma.subStatusTransition.create({ data: transition });
        }
    }
}

async function backfillPipelineIds() {
    const [statusResult, subStatusResult, ticketResult] = await Promise.all([
        prisma.ticketStatus.updateMany({ where: { pipelineId: null }, data: { pipelineId: "P1" } }),
        prisma.ticketSubStatus.updateMany({ where: { pipelineId: null }, data: { pipelineId: "P1" } }),
        prisma.ticket.updateMany({ where: { pipelineId: null }, data: { pipelineId: "P1" } }),
    ]);

    console.log(`  Backfilled ${statusResult.count} statuses, ${subStatusResult.count} sub-statuses, ${ticketResult.count} tickets to P1`);
}

async function upsertChartOfAccounts() {
    for (const account of CHART_OF_ACCOUNTS) {
        await prisma.account.upsert({
            where: { code: account.code },
            update: {
                name: account.name,
                type: account.type,
                normalBalance: account.normalBalance,
                description: account.description,
                isActive: true,
            },
            create: {
                code: account.code,
                name: account.name,
                type: account.type,
                normalBalance: account.normalBalance,
                description: account.description,
            },
        });
    }
}

async function ensureShopProducts() {
    const n = await prisma.shopProduct.count();
    if (n > 0) return;
    await prisma.shopProduct.createMany({
        data: [
            {
                name: "Extended warranty (1 year)",
                description: "Add-on warranty plan for eligible devices.",
                pricePaise: 49900,
                isActive: true,
            },
            {
                name: "Pickup & delivery",
                description: "Doorstep pickup and return within city limits.",
                pricePaise: 35000,
                isActive: true,
            },
        ],
    });
}

async function ensureAdminUser() {
    const password = await bcrypt.hash("admin123", 10);
    await prisma.user.upsert({
        where: { email: "admin@networkservice.in" },
        update: {},
        create: {
            name: "Admin",
            email: "admin@networkservice.in",
            password,
            role: "R1",
        },
    });
}

async function main() {
    console.log("Seeding unified baseline data...");

    await upsertRoles();
    console.log(`  Seeded ${ROLES.length} roles`);

    // Priority is now a Prisma enum (LOW/MEDIUM/HIGH/URGENT) — no DB seeding needed

    await upsertPermissions();
    await syncRolePermissions();
    console.log(`  Seeded ${PERMISSIONS.length} permissions and synced role grants`);

    await upsertPipelines([DEFAULT_PIPELINE, ...BUSINESS_PIPELINES]);
    console.log(`  Seeded ${1 + BUSINESS_PIPELINES.length} pipelines and their statuses`);

    await upsertSubStatusGroups();
    await upsertServiceSubStatuses();
    await ensureStatusTransitions();
    await ensureSubStatusTransitions();
    console.log(`  Seeded ${GROUPS.length} sub-status groups, ${SUB_STATUSES.length} sub-statuses, and workflow transitions`);

    await backfillPipelineIds();
    await upsertChartOfAccounts();
    console.log(`  Seeded ${CHART_OF_ACCOUNTS.length} GL accounts`);

    await ensureAdminUser();
    console.log("  Ensured admin user exists (admin@networkservice.in / admin123 on first seed only)");

    await ensureShopProducts();
    console.log("  Ensured sample shop products when catalog was empty");

    console.log("Seed complete.");
}

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
