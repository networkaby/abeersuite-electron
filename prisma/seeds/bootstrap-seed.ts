// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BOOTSTRAP SEED — single source of truth for production setup.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// Run: `pnpm prisma db seed` (the standard Prisma command). Wired in
// `prisma.config.ts → migrations.seed`. Idempotent — safe to re-run.
//
// ⚠️ THIS FILE DESCRIBES **OUR** BUSINESS, NOT A GENERIC ONE.
// AbeerSuite is our company's app. The workflow, roles, org, couriers and
// gateways below are the ones we actually run — captured from the live database,
// not invented defaults. When you change the setup in the UI, mirror it back here
// in the same commit: **the live DB is the source of truth for this file.**
// A separate code-owned generic installer for the public build comes later.
//
// ⚠️ MAINTENANCE RULE
// When you change `prisma/schema/*.prisma` (add / rename / drop a column or
// table), update THIS file in the same commit — it is the only file that
// describes the production-required state.
//
// What this seeds (kept on hard-clean):
//   • RBAC: 3 Roles — R1 Role-Admin (the only isSystem role), R2 Branch Manager,
//     R3 Counter Operator. Their GRANTS are the owner's config and live in the
//     personal snapshot, not here; this only guarantees the rows and their homes.
//     130+ Permissions (incl. per-kind voucher gates — GL `finance:voucher:*`
//     + inventory `inventory:voucher:*`, generated from voucherMatrix.ts)
//   • Workflow: 9 Pipelines, 61 TicketStatuses, 5 WorkGroups, 48 status
//     transitions. NO Works and NO TicketWorkers — the live DB has zero of both
//     and the board runs on statuses alone (see the note above SECTION 2).
//   • Couriers: our 6 real delivery methods, including Local delivery's
//     per-neighbourhood pricing for the pincodes we serve
//   • Payment: 4 gateways, each linked to its settlement ledger BY NAME
//   • Org structure: 1 Branch (HQ, branch number 9), 9 Departments, Role ranks
//   • Chart of accounts: 29 AccountGroups (Tally tree) + ~50 GL ledgers
//     **Stock-in-Hand group is intentionally empty** — closing-stock value is
//     derived live by `getClosingStockValue` and injected as a synthetic
//     ledger at report time (`balance-sheet/route.ts`). DO NOT seed real
//     accounts here — they would double-count with the synthetic.
//   • Admin user: admin@networkservice.in / admin123 (bcrypt-hashed)
//   • DB constraints: Phone/Email XOR ownership CHECK
//   • Inventory Unit master: 13 common units (PCS, NOS, BOX, SET, MTR, ROLL,
//     PKT, PAIR, KG, BAG, UNIT, REAM, DAY)
//   • Inventory Warranty Term master: ~10 common terms (No Warranty, 7-day
//     DOA, 6-month, 1/2/3/5-year) — universal across trades, so kept here.
//
// What this does NOT seed:
//   • Brands → helper-brands.ts (`pnpm seed:helper-brands`)
//   • Categories + Product groups (the HSN/GST spine) → the personal snapshot,
//     applied by `pnpm prisma db seed`. Our real tree (6 categories, 102 groups)
//     was built by apply-taxonomy and then curated by hand, so it is config, not
//     a generic master. The old helper-inventory-masters.ts seeded a rival
//     taxonomy ("Computer Mice" / "Memory (RAM)" against our "Mouse" / "RAM")
//     and was deleted — it would have created ~76 duplicate groups.
//   • Demo data of every kind — users, customers, products, vouchers, tasks, deals.
//     The dummy-*.ts seeds that used to make it were deleted; write a fresh one
//     under prisma/seeds/ if a demo is needed again.
//   • InvAttributeMaster — populate via Configure → Attribute masters.
//   • Opening balances on accounts/products → set via UI

import { PrismaClient, Prisma } from "../../src/generated/prisma/client";
import { seedVoucherSeries } from "../../src/modules/accountancy/lib/seedVoucherSeries";
import {
    VOUCHER_TEMPLATE_KINDS,
    buildVoucherTemplateDefaults,
} from "../../src/shared/lib/print/voucherTemplateDefaults";
import { COMPANY_DETAILS } from "../../src/shared/lib/constants/companyDetails";
import { PERMISSION_CATALOG, ensureXorCheck as ensureXorCheckShared, ensurePortalProfileColumns } from "./lib/codeOwnedCatalog";
import { upsertPositionWithRoles } from "./lib/positionSeedSync";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import * as dotenv from "dotenv";
import { assertNotCounterReplica } from "./lib/assertNotCounter";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");

const pool = new Pool({ connectionString: rawUrl, ssl: /@(localhost|127\.0\.0\.1)/.test(rawUrl) ? false : { rejectUnauthorized: false }, max: 5 });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ════════════════════════════════════════════════════════════════════════════
// SECTION 1 — RBAC: Roles, Permissions, Role grants
// ════════════════════════════════════════════════════════════════════════════

// Roles are the *templates* that Positions inherit permissions from. Users do NOT
// receive a role directly — `User.role` is null until a Position appointment
// promotes them. See `PositionRole` and `authorizeStaff.ts`.
//
// The three roles this business runs on, captured from the live DB. Their GRANTS
// are not seeded here — those are config and live in the personal snapshot; this
// only guarantees the rows exist with the right department homes. Any further role
// is created from the Role Matrix UI.
//
// There is no starter-role helper any more: helper-roles.ts seeded R2 as
// "Role-Service Engineer" and R3 as "Role-Counter / Cashier" in other departments
// and rewrote their grants on every run, so it would have renamed two live roles.
const ROLES = [
    // R1 is the cross-cutting admin role — homed in the all-access department
    // (DEP-ADMIN) so the Role Matrix offers it the full permission list.
    { id: "R1", label: "Role-Admin", color: "bg-red-100 text-red-600", isSystem: true, rank: 100, departmentId: "DEP-ADMIN" },
    // R2 / R3 are the two roles this business actually runs on, captured from the
    // live DB. Non-system, so they stay editable and deletable from the Role Matrix.
    // Their GRANTS are not seeded here — they are the owner's and live in the
    // personal snapshot; this only guarantees the rows exist with the right home.
    { id: "R2", label: "Branch Manager", color: "bg-blue-100 text-blue-600", isSystem: false, rank: 20, departmentId: "DEP-OP" },
    { id: "R3", label: "Counter Operator", color: "bg-blue-100 text-blue-600", isSystem: false, rank: 20, departmentId: "DEP-SALES" },
] as const;

// The permission catalog is CODE-OWNED and shared with personal-bootstrap —
// single source: ./lib/codeOwnedCatalog.ts. Add new permissions THERE.
const PERMISSIONS = PERMISSION_CATALOG;

const ROLE_PERMISSIONS: Record<string, string[]> = {
    // R1 — Owner / Admin: every permission except system-only sentinels.
    // Only R1's grants are seeded. R2 / R3 exist as rows (see ROLES above) but
    // their grants are the owner's config and come from the personal snapshot.
    R1: (PERMISSIONS as readonly { id: string; systemOnly?: boolean }[])
        .filter((p) => !p.systemOnly)
        .map((p) => p.id),
};

// ════════════════════════════════════════════════════════════════════════════
// SECTION 2 — Workflow: Pipelines + Statuses + Transitions
// ════════════════════════════════════════════════════════════════════════════

type PipelineSeed = {
    id: string; name: string; label: string; description: string;
    color: string; order: number; isDefault?: boolean;
    // Which entity table rides this pipeline — dispatch key for spawn-child.
    // "ticket" | "task" | "deal" | "delivery" | "refund" | "voucher" | "none".
    entityType: string;
    statuses: Array<{
        id: string; label: string; color: string; order: number;
        isEntryPoint: boolean; isTerminal: boolean; pipelineId: string;
        actionLabel?: string;
        leavePrompt?: string; announceOnEntry?: boolean; etaText?: string;
        // Resolve-time SLA in hours — ticket overdue past this shows "needs attention"
        // in the Work Inbox. Omit = no SLA.
        resolveTimeHours?: number;
    }>;
};

const PIPELINES: PipelineSeed[] = [
    {
        id: "P1", name: "service", label: "Service & Repair",
        description: "Electronics repair and service workflow",
        color: "bg-blue-100 text-blue-600", order: 0, isDefault: true, entityType: "ticket",
        statuses: [
            { id: "S1", label: "Received", color: "bg-gray-100 text-gray-600", order: 1, isEntryPoint: true, isTerminal: false, pipelineId: "P1", leavePrompt: "Confirm the device and accessories are logged before moving on." },
            { id: "S2", label: "Diagnosing", color: "bg-yellow-100 text-yellow-700", order: 2, isEntryPoint: false, isTerminal: false, pipelineId: "P1", announceOnEntry: true, etaText: "2 days", resolveTimeHours: 48 },
            { id: "S3", label: "Repairing", color: "bg-blue-100 text-blue-700", order: 3, isEntryPoint: false, isTerminal: false, pipelineId: "P1", resolveTimeHours: 72 },
            { id: "S61", label: "Need Help", color: "bg-gray-100 text-gray-600", order: 4, isEntryPoint: false, isTerminal: false, pipelineId: "P1" },
            { id: "S62", label: "Escalated - Send to service", color: "bg-gray-100 text-gray-600", order: 5, isEntryPoint: false, isTerminal: false, pipelineId: "P1" },
            { id: "S5", label: "Received Back", color: "bg-purple-100 text-purple-700", order: 5, isEntryPoint: false, isTerminal: false, pipelineId: "P1" },
            { id: "S4", label: "Escalated -Visit", color: "bg-orange-100 text-orange-700", order: 5, isEntryPoint: false, isTerminal: false, pipelineId: "P1" },
            { id: "S6", label: "Ready", color: "bg-green-100 text-green-700", order: 6, isEntryPoint: false, isTerminal: false, pipelineId: "P1" },
            { id: "S7", label: "Returned", color: "bg-gray-200 text-gray-500", order: 7, isEntryPoint: false, isTerminal: true, pipelineId: "P1" },
            { id: "S8", label: "Closed - No Fix", color: "bg-red-100 text-red-600", order: 8, isEntryPoint: false, isTerminal: true, pipelineId: "P1" },
            { id: "S9", label: "Cancelled", color: "bg-gray-100 text-gray-400", order: 9, isEntryPoint: false, isTerminal: true, pipelineId: "P1" },
            { id: "S63", label: "Scrap", color: "bg-gray-100 text-gray-600", order: 12, isEntryPoint: false, isTerminal: true, pipelineId: "P1" },
            { id: "S65", label: "Sent To Service", color: "#455FD3", order: 60, isEntryPoint: false, isTerminal: false, pipelineId: "P1", resolveTimeHours: 48 },
            { id: "S66", label: "Rejected by Technician", color: "#D3458A", order: 120, isEntryPoint: false, isTerminal: false, pipelineId: "P1", resolveTimeHours: 48 },
        ],
    },
    {
        // Front-desk Help Desk — a universal enquiry / first-response pipeline
        // (flavour "help" → TicketHelp). Log a customer's problem or question, the
        // team advises, then it closes with an outcome (or converts into a real
        // repair / deal / estimate / order). Deliberately short: Open → Reviewing →
        // Closed. Was the orphan "customer-support" repair-flavoured pipeline.
        id: "P2", name: "help-desk", label: "Help Desk",
        description: "Front-desk enquiries & first response — price, availability, technical info, warranty help",
        color: "bg-teal-100 text-teal-700", order: 2, entityType: "help",
        statuses: [
            { id: "S10", label: "Open", color: "bg-gray-100 text-gray-600", order: 1, isEntryPoint: true, isTerminal: false, pipelineId: "P2" },
            { id: "S11", label: "Reviewing", color: "bg-yellow-100 text-yellow-700", order: 2, isEntryPoint: false, isTerminal: false, pipelineId: "P2" },
            { id: "S16", label: "Closed", color: "bg-gray-100 text-gray-400", order: 3, isEntryPoint: false, isTerminal: true, pipelineId: "P2" },
        ],
    },
    {
        id: "P3", name: "sales", label: "Sales",
        description: "Sales pipeline for new customers and upsell opportunities",
        color: "bg-green-100 text-green-700", order: 3, entityType: "deal",
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
        id: "P4", name: "internal-management", label: "Internal Management",
        description: "Internal tasks, HR, admin, and operational workflows",
        color: "bg-purple-100 text-purple-700", order: 4, entityType: "task",
        statuses: [
            { id: "S24", label: "Open", color: "bg-gray-100 text-gray-600", order: 1, isEntryPoint: true, isTerminal: false, pipelineId: "P4" },
            { id: "S25", label: "In Review", color: "bg-yellow-100 text-yellow-700", order: 2, isEntryPoint: false, isTerminal: false, pipelineId: "P4" },
            { id: "S26", label: "In Progress", color: "bg-blue-100 text-blue-600", order: 3, isEntryPoint: false, isTerminal: false, pipelineId: "P4" },
            { id: "S27", label: "On Hold", color: "bg-orange-100 text-orange-600", order: 4, isEntryPoint: false, isTerminal: false, pipelineId: "P4" },
            { id: "S28", label: "Done", color: "bg-green-100 text-green-600", order: 5, isEntryPoint: false, isTerminal: true, pipelineId: "P4" },
        ],
    },
    {
        id: "P5", name: "marketing", label: "Marketing",
        description: "Marketing campaigns, content, and outreach initiatives",
        color: "bg-pink-100 text-pink-700", order: 5, entityType: "deal",
        statuses: [
            { id: "S29", label: "Idea", color: "bg-gray-100 text-gray-600", order: 1, isEntryPoint: true, isTerminal: false, pipelineId: "P5" },
            { id: "S30", label: "Planning", color: "bg-yellow-100 text-yellow-700", order: 2, isEntryPoint: false, isTerminal: false, pipelineId: "P5" },
            { id: "S31", label: "In Execution", color: "bg-blue-100 text-blue-600", order: 3, isEntryPoint: false, isTerminal: false, pipelineId: "P5" },
            { id: "S32", label: "Under Review", color: "bg-orange-100 text-orange-600", order: 4, isEntryPoint: false, isTerminal: false, pipelineId: "P5" },
            { id: "S33", label: "Live", color: "bg-teal-100 text-teal-600", order: 5, isEntryPoint: false, isTerminal: false, pipelineId: "P5" },
            { id: "S34", label: "Completed", color: "bg-green-100 text-green-600", order: 6, isEntryPoint: false, isTerminal: true, pipelineId: "P5" },
        ],
    },
    {
        id: "P7", name: "sales-orders", label: "Sales Orders",
        description: "Order processing pipeline — online, in-store, phone, and WhatsApp orders",
        color: "bg-amber-100 text-amber-800", order: 7, entityType: "voucher",
        statuses: [
            { id: "S42", label: "New", color: "bg-gray-100 text-gray-600", order: 1, isEntryPoint: true, isTerminal: false, pipelineId: "P7" },
            { id: "S43", label: "Under Review", color: "bg-yellow-100 text-yellow-700", order: 2, isEntryPoint: false, isTerminal: false, pipelineId: "P7", actionLabel: "Mark Under Review" },
            { id: "S44", label: "Confirmed", color: "bg-blue-100 text-blue-700", order: 3, isEntryPoint: false, isTerminal: false, pipelineId: "P7", actionLabel: "Confirm Order" },
            { id: "S45", label: "Packing", color: "bg-indigo-100 text-indigo-700", order: 4, isEntryPoint: false, isTerminal: false, pipelineId: "P7", actionLabel: "Start Packing" },
            { id: "S46", label: "Dispatched", color: "bg-purple-100 text-purple-700", order: 5, isEntryPoint: false, isTerminal: false, pipelineId: "P7", actionLabel: "Mark Dispatched" },
            { id: "S47", label: "Delivered", color: "bg-green-100 text-green-700", order: 6, isEntryPoint: false, isTerminal: true, pipelineId: "P7", actionLabel: "Mark Delivered" },
            { id: "S48", label: "Cancelled", color: "bg-gray-100 text-gray-400", order: 7, isEntryPoint: false, isTerminal: true, pipelineId: "P7", actionLabel: "Cancel Order" },
            { id: "S49", label: "Returned", color: "bg-red-100 text-red-600", order: 8, isEntryPoint: false, isTerminal: true, pipelineId: "P7", actionLabel: "Mark Returned" },
        ],
    },
    {
        id: "P8", name: "delivery", label: "Delivery",
        description: "Delivery / dispatch sub-pipeline — carrier dispatch & tracking for confirmed orders",
        color: "bg-sky-100 text-sky-800", order: 8, entityType: "delivery",
        statuses: [
            { id: "S50", label: "To Dispatch", color: "bg-gray-100 text-gray-600", order: 1, isEntryPoint: true, isTerminal: false, pipelineId: "P8" },
            { id: "S51", label: "Carrier Assigned", color: "bg-blue-100 text-blue-700", order: 2, isEntryPoint: false, isTerminal: false, pipelineId: "P8", actionLabel: "Assign Carrier" },
            { id: "S52", label: "Picked Up", color: "bg-indigo-100 text-indigo-700", order: 3, isEntryPoint: false, isTerminal: false, pipelineId: "P8", actionLabel: "Mark Picked Up" },
            { id: "S53", label: "In Transit", color: "bg-purple-100 text-purple-700", order: 4, isEntryPoint: false, isTerminal: false, pipelineId: "P8", actionLabel: "Mark In Transit" },
            { id: "S54", label: "Out for Delivery", color: "bg-amber-100 text-amber-700", order: 5, isEntryPoint: false, isTerminal: false, pipelineId: "P8", actionLabel: "Out for Delivery" },
            { id: "S55", label: "Delivered", color: "bg-green-100 text-green-700", order: 6, isEntryPoint: false, isTerminal: true, pipelineId: "P8", actionLabel: "Mark Delivered" },
            { id: "S56", label: "Failed / RTO", color: "bg-red-100 text-red-600", order: 7, isEntryPoint: false, isTerminal: true, pipelineId: "P8", actionLabel: "Mark Failed" },
        ],
    },
    {
        id: "P9", name: "refund", label: "Refund",
        description: "Refund sub-pipeline — pay back advances on rejected / cancelled orders",
        color: "bg-rose-100 text-rose-800", order: 9, entityType: "refund",
        statuses: [
            { id: "S57", label: "Requested", color: "bg-gray-100 text-gray-600", order: 1, isEntryPoint: true, isTerminal: false, pipelineId: "P9" },
            { id: "S58", label: "Approved", color: "bg-amber-100 text-amber-700", order: 2, isEntryPoint: false, isTerminal: false, pipelineId: "P9", actionLabel: "Approve Refund" },
            { id: "S59", label: "Refunded", color: "bg-green-100 text-green-700", order: 3, isEntryPoint: false, isTerminal: true, pipelineId: "P9", actionLabel: "Mark Refunded" },
            { id: "S60", label: "Rejected", color: "bg-red-100 text-red-600", order: 4, isEntryPoint: false, isTerminal: true, pipelineId: "P9", actionLabel: "Reject Refund" },
        ],
    },
    {
        id: "P6", name: "deals", label: "Deals",
        description: "Sales deal pipeline (revenue opportunities); stages shared with pipeline settings",
        color: "bg-cyan-100 text-cyan-800", order: 6, entityType: "deal",
        statuses: [
            { id: "S35", label: "Lead", color: "bg-gray-100 text-gray-600", order: 1, isEntryPoint: true, isTerminal: false, pipelineId: "P6" },
            { id: "S36", label: "Contacted", color: "bg-blue-100 text-blue-600", order: 2, isEntryPoint: false, isTerminal: false, pipelineId: "P6" },
            { id: "S37", label: "Qualified", color: "bg-teal-100 text-teal-600", order: 3, isEntryPoint: false, isTerminal: false, pipelineId: "P6" },
            { id: "S38", label: "Proposal Sent", color: "bg-yellow-100 text-yellow-700", order: 4, isEntryPoint: false, isTerminal: false, pipelineId: "P6" },
            { id: "S39", label: "Negotiation", color: "bg-orange-100 text-orange-600", order: 5, isEntryPoint: false, isTerminal: false, pipelineId: "P6" },
            { id: "S40", label: "Won", color: "bg-green-100 text-green-700", order: 6, isEntryPoint: false, isTerminal: true, pipelineId: "P6" },
            { id: "S41", label: "Lost", color: "bg-red-100 text-red-600", order: 7, isEntryPoint: false, isTerminal: true, pipelineId: "P6" },
        ],
    },
];

// Work GROUPS — categories that bundle works (the Work Inbox organises group-wise).
// `name` is the internal admin-facing name (Settings → Groups); `label` is the
// display name shown to staff / the merge key. They match here since the generic
// catalog has no same-label duplicates yet — a real install can add more later.
// Real hex colours, as configured in Settings → Workflow → Groups. They used to be
// Tailwind classes here, which the seeder replaced with a RANDOM hex on every run —
// so a reseed silently repainted the owner's groups. Storing the real values keeps a
// reseed a no-op for colour.
const WORK_GROUPS = [
    { id: "G1", name: "Calling", label: "Calling", order: 1, color: "#268D8A" },
    { id: "G2", name: "Repairing", label: "Repairing", order: 2, color: "#0D7FC2" },
    { id: "G3", name: "Admin", label: "Admin", order: 3, color: "#15C9CB" },
    { id: "G4", name: "Parts & Courier", label: "Parts & Courier", order: 4, color: "#B3D534" },
    { id: "G5", name: "Orders", label: "Orders", order: 5, color: "#8D085B" },
] as const;


const STATUS_TRANSITIONS = [
    // P1 Service & Repair — the live board, exactly as the workflow runs today.
    // Note there is no step OUT of S2 (Diagnosing): intake goes straight to S3,
    // and S2 is only reached by an explicit move. Captured from the live DB.
    { fromStatusId: "S1", toStatusId: "S3" },
    { fromStatusId: "S1", toStatusId: "S61" },
    { fromStatusId: "S1", toStatusId: "S66" },
    { fromStatusId: "S1", toStatusId: "S9" },
    { fromStatusId: "S3", toStatusId: "S6" },
    { fromStatusId: "S3", toStatusId: "S61" },
    { fromStatusId: "S3", toStatusId: "S62" },
    { fromStatusId: "S3", toStatusId: "S8" },
    { fromStatusId: "S3", toStatusId: "S9" },
    { fromStatusId: "S5", toStatusId: "S6" },
    { fromStatusId: "S5", toStatusId: "S8" },
    { fromStatusId: "S6", toStatusId: "S63" },
    { fromStatusId: "S6", toStatusId: "S7" },
    { fromStatusId: "S61", toStatusId: "S62" },
    { fromStatusId: "S61", toStatusId: "S65" },
    { fromStatusId: "S61", toStatusId: "S8" },
    { fromStatusId: "S62", toStatusId: "S65" },
    { fromStatusId: "S65", toStatusId: "S5" },
    { fromStatusId: "S66", toStatusId: "S63" },
    { fromStatusId: "S66", toStatusId: "S7" },
    { fromStatusId: "S8", toStatusId: "S63" },
    { fromStatusId: "S8", toStatusId: "S7" },
    { fromStatusId: "S9", toStatusId: "S63" },
    { fromStatusId: "S9", toStatusId: "S7" },
    // P7 Sales Orders
    { fromStatusId: "S42", toStatusId: "S43" },
    { fromStatusId: "S42", toStatusId: "S44" },
    { fromStatusId: "S42", toStatusId: "S48" },
    { fromStatusId: "S43", toStatusId: "S44" },
    { fromStatusId: "S43", toStatusId: "S48" },
    { fromStatusId: "S44", toStatusId: "S45" },
    { fromStatusId: "S44", toStatusId: "S48" },
    { fromStatusId: "S45", toStatusId: "S46" },
    { fromStatusId: "S46", toStatusId: "S47" },
    { fromStatusId: "S46", toStatusId: "S49" },
    // P8 Delivery
    { fromStatusId: "S50", toStatusId: "S51" },
    { fromStatusId: "S50", toStatusId: "S56" },
    { fromStatusId: "S51", toStatusId: "S52" },
    { fromStatusId: "S51", toStatusId: "S56" },
    { fromStatusId: "S52", toStatusId: "S53" },
    { fromStatusId: "S52", toStatusId: "S56" },
    { fromStatusId: "S53", toStatusId: "S54" },
    { fromStatusId: "S53", toStatusId: "S56" },
    { fromStatusId: "S54", toStatusId: "S55" },
    { fromStatusId: "S54", toStatusId: "S56" },
    // P9 Refund
    { fromStatusId: "S57", toStatusId: "S58" },
    { fromStatusId: "S57", toStatusId: "S60" },
    { fromStatusId: "S58", toStatusId: "S59" },
    { fromStatusId: "S58", toStatusId: "S60" },
];

// Works · TicketWorkers · worker transitions · per-status start workers:
// DELIBERATELY NOT SEEDED. The live database has ZERO rows in Work, WorkGroupWork,
// TicketWorker and WorkerTransition, and no TicketStatus carries a startWorkerId —
// the business runs its board on statuses alone. This file used to seed 9 works and
// 43 workers that nothing used, which made every reseed re-create an automation
// layer staff had already abandoned.
//
// The 5 WorkGroups above ARE used (they tag and filter the Work Inbox) and stay.
//
// If works/workers are adopted later: build them in the UI first, then mirror them
// back here in the same commit — live DB is the source of truth for this section.

// ════════════════════════════════════════════════════════════════════════════
// SECTION 3 — Org structure: Branches + Departments
// ════════════════════════════════════════════════════════════════════════════

// Only HQ — the one branch every setup needs. Add more via UI later.
// HQ inherits the organisation address from COMPANY_DETAILS — for a single-
// state business this lets you start with a printable invoice address on
// day one. Admins add further branches (regional / online) via the UI.
//
// The online channel has no branch of its own: ONLINE_ORDER / ONLINE_INVOICE
// run under HQ like every other voucher. (When per-storefront branches arrive,
// resolve by domain → branch.)
const HQ_GSTIN = COMPANY_DETAILS.tax.gstin ?? "";
const BRANCHES = [
    {
        id: "BR-HQ",
        // 9 is the live branch number — it prefixes voucher numbers, so seeding 1
        // on a reseed would renumber the whole shop's documents.
        number: 9,
        name: "Head Office",
        // Legacy single-line — kept for old list rows that still consult it.
        address: `${COMPANY_DETAILS.address.line1}, ${COMPANY_DETAILS.address.city}`,
        phone: COMPANY_DETAILS.contact.phone || null,
        // Structured identity for invoice headers / letterheads
        addressLine1: COMPANY_DETAILS.address.line1,
        addressLine2: COMPANY_DETAILS.address.line2 ?? "",
        city: COMPANY_DETAILS.address.city,
        state: COMPANY_DETAILS.address.state,
        pinCode: COMPANY_DETAILS.address.pin,
        country: COMPANY_DETAILS.address.country,
        email: COMPANY_DETAILS.contact.email || null,
        gstin: HQ_GSTIN,
        gstStateCode: HQ_GSTIN.length >= 2 ? HQ_GSTIN.slice(0, 2) : "",
    },
];

// Couriers the storefront offers at checkout, exactly as configured in
// Settings → Couriers. These are OUR real rates, not generic placeholders:
// Local delivery carries per-neighbourhood pricing for the pincodes we actually
// serve (783384 Abhayapuri / Lengtisinga, 783380 Barpara), Standard courier
// carries the INDIA POST zone rates, and Shiprocket / Shipway carry our pickup
// pincode. Seeding is create-only per kind, so rate edits in the UI survive a
// reseed — change a rate in the app, then re-capture; do not hand-edit here.
const DELIVERY_METHODS = [
    {
        kind: "OWN_BOY",
        displayName: "Local delivery",
        isActive: true,
        sortOrder: 0,
        configJson: {
            "pincodes": [],
            "vehicles": [
                {
                    "name": "Quick Delivery 30 Minutes",
                    "isActive": true,
                    "baseGrams": 30000,
                    "stepGrams": 10000,
                    "freeAbovePaise": 500000,
                    "maxWeightGrams": 50000,
                    "neighbourhoods": {
                        "783380": {
                            "Barpara": {
                                "addlPaise": 2000,
                                "basePaise": 5000,
                                "neighbourhoods": [
                                    {
                                        "name": "LIC Office"
                                    }
                                ]
                            }
                        },
                        "783384": {
                            "Abhayapuri": {
                                "addlPaise": 1000,
                                "basePaise": 2000,
                                "neighbourhoods": [
                                    {
                                        "name": "Nama bazar"
                                    },
                                    {
                                        "name": "College Market"
                                    },
                                    {
                                        "name": "Rajib Bhawan"
                                    }
                                ]
                            },
                            "Lengtisinga": {
                                "addlPaise": 1000,
                                "basePaise": 2000,
                                "neighbourhoods": [
                                    {
                                        "name": "Lockdown Bazar"
                                    },
                                    {
                                        "name": "BoroBhanga"
                                    },
                                    {
                                        "name": "Lengtisinga Bazar"
                                    }
                                ]
                            }
                        }
                    }
                },
                {
                    "name": "Same Day Delivery",
                    "isActive": true,
                    "baseGrams": 500,
                    "stepGrams": 500,
                    "freeAbovePaise": 0,
                    "neighbourhoods": {
                        "783380": {
                            "Barpara": {
                                "addlPaise": 10000,
                                "basePaise": 10000,
                                "neighbourhoods": [
                                    {
                                        "name": "LIC Office"
                                    }
                                ]
                            }
                        },
                        "783384": {
                            "Abhayapuri": {
                                "addlPaise": 3000,
                                "basePaise": 3000,
                                "neighbourhoods": [
                                    {
                                        "name": "Nama bazar"
                                    },
                                    {
                                        "name": "College Market"
                                    },
                                    {
                                        "name": "Rajib Bhawan"
                                    }
                                ]
                            },
                            "Lengtisinga": {
                                "addlPaise": 5000,
                                "basePaise": 5000,
                                "neighbourhoods": [
                                    {
                                        "name": "Lockdown Bazar"
                                    },
                                    {
                                        "name": "BoroBhanga"
                                    },
                                    {
                                        "name": "Lengtisinga Bazar"
                                    }
                                ]
                            }
                        }
                    }
                },
                {
                    "name": "Store Pickup",
                    "isActive": true,
                    "baseGrams": 500,
                    "stepGrams": 500,
                    "freeAbovePaise": 0,
                    "neighbourhoods": {}
                }
            ],
            "baseGrams": 50000,
            "flatPaise": 0,
            "stepGrams": 50000,
            "freeAbovePaise": 500000,
            "neighbourhoods": {}
        },
    },
    {
        kind: "CUSTOM",
        displayName: "Standard courier",
        isActive: true,
        sortOrder: 1,
        configJson: {
            "mode": "FLAT",
            "services": [
                {
                    "mode": "ZONE",
                    "name": "INDIA POST",
                    "zones": [
                        {
                            "name": "All India",
                            "states": [],
                            "addlPaise": 3800,
                            "basePaise": 13600,
                            "isDefault": true,
                            "pincodePrefixes": []
                        }
                    ],
                    "isActive": true,
                    "baseGrams": 2000,
                    "stepGrams": 1000,
                    "codPercent": 1.6,
                    "codFlatPaise": 2000,
                    "freeAbovePaise": 0
                }
            ],
            "flatPaise": 9900,
            "codPercent": 0,
            "codFlatPaise": 0,
            "freeAbovePaise": 500000
        },
    },
    {
        kind: "SHIPROCKET",
        displayName: "Shiprocket",
        isActive: true,
        sortOrder: 2,
        configJson: {
            "height": 10,
            "length": 15,
            "breadth": 15,
            "exclude": {
                "states": [],
                "pincodePrefixes": [
                    "783384"
                ]
            },
            "pickupPincode": "783384",
            "pickupLocation": "Primary",
            "defaultItemWeightGrams": 500
        },
    },
    {
        kind: "SHIPWAY",
        displayName: "Shipway",
        isActive: true,
        sortOrder: 3,
        configJson: {
            "height": 10,
            "length": 15,
            "breadth": 15,
            "exclude": {
                "states": [],
                "pincodePrefixes": [
                    "783384"
                ]
            },
            "pickupPincode": "783384",
            "pickupLocation": "Primary",
            "defaultItemWeightGrams": 500
        },
    },
    {
        kind: "STORE_PICKUP",
        displayName: "Pickup from store",
        isActive: true,
        sortOrder: 4,
        configJson: {
            "note": "Collect Within 3 Working Days , 10AM to 8PM, Saturday to Thursday, Friday Close.",
            "include": {
                "states": [],
                "pincodePrefixes": [
                    "783384"
                ]
            }
        },
    },
    {
        kind: "FREE_DELIVERY",
        displayName: "Free delivery",
        isActive: false,
        sortOrder: 5,
        configJson: {
            "exclude": {
                "states": [],
                "pincodePrefixes": [
                    "783384"
                ]
            },
            "include": {
                "states": [],
                "pincodePrefixes": [
                    "783384"
                ]
            }
        },
    },
] as const;

// Online payment gateways. `settlementLedger` is the NAME of the GL ledger each
// gateway settles into (seeded in Section 4 under the "Payment Gateway" group).
//
// It is a name and not an id ON PURPOSE. The live rows store the settlement account
// as a raw integer inside configJson, and integer ids do not survive a reseed into a
// fresh database — they would point at whatever ledger happened to take that id, or
// at nothing. The seeder resolves the name to the local id at run time instead.
//
// Credentials are NEVER seeded. Keys live in env / the gateway settings UI; a seeded
// row carries only the routing and the settlement link.
const GATEWAYS = [
    {
        provider: "pay_on_delivery",
        displayName: "Pay on delivery",
        environment: "TEST",
        enabledForCounter: false,
        enabledForOnline: false,
        isActive: true,
        sortOrder: 0,
        settlementLedger: "ShipRoket COD",
        configJson: {
            "area": {
                "mode": "except",
                "states": [],
                "pincodePrefixes": []
            }
        },
    },
    {
        provider: "razorpay",
        displayName: "Razorpay",
        environment: "LIVE",
        enabledForCounter: false,
        enabledForOnline: true,
        isActive: true,
        sortOrder: 10,
        settlementLedger: "Razorpay",
        configJson: {},
    },
    {
        provider: "payu",
        displayName: "PayU",
        environment: "TEST",
        enabledForCounter: false,
        enabledForOnline: true,
        isActive: false,
        sortOrder: 20,
        settlementLedger: "Payu",
        configJson: {},
    },
    {
        provider: "cashfree",
        displayName: "Cashfree",
        environment: "TEST",
        enabledForCounter: false,
        enabledForOnline: true,
        isActive: false,
        sortOrder: 30,
        settlementLedger: "Cashfree",
        configJson: {},
    },
] as const;

const DEPARTMENTS: { id: string; name: string; description: string; isAllAccess?: boolean }[] = [
    // All-access department — home for cross-cutting roles (R1 Admin). Its
    // permission pool is "every permission" (computed live; no DepartmentPermission
    // rows), so new permissions are auto-grantable to admin roles. Exactly one
    // department carries isAllAccess.
    { id: "DEP-ADMIN", name: "Administration", description: "Org-wide administration — all-access role authoring", isAllAccess: true },
    { id: "DEP-REPAIR", name: "Repairs", description: "Device diagnosis and repair" },
    { id: "DEP-SALES", name: "Sales", description: "Sales and customer acquisition" },
    { id: "DEP-DESK", name: "Front Desk", description: "Customer intake, calls, and receipts" },
    { id: "DEP-FIN", name: "Finance", description: "Accounts, invoices, and reporting" },
    { id: "DEP-HR", name: "HR", description: "People operations and recruitment" },
    { id: "DEP-IT", name: "IT / Admin", description: "Systems, infrastructure, and admin" },
    { id: "DEP-DESP", name: "Despatch", description: "Courier, logistics, and shipping" },
    // Home of R2 Branch Manager. Spelling "Managment" is what the live row says —
    // matched deliberately so a reseed does not rename the owner's department.
    { id: "DEP-OP", name: "Managment", description: "Day To Day Business Work" },
];

// ════════════════════════════════════════════════════════════════════════════
// SECTION 4 — Chart of Accounts: Groups + GL Ledgers
// ════════════════════════════════════════════════════════════════════════════
//
// Stock-in-Hand group is intentionally EMPTY. Live closing-stock value
// (`getClosingStockValue` in `src/modules/accountancy/lib/closingStock.ts`)
// is injected as a synthetic ledger by the BS API at report time — adding
// real GL accounts here would double-count.

type GroupType = "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE";
type NormBal = "DEBIT" | "CREDIT";

async function upsertGroup(
    name: string, type: GroupType, sortOrder: number, parentId?: number,
): Promise<number> {
    const { rows } = await pool.query<{ id: number }>(
        `SELECT id FROM "AccountGroup" WHERE name = $1 LIMIT 1`,
        [name],
    );
    if (rows[0]) {
        await pool.query(
            `UPDATE "AccountGroup" SET type = $1, "sortOrder" = $2, "parentId" = $3 WHERE id = $4`,
            [type, sortOrder, parentId ?? null, rows[0].id],
        );
        return rows[0].id;
    }
    const ins = await pool.query<{ id: number }>(
        `INSERT INTO "AccountGroup" (name, type, "sortOrder", "parentId", "isActive")
         VALUES ($1, $2, $3, $4, true) RETURNING id`,
        [name, type, sortOrder, parentId ?? null],
    );
    return ins.rows[0].id;
}

async function upsertLedger(
    name: string, groupName: string | null, normalBalance: NormBal | null, code?: string,
): Promise<void> {
    let groupId: number | null = null;
    if (groupName) {
        const { rows } = await pool.query<{ id: number }>(
            `SELECT id FROM "AccountGroup" WHERE name = $1 LIMIT 1`,
            [groupName],
        );
        groupId = rows[0]?.id ?? null;
    }
    // Code is the stable identity. If a ledger already holds this code — even
    // under a different name (admins rename the seeded "Bank Account" to their
    // real bank, etc.) — that row IS this ledger: backfill a missing group only,
    // never rename, never re-insert (which would trip Account_code_key).
    if (code) {
        const { rows: byCode } = await pool.query<{ id: number; "groupId": number | null }>(
            `SELECT id, "groupId" FROM "Account"
             WHERE code = $1 AND "personId" IS NULL AND "companyId" IS NULL
             LIMIT 1`,
            [code],
        );
        if (byCode[0]) {
            if (byCode[0].groupId === null && groupId !== null) {
                await pool.query(`UPDATE "Account" SET "groupId" = $1 WHERE id = $2`, [groupId, byCode[0].id]);
            }
            return;
        }
    }
    const { rows } = await pool.query<{ id: number; "groupId": number | null; code: string | null }>(
        `SELECT id, "groupId", code FROM "Account"
         WHERE LOWER(name) = LOWER($1)
           AND "personId" IS NULL AND "companyId" IS NULL
         LIMIT 1`,
        [name],
    );
    if (rows[0]) {
        const updates: string[] = [];
        const vals: unknown[] = [];
        if (rows[0].groupId === null && groupId !== null) { vals.push(groupId); updates.push(`"groupId" = $${vals.length}`); }
        if (rows[0].code === null && code) { vals.push(code); updates.push(`code = $${vals.length}`); }
        if (updates.length) {
            vals.push(rows[0].id);
            await pool.query(`UPDATE "Account" SET ${updates.join(", ")} WHERE id = $${vals.length}`, vals);
        }
        return;
    }
    await pool.query(
        `INSERT INTO "Account" (name, code, "normalBalance", "groupId", "isActive", balance, "createdAt")
         VALUES ($1, $2, $3, $4, true, 0, NOW())`,
        [name, code ?? null, normalBalance, groupId],
    );
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 5 — Admin User
// ════════════════════════════════════════════════════════════════════════════

const ADMIN = {
    email: "admin@networkservice.in",
    name: "Admin",
    role: "R1",
    password: "admin123",
};

// ════════════════════════════════════════════════════════════════════════════
// SECTION 6 — DB constraints (XOR on Phone/Email ownership)
// ════════════════════════════════════════════════════════════════════════════

// Shared impl lives in ./lib/codeOwnedCatalog.ts (personal-bootstrap uses it too).
const ensureXorCheck = (table: "Phone" | "Email", constraintName: string) => ensureXorCheckShared(pool, table, constraintName);
// ════════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════════

async function main() {
    // A counter PC's database is a replica; seeding it mints ids that collide with
    // real Supabase rows. Checked before anything is written.
    assertNotCounterReplica("bootstrap-seed");

    console.log("\n━━━ BOOTSTRAP SEED ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("  Run: pnpm prisma db seed\n");

    // ── Section 1: RBAC ────────────────────────────────────────────────
    console.log("[1/7] RBAC — Roles, Permissions, Role grants");
    // Departments first — Role.departmentId is a required FK, so the all-access
    // department (DEP-ADMIN, R1's home) must exist before roles are upserted.
    for (const d of DEPARTMENTS) {
        await pool.query(
            `INSERT INTO "Department" (id, name, description, "branchId", "isAllAccess")
             VALUES ($1, $2, $3, NULL, $4)
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, "isAllAccess" = EXCLUDED."isAllAccess"`,
            [d.id, d.name, d.description, d.isAllAccess ?? false],
        );
    }
    for (const r of ROLES) {
        await prisma.role.upsert({
            where: { id: r.id },
            update: { label: r.label, color: r.color, isSystem: r.isSystem, rank: r.rank, departmentId: r.departmentId },
            create: { id: r.id, label: r.label, color: r.color, isSystem: r.isSystem, rank: r.rank, departmentId: r.departmentId },
        });
    }
    for (const p of PERMISSIONS) {
        await prisma.permission.upsert({
            where: { id: p.id },
            update: { label: p.label, module: p.module, description: p.description },
            create: p,
        });
    }
    const seededRoleIds = Object.keys(ROLE_PERMISSIONS);
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: seededRoleIds } } });
    const grants = Object.entries(ROLE_PERMISSIONS).flatMap(([roleId, ids]) =>
        ids.map((permissionId) => ({ roleId, permissionId })),
    );
    await prisma.rolePermission.createMany({ data: grants, skipDuplicates: true });

    // Prune retired permissions. The catalog was upsert-only, so every id ever
    // removed from the code lingered in the table (and cluttered the Department
    // pool picker). Delete anything not in the current catalog — except the
    // runtime work:/workgroup: ids a gated Work / WorkGroup mints (kept by
    // reference so we never depend on the prefix). Cascade FKs drop the dead
    // role / user / department grants automatically.
    const keepIds = new Set(PERMISSIONS.map((p) => p.id));
    const workRefs = await prisma.$queryRaw<{ permissionId: string }[]>`
        SELECT "permissionId" FROM "Work"      WHERE "permissionId" IS NOT NULL
        UNION
        SELECT "permissionId" FROM "WorkGroup" WHERE "permissionId" IS NOT NULL`;
    for (const r of workRefs) keepIds.add(r.permissionId);
    const pruned = await prisma.permission.deleteMany({ where: { id: { notIn: [...keepIds] } } });
    console.log(`      ✓ ${ROLES.length} roles · ${PERMISSIONS.length} permissions · ${grants.length} grants · pruned ${pruned.count} retired\n`);

    // ── Section 2: Workflow ────────────────────────────────────────────
    console.log("[2/7] Workflow — Pipelines, Statuses, Work groups, Transitions");
    for (const pl of PIPELINES) {
        await prisma.pipeline.upsert({
            where: { id: pl.id },
            update: { name: pl.name, label: pl.label, description: pl.description, color: pl.color, isDefault: pl.isDefault ?? false, isActive: true, order: pl.order, entityType: pl.entityType },
            create: { id: pl.id, name: pl.name, label: pl.label, description: pl.description, color: pl.color, isDefault: pl.isDefault ?? false, isActive: true, order: pl.order, entityType: pl.entityType },
        });
        for (const s of pl.statuses) {
            await prisma.ticketStatus.upsert({
                where: { id: s.id },
                update: { label: s.label, color: s.color, order: s.order, isTerminal: s.isTerminal, isEntryPoint: s.isEntryPoint, actionLabel: s.actionLabel ?? null, warrantyScope: "any", leavePrompt: s.leavePrompt ?? null, announceOnEntry: s.announceOnEntry ?? false, etaText: s.etaText ?? null, resolveTimeHours: s.resolveTimeHours ?? null, pipelineId: s.pipelineId },
                create: { id: s.id, label: s.label, color: s.color, order: s.order, isTerminal: s.isTerminal, isEntryPoint: s.isEntryPoint, actionLabel: s.actionLabel ?? null, warrantyScope: "any", leavePrompt: s.leavePrompt ?? null, announceOnEntry: s.announceOnEntry ?? false, etaText: s.etaText ?? null, resolveTimeHours: s.resolveTimeHours ?? null, pipelineId: s.pipelineId },
            });
        }
    }
    for (const g of WORK_GROUPS) {
        await prisma.workGroup.upsert({
            where: { id: g.id },
            update: { name: g.name, label: g.label, color: g.color, order: g.order },
            create: { id: g.id, name: g.name, label: g.label, color: g.color, order: g.order },
        });
    }
    for (const t of STATUS_TRANSITIONS) {
        await prisma.statusTransition.upsert({
            where: { fromStatusId_toStatusId: { fromStatusId: t.fromStatusId, toStatusId: t.toStatusId } },
            update: {},
            create: t,
        });
    }
    console.log(`      ✓ ${PIPELINES.length} pipelines · ${PIPELINES.reduce((s, p) => s + p.statuses.length, 0)} statuses · ${WORK_GROUPS.length} work groups · ${STATUS_TRANSITIONS.length} transitions\n`);

    // ── Section 3: Org structure ────────────────────────────────────────
    console.log("[3/7] Org structure — Branches, Departments");
    for (const b of BRANCHES) {
        // Re-seed contract: insert with the full identity on a fresh DB so
        // invoices have a printable address on day one. On re-seed we touch
        // only `name`, `number` and `isActive` — every other column is preserved so
        // admin edits via /office/admin/branches survive `pnpm prisma db seed`.
        await pool.query(
            `INSERT INTO "Branch" (
                id, number, name, address, phone, "isActive",
                "addressLine1", "addressLine2", city, state, "pinCode", country,
                email, gstin, "gstStateCode"
             )
             VALUES ($1, $2, $3, $4, $5, true,
                     $6, $7, $8, $9, $10, $11,
                     $12, $13, $14)
             ON CONFLICT (id) DO UPDATE SET number = EXCLUDED.number, name = EXCLUDED.name, "isActive" = true`,
            [
                b.id, b.number, b.name, b.address, b.phone,
                b.addressLine1, b.addressLine2, b.city, b.state, b.pinCode, b.country,
                b.email, b.gstin, b.gstStateCode,
            ],
        );
    }
    // Departments are seeded in Section 1 (RBAC) because Role.departmentId is a
    // required FK that depends on DEP-ADMIN existing before roles are created.
    console.log(`      ✓ ${BRANCHES.length} branches · ${DEPARTMENTS.length} departments (seeded in §1)\n`);

    // ── Section 4: Chart of accounts ───────────────────────────────────
    console.log("[4/7] Chart of accounts — Groups + GL ledgers (Stock-in-Hand intentionally empty)");

    // Primary groups
    const capitalAccountId = await upsertGroup("Capital Account", "LIABILITY", 10);
    const loansLiabilityId = await upsertGroup("Loans (Liability)", "LIABILITY", 20);
    const currentLiabilitiesId = await upsertGroup("Current Liabilities", "LIABILITY", 30);
    await upsertGroup("Fixed Assets", "ASSET", 40);
    await upsertGroup("Investments", "ASSET", 50);
    const currentAssetsId = await upsertGroup("Current Assets", "ASSET", 60);
    await upsertGroup("Branch / Divisions", "ASSET", 70);
    await upsertGroup("Misc. Expenses (Asset)", "ASSET", 80);
    await upsertGroup("Suspense A/c", "ASSET", 90);
    await upsertGroup("Sales Accounts", "INCOME", 100);
    await upsertGroup("Purchase Accounts", "EXPENSE", 110);
    await upsertGroup("Direct Incomes", "INCOME", 120);
    await upsertGroup("Direct Expenses", "EXPENSE", 130);
    await upsertGroup("Indirect Incomes", "INCOME", 140);
    await upsertGroup("Indirect Expenses", "EXPENSE", 150);

    // Sub-groups
    await upsertGroup("Reserves & Surplus", "LIABILITY", 10, capitalAccountId);
    await upsertGroup("Bank OD A/c", "LIABILITY", 10, loansLiabilityId);
    await upsertGroup("Credit Card", "LIABILITY", 15, loansLiabilityId);
    await upsertGroup("BNPL A/c", "LIABILITY", 17, loansLiabilityId);
    await upsertGroup("Secured Loans", "LIABILITY", 20, loansLiabilityId);
    await upsertGroup("Unsecured Loans", "LIABILITY", 30, loansLiabilityId);
    await upsertGroup("Duties & Taxes", "LIABILITY", 10, currentLiabilitiesId);
    await upsertGroup("Provisions", "LIABILITY", 20, currentLiabilitiesId);
    await upsertGroup("Sundry Creditors", "LIABILITY", 30, currentLiabilitiesId);
    await upsertGroup("Stock-in-Hand", "ASSET", 10, currentAssetsId);
    await upsertGroup("Deposits (Asset)", "ASSET", 20, currentAssetsId);
    await upsertGroup("Loans & Advances (Asset)", "ASSET", 30, currentAssetsId);
    await upsertGroup("Sundry Debtors", "ASSET", 40, currentAssetsId);
    await upsertGroup("Cash-in-Hand", "ASSET", 50, currentAssetsId);
    await upsertGroup("Bank Accounts", "ASSET", 60, currentAssetsId);
    await upsertGroup("Wallets", "ASSET", 65, currentAssetsId);
    // Payment Gateway — the settlement bucket every online collection lands in.
    // It used to be left out as "real-config only", but Section 17 seeds the
    // gateways themselves and each one needs a settlement ledger that lives HERE,
    // so the group has to exist before them.
    await upsertGroup("Payment Gateway", "ASSET", 66, currentAssetsId);

    // GL ledgers — Stock-in-Hand intentionally has NO children.
    await upsertLedger("Cash", "Cash-in-Hand", "DEBIT", "1000");
    await upsertLedger("Petty Cash", "Cash-in-Hand", "DEBIT");
    await upsertLedger("Bank Account", "Bank Accounts", "DEBIT", "1010");
    // Gateway settlement ledgers. Section 17 points each PaymentGateway at one of
    // these BY NAME — the live rows carry no account code, so the name is the key.
    // Rename one here and you must rename it in GATEWAYS too, or the link silently
    // fails to resolve and that gateway is skipped.
    await upsertLedger("Razorpay", "Payment Gateway", "DEBIT");
    await upsertLedger("Payu", "Payment Gateway", "DEBIT");
    await upsertLedger("Cashfree", "Payment Gateway", "DEBIT");
    await upsertLedger("ShipRoket COD", "Payment Gateway", "DEBIT");
    await upsertLedger("Accounts Receivable", "Sundry Debtors", "DEBIT", "1100");
    await upsertLedger("Accounts Payable", "Sundry Creditors", "CREDIT", "2000");
    await upsertLedger("Walk-in Cash Customer", "Sundry Debtors", "DEBIT", "CASH-WALKIN");
    await upsertLedger("Prepaid Expenses", "Loans & Advances (Asset)", "DEBIT", "1300");
    await upsertLedger("Profit & Loss A/c", null, "CREDIT");
    await upsertLedger("Capital", "Capital Account", "CREDIT", "3000");
    await upsertLedger("Drawings", "Capital Account", "DEBIT");
    await upsertLedger("Retained Earnings", "Reserves & Surplus", "CREDIT", "3100");
    await upsertLedger("Sales A/c", "Sales Accounts", "CREDIT");
    await upsertLedger("Parts Revenue", "Sales Accounts", "CREDIT", "4100");
    await upsertLedger("Shop Sales Revenue", "Sales Accounts", "CREDIT", "4150");
    await upsertLedger("Purchase A/c", "Purchase Accounts", "DEBIT");
    await upsertLedger("Sales Returns", "Sales Accounts", "DEBIT");
    await upsertLedger("Purchase Returns", "Purchase Accounts", "CREDIT");
    await upsertLedger("CGST", "Duties & Taxes", "CREDIT");
    await upsertLedger("SGST", "Duties & Taxes", "CREDIT");
    await upsertLedger("IGST", "Duties & Taxes", "CREDIT");
    await upsertLedger("UTGST", "Duties & Taxes", "CREDIT");
    await upsertLedger("TDS", "Duties & Taxes", "CREDIT");
    await upsertLedger("Tax Payable", "Duties & Taxes", "CREDIT", "2100");
    await upsertLedger("Professional Tax", "Duties & Taxes", "CREDIT");
    await upsertLedger("ESI Payable", "Duties & Taxes", "CREDIT");
    await upsertLedger("PF Payable", "Duties & Taxes", "CREDIT");
    await upsertLedger("Accrued Expenses", "Provisions", "CREDIT", "2200");
    await upsertLedger("Provision for Tax", "Provisions", "CREDIT");
    await upsertLedger("Provision for Bad Debts", "Provisions", "CREDIT");
    await upsertLedger("General Reserve", "Reserves & Surplus", "CREDIT");
    await upsertLedger("Service Charges Income", "Direct Incomes", "CREDIT", "4000");
    await upsertLedger("Warranty Revenue", "Direct Incomes", "CREDIT", "4200");
    await upsertLedger("Other Revenue", "Indirect Incomes", "CREDIT", "4900");
    await upsertLedger("Discount Received", "Indirect Incomes", "CREDIT");
    // Outward freight collected from customers on the sale invoice.
    // Separated from Sales A/c so the P&L breaks out delivery revenue.
    await upsertLedger("Shipping Income", "Indirect Incomes", "CREDIT");
    await upsertLedger("Round Off", "Indirect Incomes", "CREDIT");
    await upsertLedger("Interest Received", "Indirect Incomes", "CREDIT");
    await upsertLedger("Commission Received", "Indirect Incomes", "CREDIT");
    await upsertLedger("Cost of Parts Sold", "Direct Expenses", "DEBIT", "5000");
    await upsertLedger("Tools & Equipment", "Direct Expenses", "DEBIT", "6300");
    await upsertLedger("Repair & Maintenance", "Direct Expenses", "DEBIT");
    await upsertLedger("Consumables & Spares", "Direct Expenses", "DEBIT");
    await upsertLedger("Freight Charges", "Direct Expenses", "DEBIT");
    await upsertLedger("Carriage Inward", "Direct Expenses", "DEBIT");
    await upsertLedger("Salary & Wages", "Indirect Expenses", "DEBIT", "6200");
    await upsertLedger("Rent", "Indirect Expenses", "DEBIT", "6000");
    await upsertLedger("Utilities Expense", "Indirect Expenses", "DEBIT", "6100");
    await upsertLedger("Miscellaneous Expense", "Indirect Expenses", "DEBIT", "6900");
    await upsertLedger("Electricity Charges", "Indirect Expenses", "DEBIT");
    await upsertLedger("Telephone / Internet", "Indirect Expenses", "DEBIT");
    await upsertLedger("Discount Allowed", "Indirect Expenses", "DEBIT");
    // Dedicated expense ledger for loyalty-point redemptions (kept separate from
    // "Discount Allowed" so the P&L breaks out the cost of the loyalty programme).
    // Redemption posts here as a negative InvVoucherCharge on the POS sale.
    await upsertLedger("Loyalty Points Redeemed", "Indirect Expenses", "DEBIT");
    // Dedicated expense ledger for coupon/promo discounts (kept separate from
    // "Discount Allowed" + "Loyalty Points Redeemed" so the P&L breaks out the
    // cost of each promotion channel). Posts as a negative InvVoucherCharge.
    await upsertLedger("Coupon Discounts", "Indirect Expenses", "DEBIT");
    // Gift-card prepaid liability (Phase 4): issuing a gift card credits this;
    // redeeming one debits it via a payment tender on the POS sale.
    await upsertLedger("Gift Card Liability", "Current Liabilities", "CREDIT");
    // Breakage income: when a gift card expires unredeemed, the leftover liability
    // is recognised here (Dr Gift Card Liability / Cr this).
    await upsertLedger("Gift Card Breakage", "Indirect Incomes", "CREDIT");
    await upsertLedger("Bad Debts", "Indirect Expenses", "DEBIT");
    await upsertLedger("Bank Charges", "Indirect Expenses", "DEBIT");
    await upsertLedger("Audit Fees", "Indirect Expenses", "DEBIT");
    await upsertLedger("Printing & Stationery", "Indirect Expenses", "DEBIT");
    await upsertLedger("Postage & Courier", "Indirect Expenses", "DEBIT");
    await upsertLedger("Advertisement", "Indirect Expenses", "DEBIT");
    await upsertLedger("Travelling Expenses", "Indirect Expenses", "DEBIT");
    await upsertLedger("Insurance", "Indirect Expenses", "DEBIT");
    await upsertLedger("Depreciation", "Indirect Expenses", "DEBIT");
    await upsertLedger("Interest Paid", "Indirect Expenses", "DEBIT");
    await upsertLedger("Commission Paid", "Indirect Expenses", "DEBIT");
    await upsertLedger("Furniture & Fixtures", "Fixed Assets", "DEBIT");
    await upsertLedger("Computer & Peripherals", "Fixed Assets", "DEBIT");
    await upsertLedger("Office Equipment", "Fixed Assets", "DEBIT");
    await upsertLedger("Plant & Machinery", "Fixed Assets", "DEBIT");
    await upsertLedger("CCTV & Security Equipment", "Fixed Assets", "DEBIT");
    await upsertLedger("Security Deposit", "Deposits (Asset)", "DEBIT");
    await upsertLedger("Earnest Money Deposit", "Deposits (Asset)", "DEBIT");
    await upsertLedger("Staff Advance", "Loans & Advances (Asset)", "DEBIT");
    await upsertLedger("Advance to Suppliers", "Loans & Advances (Asset)", "DEBIT");
    await upsertLedger("TDS Receivable", "Loans & Advances (Asset)", "DEBIT");
    await upsertLedger("Preliminary Expenses", "Misc. Expenses (Asset)", "DEBIT");
    // POS cash-drawer variance — sister P&L accounts used by shift close
    // adjustment JEs. Short = staff handed in less than expected (expense);
    // Over = handed in more (income).
    await upsertLedger("Cash Short", "Indirect Expenses", "DEBIT", "6950");
    await upsertLedger("Cash Over", "Indirect Incomes", "CREDIT", "4950");
    // "Difference in Opening Balances" is intentionally NOT seeded — it's
    // a pure synthetic computed by the BS UI = |Σ Dr opening − Σ Cr opening|,
    // shown on the side that needs balancing. Don't add a real ledger by
    // this name; it would double-count.

    // ── Per-branch Vault accounts + wire Branch.vaultAccountId ──────────────
    // Each branch needs a "Cash – Vault – <Branch>" under Cash-in-Hand.
    // This is where surplus cash lands at end-of-day (closing Contra).
    for (const b of BRANCHES) {
        const vaultName = `Cash – Vault – ${b.name}`;
        await upsertLedger(vaultName, "Cash-in-Hand", "DEBIT");
        const { rows: vaultRows } = await pool.query<{ id: number }>(
            `SELECT id FROM "Account" WHERE LOWER(name) = LOWER($1) LIMIT 1`,
            [vaultName],
        );
        if (vaultRows[0]) {
            await pool.query(
                `UPDATE "Branch" SET "vaultAccountId" = $1 WHERE id = $2`,
                [vaultRows[0].id, b.id],
            );
        }
    }

    // ── Per-branch POS Counters (physical billing stations) ──────────────────
    // Bootstrap creates one default counter per branch ("Counter 1").
    // Admins can add more via UI. Each counter has its own till GL account
    // ("Cash – Counter 1 – <Branch>") so per-counter cash flow is traceable.
    // Counter tills are NOT personal-user accounts — any cashier can work
    // a counter. Shortage accountability is via the shift report, not GL.
    for (const b of BRANCHES) {
        const counterName = "Counter 1";
        const tillName = `Cash – Counter 1 – ${b.name}`;
        await upsertLedger(tillName, "Cash-in-Hand", "DEBIT");
        const { rows: tillRows } = await pool.query<{ id: number }>(
            `SELECT id FROM "Account" WHERE LOWER(name) = LOWER($1) LIMIT 1`,
            [tillName],
        );
        if (!tillRows[0]) continue;
        const tillId = tillRows[0].id;

        // Upsert the PosCounter row. The counter's payment accounts (UPI/Card/…
        // rows in PosCounterPaymentAccount, each with a bank ledger + optional VPA)
        // are operator-configured under /office/admin/counters, not bootstrap
        // defaults — a fresh counter starts with Cash (the till) only.
        // Likewise the PaymentGateway catalog (Settings → Payment Methods, which a
        // GATEWAY rail or online checkout points to) is a HARD-CODED, self-healing
        // catalog (PAYMENT_METHOD_DEFAULTS): bootstrap seeds none — the app creates
        // any missing method-row on first load of Settings → Payment Methods.
        const { rows: existing } = await pool.query<{ id: number }>(
            `SELECT id FROM "pos_counters" WHERE "branchId" = $1 AND name = $2 LIMIT 1`,
            [b.id, counterName],
        );
        if (existing[0]) {
            // Already exists — just make sure the till account is wired.
            // counterNumber is left untouched: it's GLOBALLY unique (see
            // pos.prisma) and may already be set from a prior seed run.
            await pool.query(
                `UPDATE "pos_counters" SET "tillAccountId" = $1 WHERE id = $2`,
                [tillId, existing[0].id],
            );
        } else {
            // counterNumber is GLOBALLY unique across every branch (see pos.prisma)
            // — auto-assign the next free number rather than hardcoding 1, so
            // seeding a second/third branch never collides with an earlier one.
            const { rows: maxRows } = await pool.query<{ max: number | null }>(
                `SELECT MAX("counterNumber") AS max FROM "pos_counters"`,
            );
            const nextCounterNumber = (maxRows[0]?.max ?? 0) + 1;
            await pool.query(
                `INSERT INTO "pos_counters" ("branchId", name, "counterNumber", "tillAccountId", "isActive")
                 VALUES ($1, $2, $3, $4, true)`,
                [b.id, counterName, nextCounterNumber, tillId],
            );
        }
    }

    console.log(`      ✓ 28 groups · ~54 GL ledgers + ${BRANCHES.length} vaults + ${BRANCHES.length} counters\n`);

    // ── Section 5: Admin user ──────────────────────────────────────────
    console.log("[5/7] Admin user");
    const password = await bcrypt.hash(ADMIN.password, 10);
    const adminUser = await prisma.user.upsert({
        where: { email: ADMIN.email },
        update: { name: ADMIN.name, role: ADMIN.role, password },
        create: { name: ADMIN.name, email: ADMIN.email, password, role: ADMIN.role },
        select: { id: true },
    });

    // Ensure the admin user holds a "System Administrator" Position (org-wide,
    // branchId = null) backed by the R1 (Admin) role template. This guarantees
    // that when User.role is eventually dropped in favour of Position-only
    // authority, the admin account still inherits full permissions via the
    // Position → Role → Permission chain rather than losing access.
    await upsertPositionWithRoles(prisma, {
        id: "POS-SYSADMIN",
        title: "System Administrator",
        branchId: null,
        roleTemplateIds: ["R1"],
    });
    await prisma.userPosition.upsert({
        where: { userId_positionId: { userId: adminUser.id, positionId: "POS-SYSADMIN" } },
        update: {},
        create: { userId: adminUser.id, positionId: "POS-SYSADMIN" },
    });
    console.log(`      ✓ ${ADMIN.email} (role ${ADMIN.role}) · Position: System Administrator (org-wide)  password: ${ADMIN.password}\n`);

    // ── Section 6: DB constraints ──────────────────────────────────────
    console.log("[6/7] DB constraints");
    await ensureXorCheck("Phone", "Phone_owner_xor");
    await ensureXorCheck("Email", "Email_owner_xor");
    console.log(`      ✓ Phone/Email XOR ownership CHECK ensured\n`);

    // ── Section 7: Inventory naming convention (singleton) ─────────────
    // Drives auto-fill of InvProduct.name / shopSubheading / slug from the
    // master selects on the product form. Single source of truth for the
    // default template — must match DEFAULT_NAMING_CONFIG in
    // src/modules/inventory/lib/productName.ts.
    console.log("[7/7] Inventory naming convention");
    const namingDefaults = {
        nameFields: [
            { kind: "brand", enabled: true, defaultValue: null },
            { kind: "group", enabled: true, defaultValue: "General" },
            { kind: "modelNo", enabled: true, defaultValue: null },
            // Operator-curated free text (InvProduct.namePart). Sits after the
            // master-driven tokens so the regenerate button rebuilds masters
            // around it without ever overwriting it.
            { kind: "userPart", enabled: true, defaultValue: null },
        ],
        separator: " ",
        onlineNameFields: [
            { kind: "brand", enabled: true, defaultValue: null },
            { kind: "group", enabled: true, defaultValue: null },
            { kind: "category", enabled: true, defaultValue: null },
            { kind: "modelNo", enabled: true, defaultValue: null },
            { kind: "warranty", enabled: true, defaultValue: null },
        ],
        onlineSeparator: " ",
        slugFields: [
            { kind: "brand", enabled: true, defaultValue: null },
            { kind: "group", enabled: true, defaultValue: null },
            { kind: "modelNo", enabled: true, defaultValue: null },
        ],
        slugSeparator: "-",
        slugEnabled: true,
        slugMaxLength: 80,
        fallbackFields: {
            group: ["category", "brand"],
            category: ["group", "brand"],
            brand: ["group", "category"],
        },
    };
    const existingNaming = await prisma.invNamingConfig.findFirst({ orderBy: { id: "asc" } });
    if (existingNaming) {
        await prisma.invNamingConfig.update({ where: { id: existingNaming.id }, data: namingDefaults });
    } else {
        await prisma.invNamingConfig.create({ data: namingDefaults });
    }
    console.log(`      ✓ InvNamingConfig singleton seeded\n`);

    // ── Section 8: GST Rate master ─────────────────────────────────────
    console.log("[8/11] GST Rate master (Indian slabs)");
    const GST_RATES = [
        { rate: "0.00", label: "Nil (0%)", description: "Nil rated — essential goods & services" },
        { rate: "0.25", label: "Special (0.25%)", description: "Rough / uncut diamonds" },
        { rate: "3.00", label: "Special (3%)", description: "Gold, silver, precious metals & jewellery" },
        { rate: "5.00", label: "GST 5%", description: "Basic necessities — packaged food, transport, etc." },
        { rate: "12.00", label: "GST 12%", description: "Processed food, business class travel, etc." },
        { rate: "18.00", label: "GST 18%", description: "Standard rate — electronics, IT services, etc." },
        { rate: "28.00", label: "GST 28%", description: "Luxury goods, automobiles, tobacco, etc." },
    ];
    for (const g of GST_RATES) {
        await prisma.gstRate.upsert({
            where: { label: g.label },
            update: { rate: g.rate, description: g.description, isActive: true },
            create: { rate: g.rate, label: g.label, description: g.description, isActive: true },
        });
    }
    console.log(`      ✓ ${GST_RATES.length} GST rates seeded\n`);

    // ── Section 9: Inventory Unit master ───────────────────────────────
    console.log("[9/11] Inventory Unit master");
    const INV_UNITS = [
        { code: "PCS", label: "Piece", decimals: 0 },
        { code: "NOS", label: "Numbers", decimals: 0 },
        { code: "BOX", label: "Box", decimals: 0 },
        { code: "SET", label: "Set", decimals: 0 },
        { code: "UNIT", label: "Unit", decimals: 0 },
        { code: "MTR", label: "Metre", decimals: 2 },
        { code: "ROLL", label: "Roll", decimals: 0 },
        { code: "PKT", label: "Packet", decimals: 0 },
        { code: "PAIR", label: "Pair", decimals: 0 },
        { code: "KG", label: "Kilogram", decimals: 3 },
        { code: "BAG", label: "Bag", decimals: 0 },
        { code: "REAM", label: "Ream", decimals: 0 },
        { code: "DAY", label: "Day", decimals: 0 },
    ];
    for (const u of INV_UNITS) {
        await prisma.invUnit.upsert({
            where: { code: u.code },
            update: { label: u.label, decimals: u.decimals, isActive: true },
            create: { code: u.code, label: u.label, decimals: u.decimals, isActive: true },
        });
    }

    // Unit CHAINS — each row names its IMMEDIATE parent ("1 GROSS = 12 DOZ",
    // "1 DOZ = 12 NOS"), so a unit's true size is the product of its chain.
    // Quantities are always STORED in the chain's smallest unit; the chain is
    // only how they are displayed (54 NOS reads as "4 DOZ 6 NOS").
    //
    // Order matters: a parent must be upserted before its child, so GROSS
    // follows DOZ. Seeded after the base-unit loop above.
    //
    // Deliberately NOT applied to SET / BOX / PKT: their contents vary per
    // product, so a single org-wide factor would be a lie — the admin sets
    // those in Inventory → Masters → Units where they are consistent.
    // Weight/length chains (G→KG→TONNE, CM→M→KM) are trade-specific and
    // likewise left to the admin.
    const INV_COMPOUND_UNITS = [
        { code: "DOZ", label: "Dozen", base: "NOS", factor: 12 },
        { code: "GROSS", label: "Gross", base: "DOZ", factor: 12 },
    ];
    for (const c of INV_COMPOUND_UNITS) {
        const base = await prisma.invUnit.findUnique({ where: { code: c.base }, select: { id: true } });
        if (!base) continue;
        await prisma.invUnit.upsert({
            where: { code: c.code },
            update: { label: c.label, baseUnitId: base.id, conversionFactor: c.factor, isActive: true },
            create: { code: c.code, label: c.label, decimals: 0, baseUnitId: base.id, conversionFactor: c.factor, isActive: true },
        });
    }
    const defaultUnit = await prisma.invUnit.findUnique({ where: { code: "UNIT" } });
    console.log(`      ✓ ${INV_UNITS.length} inventory units + ${INV_COMPOUND_UNITS.length} compound units seeded\n`);

    // ── Section 10: Inventory Warranty Term master ─────────────────────
    // Universal across trades (every business sells things with some warranty
    // window), so it lives in bootstrap — unlike brands (helper-brands.ts) and
    // categories / product groups (the personal snapshot).
    // Duration is in days (0 = no fixed duration). InvWarrantyTerm.name is NOT
    // unique in the schema, so we idempotently match on name.
    console.log("[10/11] Inventory Warranty Term master");
    const WARRANTY_TERMS = [
        { name: "No Warranty", durationDays: 0, description: "Sold as-is — no warranty coverage." },
        { name: "7-Day Replacement", durationDays: 7, description: "DOA / dead-on-arrival replacement window." },
        { name: "15-Day Replacement", durationDays: 15, description: "Short replacement window." },
        { name: "1 Month", durationDays: 30, description: "30-day warranty." },
        { name: "3 Months", durationDays: 90, description: "90-day warranty." },
        { name: "6 Months", durationDays: 180, description: "6-month warranty." },
        { name: "1 Year", durationDays: 365, description: "12-month manufacturer / seller warranty." },
        { name: "2 Years", durationDays: 730, description: "24-month warranty." },
        { name: "3 Years", durationDays: 1095, description: "36-month warranty." },
        { name: "5 Years", durationDays: 1825, description: "60-month warranty." },
    ];
    let warrantyCreated = 0;
    for (const w of WARRANTY_TERMS) {
        const existing = await prisma.invWarrantyTerm.findFirst({ where: { name: w.name } });
        if (existing) {
            await prisma.invWarrantyTerm.update({ where: { id: existing.id }, data: { durationDays: w.durationDays, description: w.description, isActive: true } });
        } else {
            await prisma.invWarrantyTerm.create({ data: { name: w.name, durationDays: w.durationDays, description: w.description, isActive: true } });
            warrantyCreated++;
        }
    }
    console.log(`      ✓ ${WARRANTY_TERMS.length} warranty terms seeded (${warrantyCreated} new)\n`);

    // ── Section 11: Org Defaults singleton ────────────────────────────
    console.log("[11/11] Org Defaults (singleton, id=1)");
    // Resolve the GST 18% master row that we just seeded in section 8.
    const gst18 = await prisma.gstRate.findUnique({ where: { label: "GST 18%" } });
    const orgDefaultsData = {
        defaultGstRateId: gst18?.id ?? null,
        defaultUnitId: defaultUnit?.id ?? null,
        defaultTaxability: "TAXABLE" as const,
        defaultCurrencySymbol: "₹",
        // Credit restricted by default — admin can raise in Settings → Org Defaults.
        defaultSaleCreditPeriod: 0,
        defaultPurchaseCreditPeriod: 0,
    };
    // Default barcode price bands (Update & Print Labels). Create-only so admin
    // edits via Settings → Org Defaults survive a reseed (left out of `update`).
    const DEFAULT_BARCODE_BANDS = [
        { max: 50, add: 10, hint: 1 },
        { max: 100, add: 20, hint: 2 },
        { max: 300, add: 30, hint: 3 },
        { max: 500, add: 50, hint: 5 },
        { max: 2000, add: 100, hint: 6 },
        { max: 5000, add: 150, hint: 7 },
        { max: 10000, add: 200, hint: 8 },
        { max: 99999, add: 500, hint: 9 },
    ];
    // Default cash denominations (POS shift-close counter), high → low. Indian
    // notes + coins. Create-only so admin edits via Settings survive a reseed.
    const DEFAULT_CASH_DENOMINATIONS = [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1];
    await prisma.orgDefaults.upsert({
        where: { id: 1 },
        // Scalars in `orgDefaultsData` re-seed to baseline; barcodeBandsJson and
        // cashDenominationsJson are create-only so admin customisation is
        // preserved across reseeds.
        create: { id: 1, ...orgDefaultsData, barcodeBandsJson: DEFAULT_BARCODE_BANDS, cashDenominationsJson: DEFAULT_CASH_DENOMINATIONS },
        update: orgDefaultsData,
    });
    console.log(`      ✓ OrgDefaults singleton seeded (GST 18%, UNIT, TAXABLE, ₹, credit=0 days, ${DEFAULT_BARCODE_BANDS.length} barcode bands, ${DEFAULT_CASH_DENOMINATIONS.length} denominations)\n`);

    // ── LoyaltyConfig singleton (id=1) ─────────────────────────────────
    // Defaults: 1 pt per ₹100 net goods, 1 pt = ₹1, 12-month expiry. Rates
    // are create-only so admin edits via /office/customer-retention/loyalty
    // survive a reseed. redeemExpenseAccountId is backfilled (even on update)
    // to the seeded "Loyalty Points Redeemed" ledger so GL routing is always wired.
    const loyaltyRedeemLedger = await prisma.account.findFirst({
        where: { name: { equals: "Loyalty Points Redeemed", mode: "insensitive" }, personId: null, companyId: null },
        select: { id: true },
    });
    await prisma.loyaltyConfig.upsert({
        where: { id: 1 },
        create: { id: 1, enabled: true, earnEnabled: true, redeemEnabled: true, globalEarnRatePer: 100, redeemValue: 1, expiryEnabled: true, expiryDays: 365, redeemExpenseAccountId: loyaltyRedeemLedger?.id ?? null },
        update: { redeemExpenseAccountId: loyaltyRedeemLedger?.id ?? null },
    });
    console.log(`      ✓ LoyaltyConfig singleton seeded (1 pt/₹100, 1 pt = ₹1, 365-day expiry, redeem ledger #${loyaltyRedeemLedger?.id ?? "—"})\n`);

    // ── CouponConfig singleton (id=1) ──────────────────────────────────
    // Global stacking guard (create-only so admin edits survive) + dedicated
    // GL ledgers, backfilled (even on update) to the seeded "Coupon Discounts"
    // and "Gift Card Liability" ledgers so GL routing is always wired.
    const [couponExpenseLedger, giftCardLiabilityLedger, giftCardBreakageLedger] = await Promise.all([
        prisma.account.findFirst({ where: { name: { equals: "Coupon Discounts", mode: "insensitive" }, personId: null, companyId: null }, select: { id: true } }),
        prisma.account.findFirst({ where: { name: { equals: "Gift Card Liability", mode: "insensitive" }, personId: null, companyId: null }, select: { id: true } }),
        prisma.account.findFirst({ where: { name: { equals: "Gift Card Breakage", mode: "insensitive" }, personId: null, companyId: null }, select: { id: true } }),
    ]);
    await prisma.couponConfig.upsert({
        where: { id: 1 },
        create: { id: 1, maxTotalDiscountPct: null, couponExpenseAccountId: couponExpenseLedger?.id ?? null, giftCardLiabilityAccountId: giftCardLiabilityLedger?.id ?? null, giftCardBreakageAccountId: giftCardBreakageLedger?.id ?? null },
        update: { couponExpenseAccountId: couponExpenseLedger?.id ?? null, giftCardLiabilityAccountId: giftCardLiabilityLedger?.id ?? null, giftCardBreakageAccountId: giftCardBreakageLedger?.id ?? null },
    });
    console.log(`      ✓ CouponConfig singleton seeded (coupon ledger #${couponExpenseLedger?.id ?? "—"}, gift-card liability #${giftCardLiabilityLedger?.id ?? "—"}, breakage #${giftCardBreakageLedger?.id ?? "—"})\n`);

    // ── CreditLimitConfig singleton (id=1) ─────────────────────────────
    // Global auto credit-limit calculator. Create-only so admin edits (from
    // Settings → Credit Limit) survive a reseed. Defaults are auto OFF, so
    // behaviour stays deny-by-default (manual limits only) until switched on.
    await prisma.creditLimitConfig.upsert({
        where: { id: 1 },
        create: { id: 1, autoEnabled: false, windowDays: 90, pctOfSales: 10, roundToStep: 0 },
        update: {},
    });
    console.log(`      ✓ CreditLimitConfig singleton seeded (auto OFF; 10% of last-90-day sales when enabled)\n`);

    // ── BackupConfig singleton (id=1) ──────────────────────────────────
    // The scheduled-backup row `/api/cron/backup-due` reads every hour to decide
    // whether this hour is due. It MUST exist from the first boot: no row means no
    // backup, silently, and nobody finds out until they need one. The defaults come
    // from the schema (every weekday, hour 22 — daily at 10 PM IST): a schedule that
    // is safe rather than clever, on the reasoning that a shop nobody has configured
    // should still be backed up. Change it from Settings → Backup & Restore.
    //
    // Create-only (`update: {}`) so a schedule an admin has since edited survives a
    // reseed untouched — same rule as CreditLimitConfig above.
    await prisma.backupConfig.upsert({
        where: { id: 1 },
        create: { id: 1 },
        update: {},
    });
    const backupCfg = await prisma.backupConfig.findUniqueOrThrow({ where: { id: 1 } });
    console.log(
        `      ✓ BackupConfig singleton seeded (enabled=${backupCfg.enabled} days=[${backupCfg.weekdays.join(",")}] hours=[${backupCfg.hours.join(",")}] IST)\n`,
    );

    // Spend-tier periods + their levels — admin-owned (rename / add / remove / toggle /
    // retune amounts). A period is a title customers compete for over a bracket of the
    // past; each carries its own copy of the ladder, so a customer can hold a title in
    // several periods at once and the percentages add up.
    //
    // FRESH DEPLOYMENTS ONLY. If anything is configured already, this leaves it
    // completely alone — no adopting, no re-pointing, no amount edits. An install that
    // predates periods was migrated once by migrate-tier-periods / migrate-tier-brackets;
    // both are deleted now (git history has them if an ancient DB ever turns up).
    const [tierPeriodCount, tierLevelCount] = await Promise.all([
        prisma.customerTierPeriod.count(),
        prisma.customerTier.count(),
    ]);
    if (tierPeriodCount === 0 && tierLevelCount === 0) {
        const starterPeriod = await prisma.customerTierPeriod.create({
            data: {
                name: "Best of 6 months",
                fromDay: 0,
                toDay: 180,
                sortOrder: 0,
                levels: {
                    create: [
                        { name: "Bronze", minSpend: 0, discountPct: 0, sortOrder: 0 },
                        { name: "Silver", minSpend: 10000, discountPct: 2, sortOrder: 1 },
                        { name: "Gold", minSpend: 50000, discountPct: 5, sortOrder: 2 },
                        { name: "Platinum", minSpend: 200000, discountPct: 8, sortOrder: 3 },
                    ],
                },
            },
        });
        // One period only: brackets tile, so a second starter period would need its own
        // amounts to be worth anything. Adding periods is the admin's job — the page
        // copies this ladder into each new one.
        console.log(`      ✓ CustomerTierPeriod starter seeded ("${starterPeriod.name}", days ${starterPeriod.fromDay}-${starterPeriod.toDay} + Bronze/Silver/Gold/Platinum)\n`);
    } else {
        console.log(`      • Spend tiers already configured (${tierPeriodCount} period(s), ${tierLevelCount} level(s)) — left untouched\n`);
    }

    // ── Section 12: VoucherSeries ──────────────────────────────────────
    console.log("[12/16] VoucherSeries (all GL + inventory series)");
    await seedVoucherSeries(prisma);
    console.log(`      ✓ VoucherSeries seeded\n`);

    // ── Section 13: Voucher print templates ───────────────────────────
    console.log("[13/16] VoucherPrintTemplate (per-kind thermal/A4 print templates)");
    // Create payload uses the full per-kind defaults so a fresh DB starts in
    // the right place. On re-seed we only force `defaultPaper` back to its
    // per-kind baseline (POS = THERMAL_80MM, everything else = A4); all
    // other admin customisations to header/footer/toggles survive.
    for (const kind of VOUCHER_TEMPLATE_KINDS) {
        const data = buildVoucherTemplateDefaults(kind);
        await prisma.voucherPrintTemplate.upsert({
            where: { kind },
            create: data,
            update: { defaultPaper: data.defaultPaper },
        });
    }
    // Baseline flip (2026-09-06): money slips (RECEIPT / PAYMENT) now default to
    // showing the party's balance before/after. Rows still carrying the OLD
    // default (both flags off) are moved to the new one; a row where an admin
    // deliberately kept one side on/off is left alone. Idempotent.
    const partyBalanceFlip = await prisma.voucherPrintTemplate.updateMany({
        where: { kind: { in: ["RECEIPT", "PAYMENT"] }, showPartyBalance: false, showPartyBalanceThermal: false },
        data:  { showPartyBalance: true, showPartyBalanceThermal: true },
    });
    console.log(`      ✓ ${VOUCHER_TEMPLATE_KINDS.length} voucher print templates seeded (party-balance baseline applied to ${partyBalanceFlip.count})\n`);

    // ── Section 14: GSTIN ↔ gstStateCode integrity fixup ─────────────────
    console.log("[14/16] GSTIN ↔ state-code integrity fixup");
    // Idempotent: for every Branch / Person / Company row
    // with a non-empty GSTIN, force gstStateCode = gstin[:2]. Safe to re-run.
    // (Doesn't touch the human-readable `state` text — admins clean those
    // via the UI, which now rejects mismatches.)
    const gstinFixupSql = `gstStateCode" = LEFT("gstin", 2) WHERE "gstin" IS NOT NULL AND "gstin" <> '' AND ("gstStateCode" IS DISTINCT FROM LEFT("gstin", 2))`;
    const branchFix = await pool.query(`UPDATE "Branch"       SET "${gstinFixupSql}`);
    const personFix = await pool.query(`UPDATE "Person"       SET "${gstinFixupSql}`);
    const companyFix = await pool.query(`UPDATE "Company"      SET "${gstinFixupSql}`);
    const fixedTotal = (branchFix.rowCount ?? 0) + (personFix.rowCount ?? 0)
        + (companyFix.rowCount ?? 0);
    console.log(`      ✓ Re-aligned gstStateCode on ${fixedTotal} row(s) where it disagreed with GSTIN\n`);

    // ── Section 15: Strategy points (the additive-margin pricing engine) ──────
    // The single org-wide additive-margin config. A product's margin% = the SUM
    // of the points for the dimensions it falls under (base + brand + category +
    // group). Seed BASE = 25 so a fresh DB keeps the org-default +25% markup that
    // the old (dropped) "Default ORG markup" PricingStrategy provided. Brand /
    // category / group / band points are added by the user in
    // /office/pricing-strategy/strategies. A missing row = 0 pts.
    // create-only so an admin's edited base survives a reseed.
    console.log("[15/16] Strategy points default (BASE = 25)");
    await prisma.strategyPoint.upsert({
        where: { dimension_refKey: { dimension: "BASE", refKey: "" } },
        update: {},
        create: { dimension: "BASE", refKey: "", points: 25 },
    });
    console.log("      ✓ StrategyPoint BASE row present\n");

    // ── Section 16: Delivery methods (courier options at checkout) ────────────
    // Our six real couriers (see DELIVERY_METHODS above). create-only per kind so
    // rate edits in Settings → Couriers survive a reseed.
    console.log("[16/17] Delivery methods (courier options)");
    let dmCreated = 0;
    for (const m of DELIVERY_METHODS) {
        const exists = await prisma.deliveryMethod.findFirst({ where: { kind: m.kind }, select: { id: true } });
        if (!exists) {
            await prisma.deliveryMethod.create({
                data: {
                    kind: m.kind, displayName: m.displayName, isActive: m.isActive,
                    sortOrder: m.sortOrder, configJson: m.configJson as unknown as Prisma.InputJsonValue,
                },
            });
            dmCreated++;
        }
    }
    console.log(`      ✓ ${DELIVERY_METHODS.length} delivery methods ensured (${dmCreated} new)\n`);

    // ── Section 17: Payment gateways ──────────────────────────────────────────
    // create-only per provider: an admin's keys, environment and on/off switches
    // (Settings → Payment Gateways) are never overwritten by a reseed.
    //
    // The settlement ledger is resolved BY NAME to a local id here, which is the
    // whole point — see the note on GATEWAYS above. A name that does not resolve
    // is reported and that gateway is skipped rather than written with a dangling
    // account, because a gateway pointing at the wrong ledger would silently post
    // real money into the wrong place.
    console.log("[17/17] Payment gateways");
    let gwCreated = 0;
    const gwSkipped: string[] = [];
    for (const g of GATEWAYS) {
        const exists = await prisma.paymentGateway.findFirst({ where: { provider: g.provider }, select: { id: true } });
        if (exists) continue;
        let settlementAccountId: number | null = null;
        if (g.settlementLedger) {
            const acct = await prisma.account.findFirst({ where: { name: g.settlementLedger }, select: { id: true } });
            if (!acct) { gwSkipped.push(`${g.provider} (no ledger "${g.settlementLedger}")`); continue; }
            settlementAccountId = acct.id;
        }
        await prisma.paymentGateway.create({
            data: {
                provider: g.provider, displayName: g.displayName, environment: g.environment,
                enabledForCounter: g.enabledForCounter, enabledForOnline: g.enabledForOnline,
                isActive: g.isActive, sortOrder: g.sortOrder,
                configJson: { ...g.configJson, ...(settlementAccountId ? { settlementAccountId } : {}) } as unknown as Prisma.InputJsonValue,
            },
        });
        gwCreated++;
    }
    console.log(`      ✓ ${GATEWAYS.length} gateways ensured (${gwCreated} new)`);
    for (const s of gwSkipped) console.log(`      • skipped: ${s}`);
    console.log("");


    console.log("━━━ Bootstrap complete ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("    Log in at /staff/login as admin@networkservice.in / admin123");
    console.log("    Run `pnpm seed:helper-all` for the trade masters (roles, brands, categories).\n");
}

main()
    .catch((err) => { console.error(err); process.exit(1); })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
