// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BOOTSTRAP SEED — single source of truth for production setup.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// Run: `pnpm prisma db seed` (the standard Prisma command). Wired in
// `prisma.config.ts → migrations.seed`. Idempotent — safe to re-run.
//
// ⚠️ MAINTENANCE RULE
// When you change `prisma/schema/*.prisma` (add / rename / drop a column or
// table), update THIS file in the same commit. Dummy-*.ts files describe demo
// data; only this file describes the production-required state.
//
// What this seeds (kept on hard-clean):
//   • RBAC: 1 Role (R1 Admin — only isSystem role; R2+ via helper-roles.ts),
//     130+ Permissions (incl. per-kind voucher gates — GL `finance:voucher:*`
//     + inventory `inventory:voucher:*`, generated from voucherMatrix.ts),
//     R1's RolePermission grants
//   • Workflow: 9 Pipelines, 63 TicketStatuses, 8 Works (1 gated → work:*
//     permissions), 43 Workers, status + worker transitions
//   • Org structure: 1 Branch (HQ), 8 Departments, Role ranks
//   • Chart of accounts: 28 AccountGroups (Tally tree) + ~50 GL ledgers
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
// Universal-vs-trade-specific rule: bootstrap seeds only masters common to
// EVERY trade (units, GST slabs, warranty terms, chart of accounts, RBAC,
// workflow). Trade-specific masters (brands, categories, product groups /
// HSN-GST spine) live in helper-inventory-masters.ts — a different trade
// would ship its own helper instead.
//
// What this does NOT seed:
//   • Brands + Categories + Product groups (HSN/GST) → helper-inventory-masters.ts
//     (trade-specific reference data — run `pnpm seed:helper-inventory`)
//   • Test users (tech, front, des) → dummy-users.ts
//   • Demo products → dummy-shop.ts
//   • InvAttributeMaster — seeded by dummy-shop.ts (global attrs + category-specific).
//     Production users populate attribute masters via Configure → Attribute masters.
//   • Test customers + companies → dummy-customers.ts
//   • Sample vouchers → dummy-vouchers.ts
//   • Opening balances on accounts/products → set via UI

import { PrismaClient, Prisma } from "../../src/generated/prisma/client";
import { seedVoucherSeries } from "../../src/modules/accountancy/lib/seedVoucherSeries";
import {
    VOUCHER_TEMPLATE_KINDS,
    buildVoucherTemplateDefaults,
} from "../../src/shared/lib/print/voucherTemplateDefaults";
import { COMPANY_DETAILS } from "../../src/utils/constants-company-details";
import { voucherPermissionSeeds } from "../../src/shared/lib/auth/voucherMatrix";
import { sidebarPermissionSeeds } from "../../src/shared/lib/auth/sidebarModules";
import { posVoucherPermissionSeeds } from "../../src/shared/lib/auth/posVoucherMatrix";
import { upsertPositionWithRoles } from "./lib/positionSeedSync";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import * as dotenv from "dotenv";

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
// Bootstrap seeds ONLY R1 (Admin) — the one role universal to every trade. All
// other roles (Service Engineer, Cashier, Accountant, …) are trade-specific and
// vary per business, so they are NOT seeded here. A starter set lives in the
// `helper-roles.ts` seed (`pnpm seed:helper-roles`), and admins create or edit
// the rest from the Role Matrix UI as the business needs.
const ROLES = [
    // R1 is the cross-cutting admin role — homed in the all-access department
    // (DEP-ADMIN) so the Role Matrix offers it the full permission list.
    { id: "R1", label: "Role-Admin", color: "bg-red-100 text-red-600", isSystem: true, rank: 100, departmentId: "DEP-ADMIN" },
] as const;

const PERMISSIONS = [
    // ── System-only sentinel — NOT auto-assigned to any role (see R1 grant below).
    // Only the env-based super admin (SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD in
    // .env) can ever hold it at runtime. It lives in the Permission table so FK
    // lookups don't break, but the `systemOnly` flag keeps it out of role grants
    // and off the Role Matrix UI.
    { id: "admin:bypass", label: "Bypass all permission checks", module: "core", description: "Grants full access. Only usable by the env super admin — never grant this to a role.", systemOnly: true },

    // customers — Contacts (Person + Company) share ONE flat set. Contacts carry no
    // branch, so there is no radius to enforce: any branch may CRUD (gated only by
    // holding the write id). The old own/department/branch/org ladder and the
    // customers:manage umbrella are retired.
    { id: "customers:create", label: "Create customers", module: "customers", description: "Create Person / Company records." },
    { id: "customers:edit", label: "Edit customers", module: "customers", description: "Edit any Person / Company record (no branch limit)." },
    { id: "customers:delete", label: "Delete customers", module: "customers", description: "Delete any Person / Company record (no branch limit)." },

    // Repair (tickets + assignments) permission layer removed — being rebuilt the
    // new way (sidebar-link + CRUD matrix), like accountancy / inventory.
    // Service-centers permission layer likewise removed (not UI-assignable).

    // admin
    { id: "settings:manage", label: "Manage org settings", module: "admin", description: "Organisation-wide settings — org defaults, payment methods, printer/QR/voucher templates, backups, downloads, imports." },
    { id: "branches:create", label: "Create branches", module: "admin", description: "Create branch records." },
    { id: "branches:edit", label: "Edit branches", module: "admin", description: "Edit branch records." },
    { id: "branches:delete", label: "Delete branches", module: "admin", description: "Delete branch records." },
    { id: "departments:create", label: "Create departments", module: "admin", description: "Create department records." },
    { id: "departments:edit", label: "Edit departments", module: "admin", description: "Edit department records and their permission pools." },
    { id: "departments:delete", label: "Delete departments", module: "admin", description: "Delete department records." },
    { id: "positions:create", label: "Create positions", module: "admin", description: "Create position records." },
    { id: "positions:edit", label: "Edit positions", module: "admin", description: "Edit positions and assign/remove their holders." },
    { id: "positions:delete", label: "Delete positions", module: "admin", description: "Delete position records." },
    { id: "pos-counters:create", label: "Create POS counters", module: "admin", description: "Create POS counter records." },
    { id: "pos-counters:edit", label: "Edit POS counters", module: "admin", description: "Edit POS counter records." },
    { id: "pos-counters:delete", label: "Delete POS counters", module: "admin", description: "Delete POS counter records." },
    { id: "users:create", label: "Create users", module: "admin", description: "Create user accounts." },
    { id: "users:edit", label: "Edit users", module: "admin", description: "Edit user accounts." },
    { id: "users:delete", label: "Delete users", module: "admin", description: "Delete user accounts." },
    { id: "roles:create", label: "Create roles", module: "admin", description: "Create role definitions." },
    { id: "roles:edit", label: "Edit roles", module: "admin", description: "Edit role definitions and grants." },
    { id: "roles:delete", label: "Delete roles", module: "admin", description: "Delete custom role definitions." },

    // crm

    // finance — three-tier lifecycle on journal entries

    // finance — three-tier lifecycle on invoices

    // finance — three-tier lifecycle on payments

    // finance — generic Tally accounting vouchers

    // finance — per-kind GL voucher gates (finance:voucher:<action>:<kind>). The
    // routes accept the per-kind key OR the generic key above. CANCEL covers
    // cancel + edit + convert-to-draft; DELETE is the single removal (soft-delete
    // retired 2026-06-09, "hard-delete" renamed to "delete"). Source of truth for
    // the kind↔permission mapping: src/shared/lib/auth/voucherMatrix.ts.
    { id: "finance:voucher:create:payment",      label: "Create payment voucher",      module: "finance", description: "Create a Payment voucher." },
    { id: "finance:voucher:post:payment",        label: "Post payment voucher",        module: "finance", description: "Post a Payment voucher (applies GL)." },
    { id: "finance:voucher:cancel:payment",      label: "Cancel / edit payment voucher", module: "finance", description: "Cancel, edit, or convert-to-draft a Payment voucher." },
    { id: "finance:voucher:delete:payment",      label: "Delete payment voucher",      module: "finance", description: "Remove a Payment voucher (recoverable from the Recycle Bin)." },

    { id: "finance:voucher:create:receipt",      label: "Create receipt voucher",      module: "finance", description: "Create a Receipt voucher." },
    { id: "finance:voucher:post:receipt",        label: "Post receipt voucher",        module: "finance", description: "Post a Receipt voucher (applies GL)." },
    { id: "finance:voucher:cancel:receipt",      label: "Cancel / edit receipt voucher", module: "finance", description: "Cancel, edit, or convert-to-draft a Receipt voucher." },
    { id: "finance:voucher:delete:receipt",      label: "Delete receipt voucher",      module: "finance", description: "Remove a Receipt voucher (recoverable from the Recycle Bin)." },

    { id: "finance:voucher:create:contra",      label: "Create contra voucher",      module: "finance", description: "Create a Contra voucher." },
    { id: "finance:voucher:post:contra",        label: "Post contra voucher",        module: "finance", description: "Post a Contra voucher (applies GL)." },
    { id: "finance:voucher:cancel:contra",      label: "Cancel / edit contra voucher", module: "finance", description: "Cancel, edit, or convert-to-draft a Contra voucher." },
    { id: "finance:voucher:delete:contra",      label: "Delete contra voucher",      module: "finance", description: "Remove a Contra voucher (recoverable from the Recycle Bin)." },

    { id: "finance:voucher:create:credit-note",      label: "Create credit note",      module: "finance", description: "Create a Credit Note." },
    { id: "finance:voucher:post:credit-note",        label: "Post credit note",        module: "finance", description: "Post a Credit Note (applies GL)." },
    { id: "finance:voucher:cancel:credit-note",      label: "Cancel / edit credit note", module: "finance", description: "Cancel, edit, or convert-to-draft a Credit Note." },
    { id: "finance:voucher:delete:credit-note",      label: "Delete credit note",      module: "finance", description: "Remove a Credit Note (recoverable from the Recycle Bin)." },

    { id: "finance:voucher:create:debit-note",      label: "Create debit note",      module: "finance", description: "Create a Debit Note." },
    { id: "finance:voucher:post:debit-note",        label: "Post debit note",        module: "finance", description: "Post a Debit Note (applies GL)." },
    { id: "finance:voucher:cancel:debit-note",      label: "Cancel / edit debit note", module: "finance", description: "Cancel, edit, or convert-to-draft a Debit Note." },
    { id: "finance:voucher:delete:debit-note",      label: "Delete debit note",      module: "finance", description: "Remove a Debit Note (recoverable from the Recycle Bin)." },

    { id: "finance:voucher:create:journal",      label: "Create journal voucher",      module: "finance", description: "Create a Journal voucher (general GL adjustment)." },
    { id: "finance:voucher:post:journal",        label: "Post journal voucher",        module: "finance", description: "Post a Journal voucher (applies GL)." },
    { id: "finance:voucher:cancel:journal",      label: "Cancel / edit journal voucher", module: "finance", description: "Cancel, edit, or convert-to-draft a Journal voucher." },
    { id: "finance:voucher:delete:journal",      label: "Delete journal voucher",      module: "finance", description: "Remove a Journal voucher (recoverable from the Recycle Bin)." },

    // finance — bill-wise allocation

    // finance — opening balance

    // inventory — branch-scoped view/edit + three-tier lifecycle on stock vouchers

    // inventory module pages — Products catalog + Masters (8 setup tables, gated
    // together). View rides the sidebar link; inventory:manage is the umbrella.
    { id: "products:create", label: "Create products", module: "inventory", description: "Add items to the product catalog." },
    { id: "products:edit", label: "Edit products", module: "inventory", description: "Edit product catalog items (non-tax fields; tax uses compliance:tax:edit)." },
    { id: "products:delete", label: "Delete products", module: "inventory", description: "Delete product catalog items." },
    { id: "inventory:masters:create", label: "Create inventory masters", module: "inventory", description: "Add brands, units, categories, groups, warranty terms, attributes, GST rates, and BOMs." },
    { id: "inventory:masters:edit", label: "Edit inventory masters", module: "inventory", description: "Edit the inventory setup/master tables." },
    { id: "inventory:masters:delete", label: "Delete inventory masters", module: "inventory", description: "Delete inventory setup/master records." },

    // pricing strategy — one edit gate per page (view rides the sidebar link grant).
    // "Needs attention" edits the product itself, so it stays on inventory:manage.
    { id: "pricing:strategy:set", label: "Set pricing strategy", module: "inventory", description: "Edit the markup / strategy-point rules on the Pricing Strategy → Strategies page." },
    { id: "pricing:costing:manage", label: "Manage costing", module: "inventory", description: "Add, edit, and remove cost draws on the Pricing Strategy → Costing page." },
    { id: "pricing:labels:apply", label: "Apply prices & print labels", module: "inventory", description: "Bulk-apply sale prices and print labels on the Pricing Strategy → Update & print labels page." },

    // inventory — per-kind voucher gates (inventory:voucher:<action>:<kind>). Every
    // voucher kind is independent (Sale ≠ Purchase). Generated from the matrix so
    // the kind↔permission mapping never drifts. Single source: voucherMatrix.ts.
    // (Enforcement is wired in a later phase; routes fall back to the generic keys
    // above until then.)
    ...voucherPermissionSeeds(),

    // ui — sidebar link visibility (ui:sidebar:<module>:<child>). One row per nav
    // link; the Department pool picks whole modules, the Role picker picks links.
    // Generated from the sidebar so the link↔permission mapping never drifts.
    // Single source: sidebarModules.ts.
    ...sidebarPermissionSeeds(),

    // pos — per-kind voucher gates for the /vouchers/pos UI only
    // (pos:voucher:<action>:<kind>). Office-equivalent voucher perms also grant
    // these (office ⊇ POS). Generated from posVoucherMatrix.ts.
    ...posVoucherPermissionSeeds(),

    // pos — shift / till / handover lifecycle
    { id: "pos:shift:open",        label: "Open POS shift",                 module: "pos", description: "Open your own till session with an opening cash float." },
    { id: "pos:shift:close",       label: "Close POS shift",                module: "pos", description: "Declare physical cash count and hand over to manager (posts Contra)." },
    { id: "pos:shift:drop",        label: "Record mid-shift cash drop",     module: "pos", description: "Log cash dropped into the safe during an open shift." },
    { id: "pos:shift:force-close", label: "Force-close another's shift",     module: "pos", description: "Emergency-close a stuck open shift on behalf of the operator (counts the drawer; closedBy = you)." },

    // accountancy — module-level CRUD gate (Owner / CA only)
    // Flat accountancy view — the single gate that shows/hides the Accountancy
    // sidebar and guards its reads (radius is always branch). The old
    // create/edit/delete + own/br/org ladder was retired: accountancy writes run
    // through the voucher matrix (finance:voucher:*) and accountancy:masters:*.
    { id: "compliance:tax:edit", label: "Change tax classification", module: "accountancy", description: "Edit GST rate, HSN code, and taxability on inventory items and product groups from the Tax Classification page." },
    { id: "accountancy:masters:create", label: "Create accounting masters", module: "accountancy", description: "Create account groups and GL ledgers (chart of accounts)." },
    { id: "accountancy:masters:edit", label: "Edit accounting masters", module: "accountancy", description: "Edit account groups and GL ledgers." },
    { id: "accountancy:masters:delete", label: "Delete accounting masters", module: "accountancy", description: "Delete account groups." },

    // loyalty — earn/redeem config, earn rules, and milestones (manual point
    // adjustments live on the customer record, not here). manage = umbrella.
    { id: "loyalty:create", label: "Create loyalty rules", module: "loyalty", description: "Create loyalty earn rules and milestones." },
    { id: "loyalty:edit", label: "Edit loyalty", module: "loyalty", description: "Edit loyalty config, earn rules, and milestones." },
    { id: "loyalty:delete", label: "Delete loyalty rules", module: "loyalty", description: "Delete loyalty earn rules and milestones." },

    // retention — coupons / gift cards / spend tiers (loyalty is above). View rides
    // the sidebar link; each page has create/edit/delete + a money-sensitive guard
    // where one exists. manage = umbrella (grants all actions on the page).
    { id: "coupons:create", label: "Create coupons", module: "coupons", description: "Create discount coupons." },
    { id: "coupons:edit", label: "Edit coupons", module: "coupons", description: "Edit coupons, incl. the discount value (name, dates, conditions, limits, % / flat amount)." },
    { id: "coupons:delete", label: "Delete coupons", module: "coupons", description: "Delete or disable coupons." },
    { id: "gift-cards:create", label: "Create gift cards", module: "coupons", description: "Create gift cards." },
    { id: "gift-cards:edit", label: "Edit gift cards", module: "coupons", description: "Edit gift cards, incl. issuing (loading balance) and writing off unused balance." },
    { id: "gift-cards:delete", label: "Delete gift cards", module: "coupons", description: "Delete gift cards." },
    { id: "tiers:create", label: "Create spend tiers", module: "crm", description: "Create customer spending tiers." },
    { id: "tiers:edit", label: "Edit spend tiers", module: "crm", description: "Edit customer spending tiers." },
    { id: "tiers:delete", label: "Delete spend tiers", module: "crm", description: "Delete customer spending tiers." },

    // ecommerce — online storefront catalog & orders

    // administration — internal work board (pipeline-based todos on the P4 pipeline)
] as const;

const ROLE_PERMISSIONS: Record<string, string[]> = {
    // R1 — Owner / Admin: every permission except system-only sentinels.
    // This is the ONLY bootstrap role. Trade-specific starter roles live in
    // `helper-roles.ts` (`pnpm seed:helper-roles`); admins build the rest.
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
    }>;
};

const PIPELINES: PipelineSeed[] = [
    {
        id: "P1", name: "service", label: "Service & Repair",
        description: "Electronics repair and service workflow",
        color: "bg-blue-100 text-blue-600", order: 0, isDefault: true, entityType: "ticket",
        statuses: [
            { id: "S1", label: "Received", color: "bg-gray-100 text-gray-600", order: 1, isEntryPoint: true, isTerminal: false, pipelineId: "P1", leavePrompt: "Confirm the device and accessories are logged before moving on." },
            { id: "S2", label: "Diagnosing", color: "bg-yellow-100 text-yellow-700", order: 2, isEntryPoint: false, isTerminal: false, pipelineId: "P1", announceOnEntry: true, etaText: "2 days" },
            { id: "S3", label: "Repairing", color: "bg-blue-100 text-blue-700", order: 3, isEntryPoint: false, isTerminal: false, pipelineId: "P1" },
            { id: "S61", label: "Need Help", color: "bg-gray-100 text-gray-600", order: 4, isEntryPoint: false, isTerminal: false, pipelineId: "P1" },
            { id: "S62", label: "Escalated - Send to service", color: "bg-gray-100 text-gray-600", order: 5, isEntryPoint: false, isTerminal: false, pipelineId: "P1" },
            { id: "S5", label: "Received Back", color: "bg-purple-100 text-purple-700", order: 5, isEntryPoint: false, isTerminal: false, pipelineId: "P1" },
            { id: "S4", label: "Escalated -Visit", color: "bg-orange-100 text-orange-700", order: 5, isEntryPoint: false, isTerminal: false, pipelineId: "P1" },
            { id: "S6", label: "Ready", color: "bg-green-100 text-green-700", order: 6, isEntryPoint: false, isTerminal: false, pipelineId: "P1" },
            { id: "S7", label: "Returned", color: "bg-gray-200 text-gray-500", order: 7, isEntryPoint: false, isTerminal: true, pipelineId: "P1" },
            { id: "S8", label: "Closed - No Fix", color: "bg-red-100 text-red-600", order: 8, isEntryPoint: false, isTerminal: true, pipelineId: "P1" },
            { id: "S9", label: "Cancelled", color: "bg-gray-100 text-gray-400", order: 9, isEntryPoint: false, isTerminal: true, pipelineId: "P1" },
            { id: "S63", label: "Scrap", color: "bg-gray-100 text-gray-600", order: 12, isEntryPoint: false, isTerminal: true, pipelineId: "P1" },
        ],
    },
    {
        id: "P2", name: "customer-support", label: "Customer Support",
        description: "General customer support tickets not related to repairs",
        color: "bg-teal-100 text-teal-700", order: 2, entityType: "ticket",
        statuses: [
            { id: "S10", label: "New Request", color: "bg-gray-100 text-gray-600", order: 1, isEntryPoint: true,  isTerminal: false, pipelineId: "P2" },
            { id: "S11", label: "In Triage", color: "bg-yellow-100 text-yellow-700", order: 2, isEntryPoint: false, isTerminal: false, pipelineId: "P2" },
            { id: "S12", label: "Assigned", color: "bg-blue-100 text-blue-600", order: 3, isEntryPoint: false, isTerminal: false, pipelineId: "P2" },
            { id: "S13", label: "In Progress", color: "bg-indigo-100 text-indigo-600", order: 4, isEntryPoint: false, isTerminal: false, pipelineId: "P2" },
            { id: "S14", label: "Pending Customer", color: "bg-orange-100 text-orange-600", order: 5, isEntryPoint: false, isTerminal: false, pipelineId: "P2" },
            { id: "S15", label: "Resolved", color: "bg-green-100 text-green-600", order: 6, isEntryPoint: false, isTerminal: false, pipelineId: "P2" },
            { id: "S16", label: "Closed", color: "bg-gray-100 text-gray-400", order: 7, isEntryPoint: false, isTerminal: true,  pipelineId: "P2" },
        ],
    },
    {
        id: "P3", name: "sales", label: "Sales",
        description: "Sales pipeline for new customers and upsell opportunities",
        color: "bg-green-100 text-green-700", order: 3, entityType: "deal",
        statuses: [
            { id: "S17", label: "Lead", color: "bg-gray-100 text-gray-600", order: 1, isEntryPoint: true,  isTerminal: false, pipelineId: "P3" },
            { id: "S18", label: "Contacted", color: "bg-blue-100 text-blue-600", order: 2, isEntryPoint: false, isTerminal: false, pipelineId: "P3" },
            { id: "S19", label: "Qualified", color: "bg-teal-100 text-teal-600", order: 3, isEntryPoint: false, isTerminal: false, pipelineId: "P3" },
            { id: "S20", label: "Proposal Sent", color: "bg-yellow-100 text-yellow-700", order: 4, isEntryPoint: false, isTerminal: false, pipelineId: "P3" },
            { id: "S21", label: "Negotiation", color: "bg-orange-100 text-orange-600", order: 5, isEntryPoint: false, isTerminal: false, pipelineId: "P3" },
            { id: "S22", label: "Won", color: "bg-green-100 text-green-700", order: 6, isEntryPoint: false, isTerminal: true,  pipelineId: "P3" },
            { id: "S23", label: "Lost", color: "bg-red-100 text-red-600", order: 7, isEntryPoint: false, isTerminal: true,  pipelineId: "P3" },
        ],
    },
    {
        id: "P4", name: "internal-management", label: "Internal Management",
        description: "Internal tasks, HR, admin, and operational workflows",
        color: "bg-purple-100 text-purple-700", order: 4, entityType: "task",
        statuses: [
            { id: "S24", label: "Open", color: "bg-gray-100 text-gray-600", order: 1, isEntryPoint: true,  isTerminal: false, pipelineId: "P4" },
            { id: "S25", label: "In Review", color: "bg-yellow-100 text-yellow-700", order: 2, isEntryPoint: false, isTerminal: false, pipelineId: "P4" },
            { id: "S26", label: "In Progress", color: "bg-blue-100 text-blue-600", order: 3, isEntryPoint: false, isTerminal: false, pipelineId: "P4" },
            { id: "S27", label: "On Hold", color: "bg-orange-100 text-orange-600", order: 4, isEntryPoint: false, isTerminal: false, pipelineId: "P4" },
            { id: "S28", label: "Done", color: "bg-green-100 text-green-600", order: 5, isEntryPoint: false, isTerminal: true,  pipelineId: "P4" },
        ],
    },
    {
        id: "P5", name: "marketing", label: "Marketing",
        description: "Marketing campaigns, content, and outreach initiatives",
        color: "bg-pink-100 text-pink-700", order: 5, entityType: "deal",
        statuses: [
            { id: "S29", label: "Idea", color: "bg-gray-100 text-gray-600", order: 1, isEntryPoint: true,  isTerminal: false, pipelineId: "P5" },
            { id: "S30", label: "Planning", color: "bg-yellow-100 text-yellow-700", order: 2, isEntryPoint: false, isTerminal: false, pipelineId: "P5" },
            { id: "S31", label: "In Execution", color: "bg-blue-100 text-blue-600", order: 3, isEntryPoint: false, isTerminal: false, pipelineId: "P5" },
            { id: "S32", label: "Under Review", color: "bg-orange-100 text-orange-600", order: 4, isEntryPoint: false, isTerminal: false, pipelineId: "P5" },
            { id: "S33", label: "Live", color: "bg-teal-100 text-teal-600", order: 5, isEntryPoint: false, isTerminal: false, pipelineId: "P5" },
            { id: "S34", label: "Completed", color: "bg-green-100 text-green-600", order: 6, isEntryPoint: false, isTerminal: true,  pipelineId: "P5" },
        ],
    },
    {
        id: "P7", name: "sales-orders", label: "Sales Orders",
        description: "Order processing pipeline — online, in-store, phone, and WhatsApp orders",
        color: "bg-amber-100 text-amber-800", order: 7, entityType: "voucher",
        statuses: [
            { id: "S42", label: "New", color: "bg-gray-100 text-gray-600", order: 1, isEntryPoint: true,  isTerminal: false, pipelineId: "P7" },
            { id: "S43", label: "Under Review", color: "bg-yellow-100 text-yellow-700", order: 2, isEntryPoint: false, isTerminal: false, pipelineId: "P7", actionLabel: "Mark Under Review" },
            { id: "S44", label: "Confirmed", color: "bg-blue-100 text-blue-700", order: 3, isEntryPoint: false, isTerminal: false, pipelineId: "P7", actionLabel: "Confirm Order" },
            { id: "S45", label: "Packing", color: "bg-indigo-100 text-indigo-700", order: 4, isEntryPoint: false, isTerminal: false, pipelineId: "P7", actionLabel: "Start Packing" },
            { id: "S46", label: "Dispatched", color: "bg-purple-100 text-purple-700", order: 5, isEntryPoint: false, isTerminal: false, pipelineId: "P7", actionLabel: "Mark Dispatched" },
            { id: "S47", label: "Delivered", color: "bg-green-100 text-green-700", order: 6, isEntryPoint: false, isTerminal: true,  pipelineId: "P7", actionLabel: "Mark Delivered" },
            { id: "S48", label: "Cancelled", color: "bg-gray-100 text-gray-400", order: 7, isEntryPoint: false, isTerminal: true,  pipelineId: "P7", actionLabel: "Cancel Order" },
            { id: "S49", label: "Returned", color: "bg-red-100 text-red-600", order: 8, isEntryPoint: false, isTerminal: true,  pipelineId: "P7", actionLabel: "Mark Returned" },
        ],
    },
    {
        id: "P8", name: "delivery", label: "Delivery",
        description: "Delivery / dispatch sub-pipeline — carrier dispatch & tracking for confirmed orders",
        color: "bg-sky-100 text-sky-800", order: 8, entityType: "delivery",
        statuses: [
            { id: "S50", label: "To Dispatch", color: "bg-gray-100 text-gray-600", order: 1, isEntryPoint: true,  isTerminal: false, pipelineId: "P8" },
            { id: "S51", label: "Carrier Assigned", color: "bg-blue-100 text-blue-700", order: 2, isEntryPoint: false, isTerminal: false, pipelineId: "P8", actionLabel: "Assign Carrier" },
            { id: "S52", label: "Picked Up", color: "bg-indigo-100 text-indigo-700", order: 3, isEntryPoint: false, isTerminal: false, pipelineId: "P8", actionLabel: "Mark Picked Up" },
            { id: "S53", label: "In Transit", color: "bg-purple-100 text-purple-700", order: 4, isEntryPoint: false, isTerminal: false, pipelineId: "P8", actionLabel: "Mark In Transit" },
            { id: "S54", label: "Out for Delivery", color: "bg-amber-100 text-amber-700", order: 5, isEntryPoint: false, isTerminal: false, pipelineId: "P8", actionLabel: "Out for Delivery" },
            { id: "S55", label: "Delivered", color: "bg-green-100 text-green-700", order: 6, isEntryPoint: false, isTerminal: true,  pipelineId: "P8", actionLabel: "Mark Delivered" },
            { id: "S56", label: "Failed / RTO", color: "bg-red-100 text-red-600", order: 7, isEntryPoint: false, isTerminal: true,  pipelineId: "P8", actionLabel: "Mark Failed" },
        ],
    },
    {
        id: "P9", name: "refund", label: "Refund",
        description: "Refund sub-pipeline — pay back advances on rejected / cancelled orders",
        color: "bg-rose-100 text-rose-800", order: 9, entityType: "refund",
        statuses: [
            { id: "S57", label: "Requested", color: "bg-gray-100 text-gray-600", order: 1, isEntryPoint: true,  isTerminal: false, pipelineId: "P9" },
            { id: "S58", label: "Approved", color: "bg-amber-100 text-amber-700", order: 2, isEntryPoint: false, isTerminal: false, pipelineId: "P9", actionLabel: "Approve Refund" },
            { id: "S59", label: "Refunded", color: "bg-green-100 text-green-700", order: 3, isEntryPoint: false, isTerminal: true,  pipelineId: "P9", actionLabel: "Mark Refunded" },
            { id: "S60", label: "Rejected", color: "bg-red-100 text-red-600", order: 4, isEntryPoint: false, isTerminal: true,  pipelineId: "P9", actionLabel: "Reject Refund" },
        ],
    },
    {
        id: "P6", name: "deals", label: "Deals",
        description: "Sales deal pipeline (revenue opportunities); stages shared with pipeline settings",
        color: "bg-cyan-100 text-cyan-800", order: 6, entityType: "deal",
        statuses: [
            { id: "S35", label: "Lead", color: "bg-gray-100 text-gray-600", order: 1, isEntryPoint: true,  isTerminal: false, pipelineId: "P6" },
            { id: "S36", label: "Contacted", color: "bg-blue-100 text-blue-600", order: 2, isEntryPoint: false, isTerminal: false, pipelineId: "P6" },
            { id: "S37", label: "Qualified", color: "bg-teal-100 text-teal-600", order: 3, isEntryPoint: false, isTerminal: false, pipelineId: "P6" },
            { id: "S38", label: "Proposal Sent", color: "bg-yellow-100 text-yellow-700", order: 4, isEntryPoint: false, isTerminal: false, pipelineId: "P6" },
            { id: "S39", label: "Negotiation", color: "bg-orange-100 text-orange-600", order: 5, isEntryPoint: false, isTerminal: false, pipelineId: "P6" },
            { id: "S40", label: "Won", color: "bg-green-100 text-green-700", order: 6, isEntryPoint: false, isTerminal: true,  pipelineId: "P6" },
            { id: "S41", label: "Lost", color: "bg-red-100 text-red-600", order: 7, isEntryPoint: false, isTerminal: true,  pipelineId: "P6" },
        ],
    },
];

// Work GROUPS — categories that bundle works (the Work Inbox organises group-wise).
const WORK_GROUPS = [
    { id: "G1", label: "Calling", order: 1, color: "bg-blue-100 text-blue-600" },
    { id: "G2", label: "Repairing", order: 2, color: "bg-green-100 text-green-700" },
    { id: "G3", label: "Admin", order: 3, color: "bg-orange-100 text-orange-600" },
    { id: "G4", label: "Parts & Courier", order: 4, color: "bg-purple-100 text-purple-600" },
    { id: "G5", label: "Orders", order: 5, color: "bg-amber-100 text-amber-700" },
] as const;

// Works — the activity each worker represents. Gated works mint a
// permission ("work:<id>") that gates who may set their workers; the
// state-like works (escalated / ready / no_fix) stay ungated (any staff).
// Opaque ids (W1…W7) so the id never encodes the label — renames stay safe.
// groupId → WorkGroup (above).
const WORKS = [
    { id: "W1", label: "Tele Calling", order: 1, color: "bg-blue-100 text-blue-600", gated: true, groupId: "G1", successLabel: "Reachable", failLabel: "Unreachable", prompt: "Add alternative number of customer if you know", startLabel: "Make a call", args: [{ key: "number", label: "Call number", source: "customer.phone" }, { key: "reason", label: "Reason", source: "user", kind: "text", on: "fail" }] },
    { id: "W2", label: "Repairing", order: 2, color: "bg-green-100 text-green-700", gated: false, groupId: "G2", successLabel: "Fixed", failLabel: "Can't fix", args: [] },
    { id: "W3", label: "Admin Approval", order: 3, color: "bg-orange-100 text-orange-600", gated: false, groupId: "G3", successLabel: "Approved", failLabel: "Rejected", args: [] },
    { id: "W4", label: "Order Parts", order: 4, color: "bg-purple-100 text-purple-600", gated: false, groupId: "G4", successLabel: "Ordered", failLabel: "Unavailable", args: [{ key: "part", label: "Part needed", source: "user", kind: "text" }] },
    { id: "W5", label: "Waiting & Follow Up", order: 5, color: "bg-teal-100 text-teal-600", gated: false, groupId: "G1", successLabel: null, failLabel: null, args: [] },
    { id: "W6", label: "Escalated To EC", order: 6, color: "bg-red-100 text-red-600", gated: false, groupId: "G3", successLabel: null, failLabel: null, args: [] },
    { id: "W7", label: "Incoming Courier", order: 7, color: "bg-orange-100 text-orange-600", gated: false, groupId: "G4", successLabel: "Received", failLabel: "Lost", args: [{ key: "tracking", label: "Tracking #", source: "user", kind: "text", on: "success" }, { key: "lost_reason", label: "Lost reason", source: "user", kind: "text", on: "fail" }] },
    { id: "W8", label: "Order", order: 8, color: "bg-orange-100 text-orange-600", gated: false, groupId: "G5", successLabel: null, failLabel: null, args: [] },
    // Demo ACTION (kind:"auto") — runs the open_tab tool instead of a human. Reports
    // Success (tab opened) / Unsuccess (blocked); saves the opened URL to context.lookup_url.
    { id: "W9", label: "IMEI Lookup", order: 9, color: "bg-violet-100 text-violet-600", gated: false, groupId: null, successLabel: "Opened", failLabel: "Blocked", args: [], kind: "auto", toolType: "open_tab", toolConfig: { bindings: { url: { mode: "fixed", value: "https://www.imei.info" } }, outputs: { openedUrl: "lookup_url" } } },
] as const;

type WorkerSeed = {
    id: string; label: string; order: number; color: string;  // color is a Tailwind class OR a #hex
    workId: string | null; statusId: string | null;
    pipelineId: string;
    publicLabel?: string;   // customer-portal label; omit to fall back to the status name

    triggerMap?: Record<string, string>;
    warrantyScope?: string; actionLabel?: string;
    // Entry-time popup (on worker change): auto transition note + optional note popup.
    transitionNote?: string;
    skipNoteOnEntry?: boolean;
    requireNoteOnEntry?: boolean;
    entryQuestion?: string;
    // Hybrid retry schedule: a "waiting" worker re-arms its work on a front-loaded
    // schedule (1st attempt immediate, then densest phase first). After the last
    // phase's last attempt it routes to failWorkerId (the unsuccess route = give-up).
    // [] = no retry.
    retrySchedule?: { unit: string; every: number; times: number }[];
    successWorkerId?: string;   // outcome routing (set in a second pass; self/forward FK)
    failWorkerId?: string;
    spawnPipelineId?: string;      // 5th power: entering here spawns a child ticket on this pipeline
    parentSignal?: string;         // on a CHILD worker: "success"|"fail" report-back to the parent
    actions?: { type: string; on?: "success" | "fail" | "always"; config?: Record<string, string> }[]; // 6th power: action hooks + args
};

const WORKERS_SEED: WorkerSeed[] = [
    { id: "SS45", label: "Working", order: 1, color: "bg-gray-100 text-gray-600", workId: null, statusId: "S3", pipelineId: "P1" },
    { id: "SS38", label: "New Repair Wating", order: 1, color: "bg-gray-100 text-gray-600", workId: "W2", statusId: "S1", pipelineId: "P1", actionLabel: "Dear Technician, Accept or Reject this ticket as per device condition, down waste time !! ", successWorkerId: "SS39", failWorkerId: "SS40" },
    { id: "SS1", label: "Working", order: 1, color: "bg-yellow-50 text-yellow-700", workId: null, statusId: "S2", pipelineId: "P1" },
    { id: "SS47", label: "Call Log", order: 1, color: "bg-gray-100 text-gray-600", workId: null, statusId: "S4", pipelineId: "P1" },
    { id: "SS39", label: "Start", order: 2, color: "bg-gray-100 text-gray-600", workId: null, statusId: "S1", pipelineId: "P1", triggerMap: {"S1":"S2"} },
    { id: "SS40", label: "Reject", order: 3, color: "bg-gray-100 text-gray-600", workId: null, statusId: "S1", pipelineId: "P1", triggerMap: {"S1":"S8"} },
    { id: "SS42", label: "Calling: Customer Info", order: 11, color: "bg-gray-100 text-gray-600", workId: "W1", statusId: "S2", pipelineId: "P1", actionLabel: "Dear Tele Caller, Please Call the Customer Reason given in Note !!", retrySchedule: [{"unit":"minute","every":60,"times":1},{"unit":"hour","every":6,"times":2},{"unit":"day","every":1,"times":3},{"unit":"week","every":1,"times":3},{"unit":"month","every":1,"times":3},{"unit":"year","every":1,"times":2}], successWorkerId: "SS4", failWorkerId: "SS3" },
    { id: "SS10", label: "Need Parts", order: 11, color: "#B5D345", workId: "W6", statusId: "S3", pipelineId: "P1", actionLabel: "Hi, Dear Manager, Service need 3rd Party Help. Should we proceed or Reject and close ?", retrySchedule: [{"unit":"hour","every":3,"times":100}], successWorkerId: "SS58", failWorkerId: "SS51" },
    { id: "SS58", label: "Order Parts", order: 12, color: "bg-orange-50 text-orange-600", workId: "W4", statusId: "S3", pipelineId: "P1", actionLabel: "Dear Purchase Manager, Please order the item need for complete the repair  . ", retrySchedule: [{"unit":"hour","every":3,"times":100}], successWorkerId: "SS50", failWorkerId: "SS51" },
    { id: "SS3", label: "Unreachable: Customer Info", order: 12, color: "bg-red-50 text-red-600", workId: null, statusId: "S2", pipelineId: "P1", actionLabel: "Dear Tele Caller, Please Call the Customer Reason given in Note !!", triggerMap: {"S2":"S8"}, successWorkerId: "SS4", failWorkerId: "SS3" },
    { id: "SS4", label: "Customer Responded", order: 13, color: "bg-green-50 text-green-700", workId: "W2", statusId: "S2", pipelineId: "P1", actionLabel: "Dear Technician, Customer Responded if Happy Start Work Again, if Not Happy Close the Ticket !!", successWorkerId: "SS1", failWorkerId: "SS3" },
    { id: "SS50", label: "Waiting for parts", order: 13, color: "bg-teal-100 text-teal-600", workId: "W5", statusId: "S3", pipelineId: "P1", successWorkerId: "SS52", failWorkerId: "SS50" },
    { id: "SS18", label: "Engineer Visit Requested", order: 18, color: "bg-orange-50 text-orange-600", workId: null, statusId: "S4", pipelineId: "P1" },
    { id: "SS19", label: "Engineer Visit Scheduled", order: 19, color: "bg-blue-50 text-blue-600", workId: null, statusId: "S4", pipelineId: "P1" },
    { id: "SS20", label: "Engineer On-Site", order: 20, color: "bg-blue-50 text-blue-600", workId: null, statusId: "S4", pipelineId: "P1" },
    { id: "SS21", label: "Engineer Work Complete", order: 21, color: "bg-green-50 text-green-700", workId: null, statusId: "S4", pipelineId: "P1", triggerMap: {"S4":"S3"} },
    { id: "SS43", label: "Calling: Customer to Bring Accessories", order: 21, color: "bg-gray-100 text-gray-600", workId: "W1", statusId: "S2", pipelineId: "P1", publicLabel: "Calling: Customer to Bring Accessories", actionLabel: "Calling: Customer to Bring Accessories", retrySchedule: [{"unit":"minute","every":60,"times":1},{"unit":"hour","every":6,"times":2},{"unit":"day","every":1,"times":3},{"unit":"week","every":1,"times":3},{"unit":"month","every":1,"times":3},{"unit":"year","every":1,"times":2}], successWorkerId: "SS2", failWorkerId: "SS53" },
    { id: "SS2", label: "Waiting: Customer to Bring Accessories", order: 22, color: "bg-orange-100 text-orange-600", workId: "W5", statusId: "S2", pipelineId: "P1", retrySchedule: [{"unit":"day","every":1,"times":3}], successWorkerId: "SS1", failWorkerId: "SS54" },
    { id: "SS22", label: "Pending Despatch", order: 22, color: "bg-orange-50 text-orange-700", workId: null, statusId: "S4", pipelineId: "P1" },
    { id: "SS54", label: "Calling: Customer to Bring Accessories 2nd Attempt", order: 23, color: "bg-gray-100 text-gray-600", workId: "W1", statusId: "S2", pipelineId: "P1", publicLabel: "Calling: Customer to Bring Accessories", actionLabel: "Calling: Customer to Bring Accessories", retrySchedule: [{"unit":"minute","every":60,"times":1},{"unit":"hour","every":6,"times":2},{"unit":"day","every":1,"times":3},{"unit":"week","every":1,"times":3},{"unit":"month","every":1,"times":3},{"unit":"year","every":1,"times":2}], successWorkerId: "SS55", failWorkerId: "SS53" },
    { id: "SS23", label: "Dispatched", order: 23, color: "bg-blue-50 text-blue-600", workId: null, statusId: "S4", pipelineId: "P1" },
    { id: "SS24", label: "Received by Service Centre", order: 24, color: "bg-blue-50 text-blue-600", workId: null, statusId: "S4", pipelineId: "P1" },
    { id: "SS25", label: "Being Repaired", order: 25, color: "bg-blue-50 text-blue-600", workId: null, statusId: "S4", pipelineId: "P1" },
    { id: "SS55", label: "Waiting: Customer to Bring Accessories 2nd Attempt", order: 25, color: "bg-yellow-50 text-yellow-700", workId: "W5", statusId: "S2", pipelineId: "P1", retrySchedule: [{"unit":"day","every":1,"times":3}], successWorkerId: "SS1", failWorkerId: "SS56" },
    { id: "SS26", label: "Service Centre Delayed", order: 26, color: "bg-red-50 text-red-600", workId: null, statusId: "S4", pipelineId: "P1" },
    { id: "SS56", label: "Calling: Customer to Bring Accessories 3rd Attempt", order: 26, color: "bg-gray-100 text-gray-600", workId: "W1", statusId: "S2", pipelineId: "P1", publicLabel: "Calling: Customer to Bring Accessories", actionLabel: "Calling: Customer to Bring Accessories", retrySchedule: [{"unit":"minute","every":60,"times":1},{"unit":"hour","every":6,"times":2},{"unit":"day","every":1,"times":3},{"unit":"week","every":1,"times":3},{"unit":"month","every":1,"times":3},{"unit":"year","every":1,"times":2}], successWorkerId: "SS57", failWorkerId: "SS53" },
    { id: "SS27", label: "Shipped Back to Us", order: 27, color: "bg-purple-50 text-purple-600", workId: null, statusId: "S4", pipelineId: "P1" },
    { id: "SS57", label: "Waiting: Customer to Bring Accessories 3rd Attempt", order: 27, color: "bg-yellow-50 text-yellow-700", workId: "W5", statusId: "S2", pipelineId: "P1", retrySchedule: [{"unit":"year","every":2,"times":1}], successWorkerId: "SS1", failWorkerId: "SS53" },
    { id: "SS28", label: "Received by Us", order: 28, color: "bg-green-50 text-green-700", workId: null, statusId: "S4", pipelineId: "P1", triggerMap: {"S4":"S5"} },
    { id: "SS29", label: "Customer Notified", order: 29, color: "bg-green-50 text-green-700", workId: null, statusId: "S6", pipelineId: "P1" },
    { id: "SS30", label: "Reminder Sent", order: 30, color: "bg-yellow-50 text-yellow-700", workId: null, statusId: "S6", pipelineId: "P1" },
    { id: "SS53", label: "move to scrap", order: 31, color: "bg-gray-100 text-gray-600", workId: null, statusId: "S2", pipelineId: "P1", triggerMap: {"S2":"S63"} },
    { id: "SS31", label: "Uncollected - Action Needed", order: 31, color: "bg-red-50 text-red-600", workId: null, statusId: "S6", pipelineId: "P1" },
    { id: "SS32", label: "Beyond Economical Repair", order: 32, color: "bg-red-50 text-red-600", workId: null, statusId: "S8", pipelineId: "P1" },
    { id: "SS33", label: "Customer Informed", order: 33, color: "bg-gray-50 text-gray-600", workId: null, statusId: "S8", pipelineId: "P1" },
    { id: "SS34", label: "Collecting Unrepaired", order: 34, color: "bg-gray-50 text-gray-600", workId: null, statusId: "S8", pipelineId: "P1", triggerMap: {"S8":"S7"} },
    { id: "SS35", label: "Scrapped with Consent", order: 35, color: "bg-gray-50 text-gray-600", workId: null, statusId: "S8", pipelineId: "P1" },
    { id: "SS36", label: "Warranty Voided - Customer Approval Needed", order: 36, color: "bg-red-100 text-red-600", workId: "W1", statusId: null, pipelineId: "P1", actionLabel: "Call customer - warranty void, confirm paid repair" },
    { id: "SS37", label: "Confirmed Under Warranty - Proceeding", order: 37, color: "bg-green-100 text-green-700", workId: "W1", statusId: null, pipelineId: "P1", actionLabel: "Inform customer - covered under warranty, no charge" },
    { id: "SS46", label: "Need 3rd Party Help", order: 46, color: "bg-gray-100 text-gray-600", workId: null, statusId: "S3", pipelineId: "P1", triggerMap: {"S3":"S61"} },
    { id: "SS48", label: "Find Help and Call Log", order: 48, color: "bg-gray-100 text-gray-600", workId: null, statusId: "S61", pipelineId: "P1" },
    { id: "SS52", label: "End Wait", order: 52, color: "bg-gray-100 text-gray-600", workId: "W5", statusId: "S3", pipelineId: "P1", successWorkerId: "SS45", failWorkerId: "SS51" },
    { id: "SS51", label: "Parts Not Avilable - Close", order: 100, color: "bg-gray-100 text-gray-600", workId: null, statusId: "S3", pipelineId: "P1", triggerMap: {"S3":"S8"} },
];

const STATUS_TRANSITIONS = [
    // P1 service (captured from the live workflow)
    { fromStatusId: "S2", toStatusId: "S3" },
    { fromStatusId: "S2", toStatusId: "S9" },
    { fromStatusId: "S3", toStatusId: "S61" },
    { fromStatusId: "S3", toStatusId: "S9" },
    { fromStatusId: "S42", toStatusId: "S43" },
    // New → Confirmed directly: the board's Review popup confirms a New order in one
    // click (skipping the manual Under Review hop). Under Review → Confirmed still exists.
    { fromStatusId: "S42", toStatusId: "S44" },
    { fromStatusId: "S42", toStatusId: "S48" },
    { fromStatusId: "S43", toStatusId: "S44" },
    { fromStatusId: "S43", toStatusId: "S48" },
    { fromStatusId: "S44", toStatusId: "S45" },
    { fromStatusId: "S44", toStatusId: "S48" },
    { fromStatusId: "S45", toStatusId: "S46" },
    { fromStatusId: "S46", toStatusId: "S47" },
    { fromStatusId: "S46", toStatusId: "S49" },
    // P8 delivery sub-pipeline
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
    // P9 refund sub-pipeline: Requested → Approved → Refunded; reject from either.
    { fromStatusId: "S57", toStatusId: "S58" },
    { fromStatusId: "S57", toStatusId: "S60" },
    { fromStatusId: "S58", toStatusId: "S59" },
    { fromStatusId: "S58", toStatusId: "S60" },
];

// Real from→to step transitions only. Entry (which sub auto-applies on entering a
// status) is no longer encoded as a `null →` row — it's hand-picked per status via
// TicketStatus.startWorkerId (see STATUS_STARTS below).
const SUB_STATUS_TRANSITIONS = [
    { fromWorkerId: "SS18", toWorkerId: "SS19" },
    { fromWorkerId: "SS19", toWorkerId: "SS20" },
    { fromWorkerId: "SS20", toWorkerId: "SS21" },
    { fromWorkerId: "SS22", toWorkerId: "SS23" },
    { fromWorkerId: "SS23", toWorkerId: "SS24" },
    { fromWorkerId: "SS24", toWorkerId: "SS25" },
    { fromWorkerId: "SS25", toWorkerId: "SS26" },
    { fromWorkerId: "SS25", toWorkerId: "SS27" },
    { fromWorkerId: "SS26", toWorkerId: "SS27" },
    { fromWorkerId: "SS27", toWorkerId: "SS28" },
    { fromWorkerId: "SS29", toWorkerId: "SS30" },
    { fromWorkerId: "SS30", toWorkerId: "SS31" },
    { fromWorkerId: "SS32", toWorkerId: "SS33" },
    { fromWorkerId: "SS33", toWorkerId: "SS34" },
    { fromWorkerId: "SS33", toWorkerId: "SS35" },
    { fromWorkerId: "SS2", toWorkerId: "SS1" },
    { fromWorkerId: "SS1", toWorkerId: "SS42" },
    { fromWorkerId: "SS1", toWorkerId: "SS43" },
    { fromWorkerId: "SS50", toWorkerId: "SS45" },
    { fromWorkerId: "SS45", toWorkerId: "SS10" },
    { fromWorkerId: "SS45", toWorkerId: "SS46" },
] as const;

// Hand-picked start worker per parent status — the one auto-applied on entry.
// Each status starts on its OWN work-type's first node (so the shared pool yields a
// different start per status, e.g. SS1 is the start of S2 but S3 starts on SS10).
// Statuses absent here (S1/S5/S7/S9, and all of P2–P9) have no applicable worker,
// so they start with none. Applied in a pass AFTER workers exist (FK ordering).
const STATUS_STARTS: Record<string, string> = {
    S1: "SS38",  // Received   → New Repair Wating
    S2: "SS1",   // Diagnosing → Working
    S3: "SS45",  // Repairing  → Working
    S4: "SS47",  // Escalated  → Call Log
    S6: "SS29",  // Ready      → Customer Notified
    S8: "SS32",  // No Fix     → Beyond Economical Repair
    S61: "SS48", // Need Help  → Find Help and Call Log
};

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
        id:    "BR-HQ",
        name:  "Head Office",
        // Legacy single-line — kept for old list rows that still consult it.
        address:      `${COMPANY_DETAILS.address.line1}, ${COMPANY_DETAILS.address.city}`,
        phone:        COMPANY_DETAILS.contact.phone || null,
        // Structured identity for invoice headers / letterheads
        addressLine1: COMPANY_DETAILS.address.line1,
        addressLine2: COMPANY_DETAILS.address.line2 ?? "",
        city:         COMPANY_DETAILS.address.city,
        state:        COMPANY_DETAILS.address.state,
        pinCode:      COMPANY_DETAILS.address.pin,
        country:      COMPANY_DETAILS.address.country,
        email:        COMPANY_DETAILS.contact.email || null,
        gstin:        HQ_GSTIN,
        gstStateCode: HQ_GSTIN.length >= 2 ? HQ_GSTIN.slice(0, 2) : "",
    },
];

const DEPARTMENTS: { id: string; name: string; description: string; isAllAccess?: boolean }[] = [
    // All-access department — home for cross-cutting roles (R1 Admin). Its
    // permission pool is "every permission" (computed live; no DepartmentPermission
    // rows), so new permissions are auto-grantable to admin roles. Exactly one
    // department carries isAllAccess.
    { id: "DEP-ADMIN",  name: "Administration", description: "Org-wide administration — all-access role authoring", isAllAccess: true },
    { id: "DEP-REPAIR", name: "Repairs",     description: "Device diagnosis and repair" },
    { id: "DEP-SALES",  name: "Sales",       description: "Sales and customer acquisition" },
    { id: "DEP-DESK",   name: "Front Desk",  description: "Customer intake, calls, and receipts" },
    { id: "DEP-FIN",    name: "Finance",     description: "Accounts, invoices, and reporting" },
    { id: "DEP-HR",     name: "HR",          description: "People operations and recruitment" },
    { id: "DEP-IT",     name: "IT / Admin",  description: "Systems, infrastructure, and admin" },
    { id: "DEP-DESP",   name: "Despatch",    description: "Courier, logistics, and shipping" },
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
type NormBal   = "DEBIT" | "CREDIT";

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
        if (rows[0].code === null && code)                 { vals.push(code);    updates.push(`code = $${vals.length}`);    }
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
    email:    "admin@networkservice.in",
    name:     "Admin",
    role:     "R1",
    password: "admin123",
};

// ════════════════════════════════════════════════════════════════════════════
// SECTION 6 — DB constraints (XOR on Phone/Email ownership)
// ════════════════════════════════════════════════════════════════════════════

async function ensureXorCheck(table: "Phone" | "Email", constraintName: string) {
    const { rows } = await pool.query(
        `SELECT conname FROM pg_constraint WHERE conname = $1`,
        [constraintName],
    );
    if (rows.length > 0) return;
    await pool.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${constraintName}"
         CHECK (("personId" IS NULL) <> ("companyId" IS NULL))`,
    );
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════════

async function main() {
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
            where:  { id: r.id },
            update: { label: r.label, color: r.color, isSystem: r.isSystem, rank: r.rank, departmentId: r.departmentId },
            create: { id: r.id, label: r.label, color: r.color, isSystem: r.isSystem, rank: r.rank, departmentId: r.departmentId },
        });
    }
    for (const p of PERMISSIONS) {
        await prisma.permission.upsert({
            where:  { id: p.id },
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
    console.log(`      ✓ ${ROLES.length} roles · ${PERMISSIONS.length} permissions · ${grants.length} grants\n`);

    // ── Section 2: Workflow ────────────────────────────────────────────
    console.log("[2/7] Workflow — Pipelines, Statuses, Workers, Transitions");
    for (const pl of PIPELINES) {
        await prisma.pipeline.upsert({
            where:  { id: pl.id },
            update: { name: pl.name, label: pl.label, description: pl.description, color: pl.color, isDefault: pl.isDefault ?? false, isActive: true, order: pl.order, entityType: pl.entityType },
            create: { id: pl.id, name: pl.name, label: pl.label, description: pl.description, color: pl.color, isDefault: pl.isDefault ?? false, isActive: true, order: pl.order, entityType: pl.entityType },
        });
        for (const s of pl.statuses) {
            await prisma.ticketStatus.upsert({
                where:  { id: s.id },
                update: { label: s.label, color: s.color, order: s.order, isTerminal: s.isTerminal, isEntryPoint: s.isEntryPoint, actionLabel: s.actionLabel ?? null, warrantyScope: "any", leavePrompt: s.leavePrompt ?? null, announceOnEntry: s.announceOnEntry ?? false, etaText: s.etaText ?? null, pipelineId: s.pipelineId },
                create: { id: s.id, label: s.label, color: s.color, order: s.order, isTerminal: s.isTerminal, isEntryPoint: s.isEntryPoint, actionLabel: s.actionLabel ?? null, warrantyScope: "any", leavePrompt: s.leavePrompt ?? null, announceOnEntry: s.announceOnEntry ?? false, etaText: s.etaText ?? null, pipelineId: s.pipelineId },
            });
        }
    }
    // Colors are random hex (no legacy Tailwind-class presets). A class-valued color
    // in the arrays is filled with a fresh random hex ("fill random for backward").
    const seedColor = (c: string) => /^#/.test(c) ? c : "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0").toUpperCase();
    for (const g of WORK_GROUPS) {
        await prisma.workGroup.upsert({
            where:  { id: g.id },
            update: { label: g.label, color: seedColor(g.color), order: g.order },
            create: { id: g.id, label: g.label, color: seedColor(g.color), order: g.order },
        });
    }
    for (const w of WORKS) {
        const permissionId = w.gated ? `work:${w.id}` : null;
        const color = seedColor(w.color);
        // Work-shape fields are optional in the seed rows — default them here.
        const shape = w as { prompt?: string | null; startLabel?: string | null; successPopup?: boolean; failPopup?: boolean; kind?: string; toolType?: string | null; toolConfig?: unknown };
        const shapeFields = {
            prompt: shape.prompt ?? null, startLabel: shape.startLabel ?? null,
            successPopup: shape.successPopup ?? false, failPopup: shape.failPopup ?? false,
            kind: shape.kind ?? "human", toolType: shape.toolType ?? null,
            toolConfig: (shape.toolConfig ?? {}) as Prisma.InputJsonValue,
        };
        await prisma.work.upsert({
            where:  { id: w.id },
            update: { label: w.label, color, order: w.order, permissionId, groupId: w.groupId, successLabel: w.successLabel, failLabel: w.failLabel, args: w.args as unknown as Prisma.InputJsonValue, ...shapeFields },
            create: { id: w.id, label: w.label, color, order: w.order, permissionId, groupId: w.groupId, successLabel: w.successLabel, failLabel: w.failLabel, args: w.args as unknown as Prisma.InputJsonValue, ...shapeFields },
        });
    }
    for (const ss of WORKERS_SEED) {
        const retry = { retrySchedule: ss.retrySchedule ?? [], publicLabel: ss.publicLabel ?? null, spawnPipelineId: ss.spawnPipelineId ?? null, parentSignal: ss.parentSignal ?? null, actions: (ss.actions ?? []) as unknown as Prisma.InputJsonValue, transitionNote: ss.transitionNote ?? null, skipNoteOnEntry: ss.skipNoteOnEntry ?? false, requireNoteOnEntry: ss.requireNoteOnEntry ?? false, entryQuestion: ss.entryQuestion ?? null };
        const color = seedColor(ss.color);
        await prisma.ticketWorker.upsert({
            where:  { id: ss.id },
            update: { label: ss.label, color, order: ss.order, statusId: ss.statusId, triggerMap: ss.triggerMap ?? {}, actionLabel: ss.actionLabel ?? null, autoRevertOnClear: true, warrantyScope: ss.warrantyScope ?? "any", workId: ss.workId, pipelineId: ss.pipelineId, ...retry },
            create: { id: ss.id, label: ss.label, color, order: ss.order, statusId: ss.statusId, triggerMap: ss.triggerMap ?? {}, actionLabel: ss.actionLabel ?? null, autoRevertOnClear: true, warrantyScope: ss.warrantyScope ?? "any", workId: ss.workId, pipelineId: ss.pipelineId, ...retry },
        });
    }
    // Hand-picked start worker per status — set now that both statuses and
    // workers exist (FK TicketStatus.startWorkerId → TicketWorker).
    for (const [statusId, workerId] of Object.entries(STATUS_STARTS)) {
        await prisma.ticketStatus.update({ where: { id: statusId }, data: { startWorkerId: workerId } });
    }
    // Outcome routing (success / unsuccess give-up target) — set in a second pass
    // (self-FK; the target may be defined later in WORKERS_SEED than the source).
    for (const ss of WORKERS_SEED) {
        if (ss.successWorkerId || ss.failWorkerId) {
            await prisma.ticketWorker.update({
                where: { id: ss.id },
                data: {
                    ...(ss.successWorkerId && { successWorkerId: ss.successWorkerId }),
                    ...(ss.failWorkerId && { failWorkerId: ss.failWorkerId }),
                },
            });
        }
    }
    for (const t of STATUS_TRANSITIONS) {
        await prisma.statusTransition.upsert({
            where:  { fromStatusId_toStatusId: { fromStatusId: t.fromStatusId, toStatusId: t.toStatusId } },
            update: {},
            create: t,
        });
    }
    for (const t of SUB_STATUS_TRANSITIONS) {
        const exists = await prisma.workerTransition.findFirst({
            where: { fromWorkerId: t.fromWorkerId, toWorkerId: t.toWorkerId },
            select: { id: true },
        });
        if (!exists) await prisma.workerTransition.create({ data: t });
    }
    console.log(`      ✓ ${PIPELINES.length} pipelines · ${PIPELINES.reduce((s, p) => s + p.statuses.length, 0)} statuses · ${WORKERS_SEED.length} workers\n`);

    // ── Section 3: Org structure ────────────────────────────────────────
    console.log("[3/7] Org structure — Branches, Departments");
    for (const b of BRANCHES) {
        // Re-seed contract: insert with the full identity on a fresh DB so
        // invoices have a printable address on day one. On re-seed we touch
        // only `name` and `isActive` — every other column is preserved so
        // admin edits via /office/admin/branches survive `pnpm prisma db seed`.
        await pool.query(
            `INSERT INTO "Branch" (
                id, name, address, phone, "isActive",
                "addressLine1", "addressLine2", city, state, "pinCode", country,
                email, gstin, "gstStateCode"
             )
             VALUES ($1, $2, $3, $4, true,
                     $5, $6, $7, $8, $9, $10,
                     $11, $12, $13)
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, "isActive" = true`,
            [
                b.id, b.name, b.address, b.phone,
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
    const capitalAccountId     = await upsertGroup("Capital Account",        "LIABILITY", 10);
    const loansLiabilityId     = await upsertGroup("Loans (Liability)",      "LIABILITY", 20);
    const currentLiabilitiesId = await upsertGroup("Current Liabilities",    "LIABILITY", 30);
    await upsertGroup("Fixed Assets",           "ASSET",     40);
    await upsertGroup("Investments",            "ASSET",     50);
    const currentAssetsId      = await upsertGroup("Current Assets",         "ASSET",     60);
    await upsertGroup("Branch / Divisions",     "ASSET",     70);
    await upsertGroup("Misc. Expenses (Asset)", "ASSET",     80);
    await upsertGroup("Suspense A/c",           "ASSET",     90);
    await upsertGroup("Sales Accounts",         "INCOME",    100);
    await upsertGroup("Purchase Accounts",      "EXPENSE",   110);
    await upsertGroup("Direct Incomes",         "INCOME",    120);
    await upsertGroup("Direct Expenses",        "EXPENSE",   130);
    await upsertGroup("Indirect Incomes",       "INCOME",    140);
    await upsertGroup("Indirect Expenses",      "EXPENSE",   150);

    // Sub-groups
    await upsertGroup("Reserves & Surplus",       "LIABILITY", 10, capitalAccountId);
    await upsertGroup("Bank OD A/c",              "LIABILITY", 10, loansLiabilityId);
    await upsertGroup("Secured Loans",            "LIABILITY", 20, loansLiabilityId);
    await upsertGroup("Unsecured Loans",          "LIABILITY", 30, loansLiabilityId);
    await upsertGroup("Duties & Taxes",           "LIABILITY", 10, currentLiabilitiesId);
    await upsertGroup("Provisions",               "LIABILITY", 20, currentLiabilitiesId);
    await upsertGroup("Sundry Creditors",         "LIABILITY", 30, currentLiabilitiesId);
    await upsertGroup("Stock-in-Hand",            "ASSET",     10, currentAssetsId);
    await upsertGroup("Deposits (Asset)",         "ASSET",     20, currentAssetsId);
    await upsertGroup("Loans & Advances (Asset)", "ASSET",     30, currentAssetsId);
    await upsertGroup("Sundry Debtors",           "ASSET",     40, currentAssetsId);
    await upsertGroup("Cash-in-Hand",             "ASSET",     50, currentAssetsId);
    await upsertGroup("Bank Accounts",            "ASSET",     60, currentAssetsId);

    // GL ledgers — Stock-in-Hand intentionally has NO children.
    await upsertLedger("Cash",                    "Cash-in-Hand",      "DEBIT",  "1000");
    await upsertLedger("Petty Cash",              "Cash-in-Hand",      "DEBIT");
    await upsertLedger("Bank Account",            "Bank Accounts",     "DEBIT",  "1010");
    await upsertLedger("Accounts Receivable",     "Sundry Debtors",    "DEBIT",  "1100");
    await upsertLedger("Accounts Payable",        "Sundry Creditors",  "CREDIT", "2000");
    await upsertLedger("Walk-in Cash Customer",   "Sundry Debtors",    "DEBIT",  "CASH-WALKIN");
    await upsertLedger("Prepaid Expenses",        "Loans & Advances (Asset)", "DEBIT", "1300");
    await upsertLedger("Profit & Loss A/c",       null,                "CREDIT");
    await upsertLedger("Capital",                 "Capital Account",   "CREDIT", "3000");
    await upsertLedger("Drawings",                "Capital Account",   "DEBIT");
    await upsertLedger("Retained Earnings",       "Reserves & Surplus", "CREDIT", "3100");
    await upsertLedger("Sales A/c",               "Sales Accounts",    "CREDIT");
    await upsertLedger("Parts Revenue",           "Sales Accounts",    "CREDIT", "4100");
    await upsertLedger("Shop Sales Revenue",      "Sales Accounts",    "CREDIT", "4150");
    await upsertLedger("Purchase A/c",            "Purchase Accounts", "DEBIT");
    await upsertLedger("Sales Returns",           "Sales Accounts",    "DEBIT");
    await upsertLedger("Purchase Returns",        "Purchase Accounts", "CREDIT");
    await upsertLedger("CGST",                    "Duties & Taxes",    "CREDIT");
    await upsertLedger("SGST",                    "Duties & Taxes",    "CREDIT");
    await upsertLedger("IGST",                    "Duties & Taxes",    "CREDIT");
    await upsertLedger("UTGST",                   "Duties & Taxes",    "CREDIT");
    await upsertLedger("TDS",                     "Duties & Taxes",    "CREDIT");
    await upsertLedger("Tax Payable",             "Duties & Taxes",    "CREDIT", "2100");
    await upsertLedger("Professional Tax",        "Duties & Taxes",    "CREDIT");
    await upsertLedger("ESI Payable",             "Duties & Taxes",    "CREDIT");
    await upsertLedger("PF Payable",              "Duties & Taxes",    "CREDIT");
    await upsertLedger("Accrued Expenses",        "Provisions",        "CREDIT", "2200");
    await upsertLedger("Provision for Tax",       "Provisions",        "CREDIT");
    await upsertLedger("Provision for Bad Debts", "Provisions",        "CREDIT");
    await upsertLedger("General Reserve",         "Reserves & Surplus", "CREDIT");
    await upsertLedger("Service Charges Income",  "Direct Incomes",    "CREDIT", "4000");
    await upsertLedger("Warranty Revenue",        "Direct Incomes",    "CREDIT", "4200");
    await upsertLedger("Other Revenue",           "Indirect Incomes",  "CREDIT", "4900");
    await upsertLedger("Discount Received",       "Indirect Incomes",  "CREDIT");
    // Outward freight collected from customers on the sale invoice.
    // Separated from Sales A/c so the P&L breaks out delivery revenue.
    await upsertLedger("Shipping Income",         "Indirect Incomes",  "CREDIT");
    await upsertLedger("Round Off",               "Indirect Incomes",  "CREDIT");
    await upsertLedger("Interest Received",       "Indirect Incomes",  "CREDIT");
    await upsertLedger("Commission Received",     "Indirect Incomes",  "CREDIT");
    await upsertLedger("Cost of Parts Sold",      "Direct Expenses",   "DEBIT",  "5000");
    await upsertLedger("Tools & Equipment",       "Direct Expenses",   "DEBIT",  "6300");
    await upsertLedger("Repair & Maintenance",    "Direct Expenses",   "DEBIT");
    await upsertLedger("Consumables & Spares",    "Direct Expenses",   "DEBIT");
    await upsertLedger("Freight Charges",         "Direct Expenses",   "DEBIT");
    await upsertLedger("Carriage Inward",         "Direct Expenses",   "DEBIT");
    await upsertLedger("Salary & Wages",          "Indirect Expenses", "DEBIT",  "6200");
    await upsertLedger("Rent",                    "Indirect Expenses", "DEBIT",  "6000");
    await upsertLedger("Utilities Expense",       "Indirect Expenses", "DEBIT",  "6100");
    await upsertLedger("Miscellaneous Expense",   "Indirect Expenses", "DEBIT",  "6900");
    await upsertLedger("Electricity Charges",     "Indirect Expenses", "DEBIT");
    await upsertLedger("Telephone / Internet",    "Indirect Expenses", "DEBIT");
    await upsertLedger("Discount Allowed",        "Indirect Expenses", "DEBIT");
    // Dedicated expense ledger for loyalty-point redemptions (kept separate from
    // "Discount Allowed" so the P&L breaks out the cost of the loyalty programme).
    // Redemption posts here as a negative InvVoucherCharge on the POS sale.
    await upsertLedger("Loyalty Points Redeemed",  "Indirect Expenses", "DEBIT");
    // Dedicated expense ledger for coupon/promo discounts (kept separate from
    // "Discount Allowed" + "Loyalty Points Redeemed" so the P&L breaks out the
    // cost of each promotion channel). Posts as a negative InvVoucherCharge.
    await upsertLedger("Coupon Discounts",         "Indirect Expenses", "DEBIT");
    // Gift-card prepaid liability (Phase 4): issuing a gift card credits this;
    // redeeming one debits it via a payment tender on the POS sale.
    await upsertLedger("Gift Card Liability",      "Current Liabilities", "CREDIT");
    // Breakage income: when a gift card expires unredeemed, the leftover liability
    // is recognised here (Dr Gift Card Liability / Cr this).
    await upsertLedger("Gift Card Breakage",       "Indirect Incomes",  "CREDIT");
    await upsertLedger("Bad Debts",               "Indirect Expenses", "DEBIT");
    await upsertLedger("Bank Charges",            "Indirect Expenses", "DEBIT");
    await upsertLedger("Audit Fees",              "Indirect Expenses", "DEBIT");
    await upsertLedger("Printing & Stationery",   "Indirect Expenses", "DEBIT");
    await upsertLedger("Postage & Courier",       "Indirect Expenses", "DEBIT");
    await upsertLedger("Advertisement",           "Indirect Expenses", "DEBIT");
    await upsertLedger("Travelling Expenses",     "Indirect Expenses", "DEBIT");
    await upsertLedger("Insurance",               "Indirect Expenses", "DEBIT");
    await upsertLedger("Depreciation",            "Indirect Expenses", "DEBIT");
    await upsertLedger("Interest Paid",           "Indirect Expenses", "DEBIT");
    await upsertLedger("Commission Paid",         "Indirect Expenses", "DEBIT");
    await upsertLedger("Furniture & Fixtures",       "Fixed Assets",   "DEBIT");
    await upsertLedger("Computer & Peripherals",     "Fixed Assets",   "DEBIT");
    await upsertLedger("Office Equipment",           "Fixed Assets",   "DEBIT");
    await upsertLedger("Plant & Machinery",          "Fixed Assets",   "DEBIT");
    await upsertLedger("CCTV & Security Equipment", "Fixed Assets",    "DEBIT");
    await upsertLedger("Security Deposit",        "Deposits (Asset)",        "DEBIT");
    await upsertLedger("Earnest Money Deposit",   "Deposits (Asset)",        "DEBIT");
    await upsertLedger("Staff Advance",           "Loans & Advances (Asset)", "DEBIT");
    await upsertLedger("Advance to Suppliers",    "Loans & Advances (Asset)", "DEBIT");
    await upsertLedger("TDS Receivable",          "Loans & Advances (Asset)", "DEBIT");
    await upsertLedger("Preliminary Expenses",    "Misc. Expenses (Asset)",  "DEBIT");
    // POS cash-drawer variance — sister P&L accounts used by shift close
    // adjustment JEs. Short = staff handed in less than expected (expense);
    // Over = handed in more (income).
    await upsertLedger("Cash Short",              "Indirect Expenses", "DEBIT",  "6950");
    await upsertLedger("Cash Over",               "Indirect Incomes",  "CREDIT", "4950");
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
        const tillName    = `Cash – Counter 1 – ${b.name}`;
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
        // GATEWAY rail or online checkout points to) is operator config — bootstrap
        // seeds none; it starts empty and is wiped by hard-clean.
        const { rows: existing } = await pool.query<{ id: number }>(
            `SELECT id FROM "pos_counters" WHERE "branchId" = $1 AND name = $2 LIMIT 1`,
            [b.id, counterName],
        );
        if (existing[0]) {
            // Already exists — make sure the till account is wired.
            await pool.query(
                `UPDATE "pos_counters" SET "tillAccountId" = $1 WHERE id = $2`,
                [tillId, existing[0].id],
            );
        } else {
            await pool.query(
                `INSERT INTO "pos_counters" ("branchId", name, "tillAccountId", "isActive")
                 VALUES ($1, $2, $3, true)`,
                [b.id, counterName, tillId],
            );
        }
    }

    console.log(`      ✓ 28 groups · ~54 GL ledgers + ${BRANCHES.length} vaults + ${BRANCHES.length} counters\n`);

    // ── Section 5: Admin user ──────────────────────────────────────────
    console.log("[5/7] Admin user");
    const password = await bcrypt.hash(ADMIN.password, 10);
    const adminUser = await prisma.user.upsert({
        where:  { email: ADMIN.email },
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
        where:  { userId_positionId: { userId: adminUser.id, positionId: "POS-SYSADMIN" } },
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
            { kind: "brand",    enabled: true, defaultValue: null },
            { kind: "group",    enabled: true, defaultValue: "General" },
            { kind: "modelNo",  enabled: true, defaultValue: null },
            // Operator-curated free text (InvProduct.namePart). Sits after the
            // master-driven tokens so the regenerate button rebuilds masters
            // around it without ever overwriting it.
            { kind: "userPart", enabled: true, defaultValue: null },
        ],
        separator: " ",
        onlineNameFields: [
            { kind: "brand",    enabled: true, defaultValue: null },
            { kind: "group",    enabled: true, defaultValue: null },
            { kind: "category", enabled: true, defaultValue: null },
            { kind: "modelNo",  enabled: true, defaultValue: null },
            { kind: "warranty", enabled: true, defaultValue: null },
        ],
        onlineSeparator: " ",
        slugFields: [
            { kind: "brand",   enabled: true, defaultValue: null },
            { kind: "group",   enabled: true, defaultValue: null },
            { kind: "modelNo", enabled: true, defaultValue: null },
        ],
        slugSeparator: "-",
        slugEnabled: true,
        slugMaxLength: 80,
        fallbackFields: {
            group:    ["category", "brand"],
            category: ["group", "brand"],
            brand:    ["group", "category"],
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
        { rate: "0.00",  label: "Nil (0%)",         description: "Nil rated — essential goods & services" },
        { rate: "0.25",  label: "Special (0.25%)",   description: "Rough / uncut diamonds" },
        { rate: "3.00",  label: "Special (3%)",      description: "Gold, silver, precious metals & jewellery" },
        { rate: "5.00",  label: "GST 5%",            description: "Basic necessities — packaged food, transport, etc." },
        { rate: "12.00", label: "GST 12%",           description: "Processed food, business class travel, etc." },
        { rate: "18.00", label: "GST 18%",           description: "Standard rate — electronics, IT services, etc." },
        { rate: "28.00", label: "GST 28%",           description: "Luxury goods, automobiles, tobacco, etc." },
    ];
    for (const g of GST_RATES) {
        await prisma.gstRate.upsert({
            where:  { label: g.label },
            update: { rate: g.rate, description: g.description, isActive: true },
            create: { rate: g.rate, label: g.label, description: g.description, isActive: true },
        });
    }
    console.log(`      ✓ ${GST_RATES.length} GST rates seeded\n`);

    // ── Section 9: Inventory Unit master ───────────────────────────────
    console.log("[9/11] Inventory Unit master");
    const INV_UNITS = [
        { code: "PCS",  label: "Piece",      decimals: 0 },
        { code: "NOS",  label: "Numbers",    decimals: 0 },
        { code: "BOX",  label: "Box",        decimals: 0 },
        { code: "SET",  label: "Set",        decimals: 0 },
        { code: "UNIT", label: "Unit",       decimals: 0 },
        { code: "MTR",  label: "Metre",      decimals: 2 },
        { code: "ROLL", label: "Roll",       decimals: 0 },
        { code: "PKT",  label: "Packet",     decimals: 0 },
        { code: "PAIR", label: "Pair",       decimals: 0 },
        { code: "KG",   label: "Kilogram",   decimals: 3 },
        { code: "BAG",  label: "Bag",        decimals: 0 },
        { code: "REAM", label: "Ream",       decimals: 0 },
        { code: "DAY",  label: "Day",        decimals: 0 },
    ];
    for (const u of INV_UNITS) {
        await prisma.invUnit.upsert({
            where:  { code: u.code },
            update: { label: u.label, decimals: u.decimals, isActive: true },
            create: { code: u.code, label: u.label, decimals: u.decimals, isActive: true },
        });
    }
    const defaultUnit = await prisma.invUnit.findUnique({ where: { code: "UNIT" } });
    console.log(`      ✓ ${INV_UNITS.length} inventory units seeded\n`);

    // ── Section 10: Inventory Warranty Term master ─────────────────────
    // Universal across trades (every business sells things with some warranty
    // window), so it lives in bootstrap — unlike brands / categories / product
    // groups, which are trade-specific and live in helper-inventory-masters.ts.
    // Duration is in days (0 = no fixed duration). InvWarrantyTerm.name is NOT
    // unique in the schema, so we idempotently match on name.
    console.log("[10/11] Inventory Warranty Term master");
    const WARRANTY_TERMS = [
        { name: "No Warranty",        durationDays: 0,    description: "Sold as-is — no warranty coverage." },
        { name: "7-Day Replacement",  durationDays: 7,    description: "DOA / dead-on-arrival replacement window." },
        { name: "15-Day Replacement", durationDays: 15,   description: "Short replacement window." },
        { name: "1 Month",            durationDays: 30,   description: "30-day warranty." },
        { name: "3 Months",           durationDays: 90,   description: "90-day warranty." },
        { name: "6 Months",           durationDays: 180,  description: "6-month warranty." },
        { name: "1 Year",             durationDays: 365,  description: "12-month manufacturer / seller warranty." },
        { name: "2 Years",            durationDays: 730,  description: "24-month warranty." },
        { name: "3 Years",            durationDays: 1095, description: "36-month warranty." },
        { name: "5 Years",            durationDays: 1825, description: "60-month warranty." },
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
        defaultGstRateId:            gst18?.id       ?? null,
        defaultUnitId:               defaultUnit?.id ?? null,
        defaultTaxability:           "TAXABLE"       as const,
        defaultCurrencySymbol:       "₹",
        // Credit restricted by default — admin can raise in Settings → Org Defaults.
        defaultSaleCreditPeriod:     0,
        defaultPurchaseCreditPeriod: 0,
    };
    // Default barcode price bands (Update & Print Labels). Create-only so admin
    // edits via Settings → Org Defaults survive a reseed (left out of `update`).
    const DEFAULT_BARCODE_BANDS = [
        { max: 50,    add: 10,  hint: 1 },
        { max: 100,   add: 20,  hint: 2 },
        { max: 300,   add: 30,  hint: 3 },
        { max: 500,   add: 50,  hint: 5 },
        { max: 2000,  add: 100, hint: 6 },
        { max: 5000,  add: 150, hint: 7 },
        { max: 10000, add: 200, hint: 8 },
        { max: 99999, add: 500, hint: 9 },
    ];
    // Default cash denominations (POS shift-close counter), high → low. Indian
    // notes + coins. Create-only so admin edits via Settings survive a reseed.
    const DEFAULT_CASH_DENOMINATIONS = [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1];
    await prisma.orgDefaults.upsert({
        where:  { id: 1 },
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
        where:  { id: 1 },
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
        where:  { id: 1 },
        create: { id: 1, maxTotalDiscountPct: null, couponExpenseAccountId: couponExpenseLedger?.id ?? null, giftCardLiabilityAccountId: giftCardLiabilityLedger?.id ?? null, giftCardBreakageAccountId: giftCardBreakageLedger?.id ?? null },
        update: { couponExpenseAccountId: couponExpenseLedger?.id ?? null, giftCardLiabilityAccountId: giftCardLiabilityLedger?.id ?? null, giftCardBreakageAccountId: giftCardBreakageLedger?.id ?? null },
    });
    console.log(`      ✓ CouponConfig singleton seeded (coupon ledger #${couponExpenseLedger?.id ?? "—"}, gift-card liability #${giftCardLiabilityLedger?.id ?? "—"}, breakage #${giftCardBreakageLedger?.id ?? "—"})\n`);

    // ── CreditLimitConfig singleton (id=1) ─────────────────────────────
    // Global auto credit-limit calculator. Create-only so admin edits (from
    // Settings → Credit Limit) survive a reseed. Defaults are auto OFF, so
    // behaviour stays deny-by-default (manual limits only) until switched on.
    await prisma.creditLimitConfig.upsert({
        where:  { id: 1 },
        create: { id: 1, autoEnabled: false, windowDays: 90, pctOfSales: 10, roundToStep: 0 },
        update: {},
    });
    console.log(`      ✓ CreditLimitConfig singleton seeded (auto OFF; 10% of last-90-day sales when enabled)\n`);

    // Spend-tier periods + their levels — admin-owned (rename / add / remove / toggle /
    // retune amounts). A period is a title customers compete for over a bracket of the
    // past; each carries its own copy of the ladder, so a customer can hold a title in
    // several periods at once and the percentages add up.
    //
    // FRESH DEPLOYMENTS ONLY. If anything is configured already, this leaves it
    // completely alone — no adopting, no re-pointing, no amount edits. An install that
    // predates periods is migrated once, deliberately, by:
    //     pnpm tsx prisma/seeds/migrate-tier-periods.ts
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
                        { name: "Bronze",   minSpend: 0,      discountPct: 0, sortOrder: 0 },
                        { name: "Silver",   minSpend: 10000,  discountPct: 2, sortOrder: 1 },
                        { name: "Gold",     minSpend: 50000,  discountPct: 5, sortOrder: 2 },
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
            where:  { kind },
            create: data,
            update: { defaultPaper: data.defaultPaper },
        });
    }
    console.log(`      ✓ ${VOUCHER_TEMPLATE_KINDS.length} voucher print templates seeded\n`);

    // ── Section 14: Organisation singleton ────────────────────────────
    console.log("[14/16] Organisation (your own business / legal entity)");
    // Create-only on re-seed (mirrors VoucherSeries / VoucherPrintTemplate
    // pattern) so admin edits via /office/settings/organisation survive a
    // re-run of `pnpm prisma db seed`. Initial values come from
    // src/utils/constants-company-details.ts.
    const orgGstin = COMPANY_DETAILS.tax.gstin ?? "";
    await prisma.organisation.upsert({
        where:  { id: 1 },
        create: {
            id:          1,
            brandName:   COMPANY_DETAILS.brandName,
            legalName:   COMPANY_DETAILS.legalName,
            gstin:       orgGstin,
            gstStateCode: orgGstin.length >= 2 ? orgGstin.slice(0, 2) : "",
            identityJson: {
                tagline: COMPANY_DETAILS.tagline,
                logoUrl: "",
                pan:     COMPANY_DETAILS.tax.pan,
            },
            addressJson: {
                addressLine1: COMPANY_DETAILS.address.line1,
                addressLine2: COMPANY_DETAILS.address.line2 ?? "",
                city:         COMPANY_DETAILS.address.city,
                state:        COMPANY_DETAILS.address.state,
                pinCode:      COMPANY_DETAILS.address.pin,
                country:      COMPANY_DETAILS.address.country,
            },
            contactJson: {
                email:        COMPANY_DETAILS.contact.email,
                supportEmail: COMPANY_DETAILS.contact.supportEmail,
                phone:        COMPANY_DETAILS.contact.phone,
                whatsapp:     COMPANY_DETAILS.contact.whatsapp,
                siteUrl:      COMPANY_DETAILS.siteUrl,
                hours:        COMPANY_DETAILS.hours,
            },
        },
        update: {},
    });
    console.log(`      ✓ Organisation singleton seeded (id=1)\n`);

    // ── Section 15: GSTIN ↔ gstStateCode integrity fixup ─────────────────
    console.log("[15/16] GSTIN ↔ state-code integrity fixup");
    // Idempotent: for every Branch / Person / Company / Organisation row
    // with a non-empty GSTIN, force gstStateCode = gstin[:2]. Safe to re-run.
    // (Doesn't touch the human-readable `state` text — admins clean those
    // via the UI, which now rejects mismatches.)
    const gstinFixupSql = `gstStateCode" = LEFT("gstin", 2) WHERE "gstin" IS NOT NULL AND "gstin" <> '' AND ("gstStateCode" IS DISTINCT FROM LEFT("gstin", 2))`;
    const branchFix     = await pool.query(`UPDATE "Branch"       SET "${gstinFixupSql}`);
    const personFix     = await pool.query(`UPDATE "Person"       SET "${gstinFixupSql}`);
    const companyFix    = await pool.query(`UPDATE "Company"      SET "${gstinFixupSql}`);
    const orgFix        = await pool.query(`UPDATE "Organisation" SET "${gstinFixupSql}`);
    const fixedTotal = (branchFix.rowCount ?? 0) + (personFix.rowCount ?? 0)
                     + (companyFix.rowCount ?? 0) + (orgFix.rowCount ?? 0);
    console.log(`      ✓ Re-aligned gstStateCode on ${fixedTotal} row(s) where it disagreed with GSTIN\n`);

    // ── Section 16: Strategy points (the additive-margin pricing engine) ──────
    // The single org-wide additive-margin config. A product's margin% = the SUM
    // of the points for the dimensions it falls under (base + brand + category +
    // group). Seed BASE = 25 so a fresh DB keeps the org-default +25% markup that
    // the old (dropped) "Default ORG markup" PricingStrategy provided. Brand /
    // category / group / band points are added by the user in
    // /office/pricing-strategy/strategies. A missing row = 0 pts.
    // create-only so an admin's edited base survives a reseed.
    console.log("[16/16] Strategy points default (BASE = 25)");
    await prisma.strategyPoint.upsert({
        where:  { dimension_refKey: { dimension: "BASE", refKey: "" } },
        update: {},
        create: { dimension: "BASE", refKey: "", points: 25 },
    });
    console.log("      ✓ StrategyPoint BASE row present\n");

    console.log("━━━ Bootstrap complete ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("    Log in at /staff/login as admin@networkservice.in / admin123");
    console.log("    Run `pnpm seed:dummy-all` to populate demo data, or skip for a clean prod start.\n");
}

main()
    .catch((err) => { console.error(err); process.exit(1); })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
