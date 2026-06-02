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
//   • RBAC: 7 Roles, 80+ Permissions, RolePermission grants
//   • Workflow: 6 Pipelines, 49 TicketStatuses, 7 SubStatusGroups, 38
//     SubStatuses, status + sub-status transitions
//   • Org structure: 2 Branches (HQ + Online), 7 Departments, Role ranks
//   • Chart of accounts: 28 AccountGroups (Tally tree) + ~50 GL ledgers
//     **Stock-in-Hand group is intentionally empty** — closing-stock value is
//     derived live by `getClosingStockValue` and injected as a synthetic
//     ledger at report time (`balance-sheet/route.ts`). DO NOT seed real
//     accounts here — they would double-count with the synthetic.
//   • Admin user: admin@networkservice.in / admin123 (bcrypt-hashed)
//   • DB constraints: Phone/Email XOR ownership CHECK
//   • Inventory Unit master: 13 common units (PCS, NOS, BOX, SET, MTR, ROLL,
//     PKT, PAIR, KG, BAG, UNIT, REAM, DAY)
//   • Inventory Brand master: ~60 brands (computers, CCTV, networking, etc.)
//
// What this does NOT seed (run dummy-* seeds for those):
//   • Test users (tech, front, des) → dummy-users.ts
//   • Demo products + InvCategory/etc → dummy-shop.ts
//   • InvAttributeMaster — seeded by dummy-shop.ts (global attrs + category-specific).
//     Production users populate attribute masters via Configure → Attribute masters.
//   • Test customers + companies → dummy-customers.ts
//   • Sample vouchers → dummy-vouchers.ts
//   • Opening balances on accounts/products → set via UI

import { PrismaClient } from "../../src/generated/prisma/client";
import { seedVoucherSeries } from "../../src/modules/accountancy/lib/seedVoucherSeries";
import {
    VOUCHER_TEMPLATE_KINDS,
    buildVoucherTemplateDefaults,
} from "../../src/shared/lib/print/voucherTemplateDefaults";
import { COMPANY_DETAILS } from "../../src/utils/constants-company-details";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");

const pool = new Pool({ connectionString: rawUrl, ssl: { rejectUnauthorized: false }, max: 5 });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ════════════════════════════════════════════════════════════════════════════
// SECTION 1 — RBAC: Roles, Permissions, Role grants
// ════════════════════════════════════════════════════════════════════════════

// Roles are the *templates* that Positions inherit permissions from. Users do NOT
// receive a role directly — `User.role` is null until a Position appointment
// promotes them. See `Position.roleTemplateId` and `authorizeStaff.ts`.
const ROLES = [
    { id: "R1", label: "Role-Admin",            color: "bg-red-100 text-red-600",       isSystem: true, rank: 100 },
    { id: "R5", label: "Role-Branch Manager",   color: "bg-amber-100 text-amber-700",   isSystem: true, rank: 80  },
    { id: "R2", label: "Role-Service Engineer", color: "bg-blue-100 text-blue-600",     isSystem: true, rank: 70  },
    { id: "R6", label: "Role-Accountant",       color: "bg-indigo-100 text-indigo-700", isSystem: true, rank: 60  },
    { id: "R7", label: "Role-Sales Executive",  color: "bg-teal-100 text-teal-700",     isSystem: true, rank: 50  },
    { id: "R3", label: "Role-Counter / Cashier",color: "bg-green-100 text-green-600",   isSystem: true, rank: 30  },
    { id: "R4", label: "Role-Stores & Despatch",color: "bg-purple-100 text-purple-600", isSystem: true, rank: 30  },
] as const;

const PERMISSIONS = [
    // ── System-only sentinel — NOT auto-assigned to any role (see R1 grant below).
    // Only the env-based super admin (SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD in
    // .env) can ever hold it at runtime. It lives in the Permission table so FK
    // lookups don't break, but the `systemOnly` flag keeps it out of role grants
    // and off the Role Matrix UI.
    { id: "admin:bypass", label: "Bypass all permission checks", module: "core", description: "Grants full access. Only usable by the env super admin — never grant this to a role.", systemOnly: true },

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
    { id: "customers:hard-delete", label: "Hard-delete converted customers", module: "customers", description: "Permanently remove soft-deleted (converted) Person / Company tombstone rows from the Trash view at /office/settings/customer-tools." },

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
    { id: "settings:manage", label: "Manage org settings", module: "admin", description: "Manage branches, departments, and positions." },
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
    { id: "inventory:manage", label: "Manage inventory masters", module: "admin", description: "Maintain units, categories, brands, warranty terms, and inventory product masters. Also gates pricing-strategy CRUD." },

    // crm
    { id: "crm:view", label: "View CRM leads", module: "crm", description: "View the CRM leads list and lead details." },
    { id: "crm:manage", label: "Manage CRM leads", module: "crm", description: "Create, edit, delete, and reassign CRM leads." },

    // finance — three-tier lifecycle on journal entries
    { id: "finance:journal:cancel", label: "Cancel journal entries", module: "finance", description: "Mark a POSTED journal entry as CANCELLED. The original keeps its reference number and stays visible in lists; a reversing entry is written for the audit trail." },
    { id: "finance:journal:delete", label: "Delete journal entries", module: "finance", description: "Soft-delete: hide a journal entry from normal views and exclude it from balance calculations. Recoverable via restore." },
    { id: "finance:journal:hard-delete", label: "Hard-delete journal entries", module: "finance", description: "Physically remove a journal entry. A snapshot is written to the audit log so the deletion itself is traceable. Use for cleanup only." },

    // finance — three-tier lifecycle on invoices
    { id: "finance:invoice:cancel", label: "Cancel invoices", module: "finance", description: "Reverse posted invoice JE and mark VOID. Reference number preserved." },
    { id: "finance:invoice:delete", label: "Delete invoices", module: "finance", description: "Soft-delete invoice; reverses GL impact if posted. Recoverable via restore." },
    { id: "finance:invoice:hard-delete", label: "Hard-delete invoices", module: "finance", description: "Physically remove an invoice. A snapshot is written to the audit log." },

    // finance — three-tier lifecycle on payments
    { id: "finance:payment:cancel", label: "Cancel payments", module: "finance", description: "Reverse a posted payment and mark CANCELLED." },
    { id: "finance:payment:delete", label: "Delete payments", module: "finance", description: "Soft-delete a payment; reverses GL impact. Recoverable via restore." },
    { id: "finance:payment:hard-delete", label: "Hard-delete payments", module: "finance", description: "Physically remove a payment. A snapshot is written to the audit log." },

    // finance — generic Tally accounting vouchers
    { id: "finance:voucher:create",      label: "Create vouchers",      module: "finance", description: "Create Contra / Payment / Receipt / Credit Note / Debit Note vouchers." },
    { id: "finance:voucher:post",        label: "Post vouchers",        module: "finance", description: "Move a draft voucher to POSTED — applies GL impact." },
    { id: "finance:voucher:cancel",      label: "Cancel vouchers",      module: "finance", description: "Reverse a posted voucher and mark CANCELLED." },
    { id: "finance:voucher:delete",      label: "Delete vouchers",      module: "finance", description: "Soft-delete a voucher; reverses GL impact. Recoverable." },
    { id: "finance:voucher:hard-delete", label: "Hard-delete vouchers", module: "finance", description: "Physically remove a voucher with audit snapshot." },

    // finance — bill-wise allocation
    { id: "finance:allocation:manage", label: "Manage bill-wise allocations", module: "finance", description: "Link / unlink any voucher to any other voucher (full or partial), drives outstandings + aging." },

    // finance — opening balance
    { id: "finance:opening-balance:manage", label: "Manage opening balances", module: "finance", description: "Edit per-account opening balance and opening stock at the books-beginning date." },

    // inventory — branch-scoped view/edit + three-tier lifecycle on stock vouchers
    { id: "inventory:view:branch", label: "View inventory (own branch)",   module: "inventory", description: "View vouchers, stock, and reports for the user's assigned branches." },
    { id: "inventory:edit:branch", label: "Edit inventory (own branch)",   module: "inventory", description: "Create and post vouchers within the user's assigned branches." },
    { id: "inventory:view:org",    label: "View inventory (all branches)", module: "inventory", description: "View inventory data across all branches." },
    { id: "inventory:edit:org",    label: "Edit inventory (all branches)", module: "inventory", description: "Create and post vouchers for any branch." },
    { id: "inventory:voucher:cancel",      label: "Cancel inventory vouchers",      module: "inventory", description: "Reverse stock + GL impact and mark CANCELLED." },
    { id: "inventory:voucher:delete",      label: "Delete inventory vouchers",      module: "inventory", description: "Soft-delete; reverses stock + GL impact. Recoverable via restore." },
    { id: "inventory:voucher:hard-delete", label: "Hard-delete inventory vouchers", module: "inventory", description: "Physically remove with audit snapshot." },

    // pos — shift / till / handover lifecycle
    { id: "pos:shift:open",        label: "Open POS shift",                 module: "pos", description: "Open your own till session with an opening cash float." },
    { id: "pos:shift:close",       label: "Close POS shift",                module: "pos", description: "Declare physical cash count and hand over to manager (posts Contra)." },
    { id: "pos:shift:drop",        label: "Record mid-shift cash drop",     module: "pos", description: "Log cash dropped into the safe during an open shift." },
    { id: "pos:shift:view:branch", label: "View POS shifts (own branch)",   module: "pos", description: "View shift report for the user's assigned branches." },
    { id: "pos:shift:view:org",    label: "View POS shifts (all branches)", module: "pos", description: "View shift report across all branches." },
    { id: "pos:shift:manage",      label: "Manage POS shifts",              module: "pos", description: "Force-close stuck shifts, edit drops, override variance." },

    // accountancy — module-level CRUD gate (Owner / CA only)
    { id: "accountancy:create:own",  label: "Create accountancy entries (own)",   module: "accountancy", description: "Create vouchers / invoices / journal entries within own scope." },
    { id: "accountancy:view:own",    label: "View accountancy (own)",             module: "accountancy", description: "View accountancy data scoped to own records." },
    { id: "accountancy:view:br",     label: "View accountancy (branch)",          module: "accountancy", description: "View accountancy data across the user's branch." },
    { id: "accountancy:view:org",    label: "View accountancy (organisation)",    module: "accountancy", description: "View the full accountancy module across the organisation. This is the gate that shows / hides the Accountancy sidebar section." },
    { id: "accountancy:edit:own",    label: "Edit accountancy (own)",             module: "accountancy", description: "Edit accountancy entries within own scope." },
    { id: "accountancy:edit:br",     label: "Edit accountancy (branch)",          module: "accountancy", description: "Edit accountancy entries across the user's branch." },
    { id: "accountancy:edit:org",    label: "Edit accountancy (organisation)",    module: "accountancy", description: "Edit any accountancy entry organisation-wide." },
    { id: "accountancy:delete:own",  label: "Delete accountancy (own)",           module: "accountancy", description: "Delete own accountancy entries (subject to per-operation guards)." },
    { id: "accountancy:delete:br",   label: "Delete accountancy (branch)",        module: "accountancy", description: "Delete branch-scoped accountancy entries." },
    { id: "accountancy:delete:org",  label: "Delete accountancy (organisation)",  module: "accountancy", description: "Delete any accountancy entry organisation-wide." },

    // loyalty — earn/redeem wallet config + manual adjustments
    { id: "loyalty:manage", label: "Manage loyalty", module: "loyalty", description: "Edit loyalty earn/redeem rates and earn rules, and post manual point adjustments." },

    // coupons — promotions + gift-card management
    { id: "coupons:manage", label: "Manage coupons", module: "coupons", description: "Create and manage coupons, promotions, and gift cards." },
] as const;

const ROLE_PERMISSIONS: Record<string, string[]> = {
    // R1 — Owner / Admin: every permission except system-only sentinels.
    R1: (PERMISSIONS as readonly { id: string; systemOnly?: boolean }[])
        .filter((p) => !p.systemOnly)
        .map((p) => p.id),

    // R5 — Branch Manager: full branch authority; no global settings/roles.
    R5: [
        "customers:view", "customers:view:org",
        "customers:create", "customers:edit:branch", "customers:edit:org", "customers:delete:branch",
        "companies:manage", "companies:create", "companies:edit:org",
        "tickets:create", "tickets:status:set", "tickets:substatus:set",
        "tickets:assign", "tickets:manage-participants", "warranty:convert",
        "tickets:view:org", "tickets:edit:org", "tickets:delete:branch",
        "assignments:view-org", "assignments:view:org",
        "service-centers:view", "service-centers:view:org",
        "finance:voucher:create", "finance:voucher:post", "finance:voucher:cancel", "finance:voucher:delete",
        "finance:invoice:cancel", "finance:invoice:delete",
        "finance:payment:cancel", "finance:payment:delete",
        "finance:allocation:manage",
        "inventory:manage",
        "inventory:view:org", "inventory:edit:branch",
        "inventory:voucher:cancel", "inventory:voucher:delete",
        "pos:shift:open", "pos:shift:close", "pos:shift:drop",
        "pos:shift:view:org", "pos:shift:manage",
        "accountancy:create:own", "accountancy:view:br", "accountancy:view:org", "accountancy:edit:br",
        "crm:view", "crm:manage",
    ],

    // R2 — Service Engineer: repair & diagnostics workflow.
    R2: [
        "customers:view",
        "tickets:create", "tickets:status:set", "tickets:substatus:set",
        "tickets:assign", "tickets:manage-participants", "warranty:convert",
        "tickets:view:own", "tickets:view:branch",
        "assignments:view-team", "assignments:view:own",
        "service-centers:view", "service-centers:view:branch",
    ],

    // R6 — Accountant: books, GST, vouchers, reconciliation. No admin/POS/tickets.
    R6: [
        "customers:view", "customers:view:org",
        "companies:manage", "companies:create", "companies:edit:org",
        "finance:journal:cancel", "finance:journal:delete",
        "finance:invoice:cancel", "finance:invoice:delete",
        "finance:payment:cancel", "finance:payment:delete",
        "finance:voucher:create", "finance:voucher:post", "finance:voucher:cancel", "finance:voucher:delete",
        "finance:allocation:manage",
        "finance:opening-balance:manage",
        "inventory:view:org",
        "pos:shift:view:org",
        "accountancy:create:own",
        "accountancy:view:own", "accountancy:view:br", "accountancy:view:org",
        "accountancy:edit:own", "accountancy:edit:br", "accountancy:edit:org",
        "accountancy:delete:own", "accountancy:delete:br",
    ],

    // R7 — Sales Executive: CRM, customer acquisition, ecommerce, counter sales.
    R7: [
        "customers:view", "customers:view:org",
        "customers:create", "customers:edit:own", "customers:edit:branch", "customers:delete:own",
        "companies:manage", "companies:create", "companies:edit:org",
        "tickets:create", "tickets:status:set", "tickets:substatus:set", "tickets:assign",
        "tickets:view:own", "tickets:view:branch",
        "assignments:view-team", "assignments:view:own",
        "crm:view", "crm:manage",
        "ecommerce:manage",
        "inventory:view:branch",
        "pos:shift:open", "pos:shift:close", "pos:shift:drop", "pos:shift:view:branch",
    ],

    // R3 — Counter / Cashier: POS, customer intake, ticket triage, branch inventory.
    R3: [
        "customers:view", "customers:manage", "companies:manage",
        "tickets:create", "tickets:status:set", "tickets:substatus:set", "tickets:assign",
        "assignments:view-team",
        "crm:view", "crm:manage",
        "inventory:view:branch", "inventory:edit:branch",
        "pos:shift:open", "pos:shift:close", "pos:shift:drop", "pos:shift:view:branch",
    ],

    // R4 — Stores & Despatch: stock vouchers, goods in/out, repair item handoff.
    R4: [
        "customers:view",
        "tickets:substatus:set", "tickets:assign",
        "assignments:view-team",
        "inventory:view:branch", "inventory:edit:branch",
        "pos:shift:open", "pos:shift:close", "pos:shift:drop",
    ],
};

// ════════════════════════════════════════════════════════════════════════════
// SECTION 2 — Workflow: Pipelines + Statuses + Transitions
// ════════════════════════════════════════════════════════════════════════════

type PipelineSeed = {
    id: string; name: string; label: string; description: string;
    color: string; order: number; isDefault?: boolean;
    statuses: Array<{
        id: string; label: string; color: string; order: number;
        isEntryPoint: boolean; isTerminal: boolean; pipelineId: string;
        actionLabel?: string;
    }>;
};

const PIPELINES: PipelineSeed[] = [
    {
        id: "P1", name: "service", label: "Service & Repair",
        description: "Electronics repair and service workflow",
        color: "bg-blue-100 text-blue-600", order: 0, isDefault: true,
        statuses: [
            { id: "S1", label: "Received", color: "bg-gray-100 text-gray-600", order: 1, isEntryPoint: true,  isTerminal: false, pipelineId: "P1" },
            { id: "S2", label: "Diagnosing", color: "bg-yellow-100 text-yellow-700", order: 2, isEntryPoint: false, isTerminal: false, pipelineId: "P1" },
            { id: "S3", label: "Repairing", color: "bg-blue-100 text-blue-700", order: 3, isEntryPoint: false, isTerminal: false, pipelineId: "P1" },
            { id: "S4", label: "Escalated", color: "bg-orange-100 text-orange-700", order: 4, isEntryPoint: false, isTerminal: false, pipelineId: "P1" },
            { id: "S5", label: "Received Back", color: "bg-purple-100 text-purple-700", order: 5, isEntryPoint: false, isTerminal: false, pipelineId: "P1" },
            { id: "S6", label: "Ready", color: "bg-green-100 text-green-700", order: 6, isEntryPoint: false, isTerminal: false, pipelineId: "P1" },
            { id: "S7", label: "Returned", color: "bg-gray-200 text-gray-500", order: 7, isEntryPoint: false, isTerminal: true,  pipelineId: "P1" },
            { id: "S8", label: "Closed - No Fix", color: "bg-red-100 text-red-600", order: 8, isEntryPoint: false, isTerminal: true,  pipelineId: "P1" },
            { id: "S9", label: "Cancelled", color: "bg-gray-100 text-gray-400", order: 9, isEntryPoint: false, isTerminal: true,  pipelineId: "P1" },
        ],
    },
    {
        id: "P2", name: "customer-support", label: "Customer Support",
        description: "General customer support tickets not related to repairs",
        color: "bg-teal-100 text-teal-700", order: 2,
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
        color: "bg-green-100 text-green-700", order: 3,
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
        color: "bg-purple-100 text-purple-700", order: 4,
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
        color: "bg-pink-100 text-pink-700", order: 5,
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
        color: "bg-amber-100 text-amber-800", order: 7,
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
        id: "P6", name: "crm-leads", label: "CRM Leads",
        description: "Sales-style leads without repair tickets; stages shared with pipeline settings",
        color: "bg-cyan-100 text-cyan-800", order: 6,
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

const SUB_STATUS_GROUPS = [
    { id: "customer_comm", label: "Call",    order: 1 },
    { id: "approval",      label: "Quote",   order: 2 },
    { id: "parts",         label: "Parts",   order: 3 },
    { id: "qc",            label: "QC",      order: 4 },
    { id: "escalated",     label: "Escalated", order: 5 },
    { id: "ready",         label: "Ready",   order: 6 },
    { id: "no_fix",        label: "No Fix",  order: 7 },
] as const;

type SubStatusSeed = {
    id: string; label: string; order: number; color: string;
    groupId: string; group: string; applicableStatusIds: string[];
    allowedRoles: string[]; notifyRoles: string[]; pipelineId: string;
    triggerMap?: Record<string, string>;
    warrantyScope?: string; actionLabel?: string;
};

const SUB_STATUSES: SubStatusSeed[] = [
    { id: "SS1",  label: "Waiting: Customer Info", order: 1, color: "bg-yellow-50 text-yellow-700", groupId: "customer_comm", group: "customer_comm", applicableStatusIds: ["S2","S3","S6"], allowedRoles: ["R1","R2"], notifyRoles: ["R3"], pipelineId: "P1" },
    { id: "SS2",  label: "Waiting: Customer to Bring Item", order: 2, color: "bg-yellow-50 text-yellow-700", groupId: "customer_comm", group: "customer_comm", applicableStatusIds: ["S2","S3"], allowedRoles: ["R1","R2"], notifyRoles: ["R3"], pipelineId: "P1" },
    { id: "SS3",  label: "Customer Unreachable", order: 3, color: "bg-red-50 text-red-600", groupId: "customer_comm", group: "customer_comm", applicableStatusIds: ["S2","S3","S6"], allowedRoles: ["R1","R3"], notifyRoles: ["R1"], pipelineId: "P1" },
    { id: "SS4",  label: "Customer Responded", order: 4, color: "bg-green-50 text-green-700", groupId: "customer_comm", group: "customer_comm", applicableStatusIds: ["S2","S3","S6"], allowedRoles: ["R1","R3"], notifyRoles: ["R2"], pipelineId: "P1" },
    { id: "SS5",  label: "Quote Prepared", order: 5, color: "bg-blue-50 text-blue-600", groupId: "approval", group: "approval", applicableStatusIds: ["S2"], allowedRoles: ["R1","R2"], notifyRoles: ["R3"], pipelineId: "P1" },
    { id: "SS6",  label: "Awaiting Customer Approval", order: 6, color: "bg-yellow-50 text-yellow-700", groupId: "approval", group: "approval", applicableStatusIds: ["S2"], allowedRoles: ["R1","R3"], notifyRoles: [], pipelineId: "P1" },
    { id: "SS7",  label: "Awaiting Insurance / Warranty", order: 7, color: "bg-purple-50 text-purple-600", groupId: "approval", group: "approval", applicableStatusIds: ["S2"], allowedRoles: ["R1","R3"], notifyRoles: ["R1"], pipelineId: "P1" },
    { id: "SS8",  label: "Customer Approved", order: 8, color: "bg-green-50 text-green-700", groupId: "approval", group: "approval", applicableStatusIds: ["S2"], allowedRoles: ["R1","R3"], notifyRoles: ["R2"], pipelineId: "P1", triggerMap: { S2: "S3" } },
    { id: "SS9",  label: "Customer Declined", order: 9, color: "bg-red-50 text-red-600", groupId: "approval", group: "approval", applicableStatusIds: ["S2"], allowedRoles: ["R1","R3"], notifyRoles: ["R2"], pipelineId: "P1", triggerMap: { S2: "S8" } },
    { id: "SS10", label: "Awaiting Parts", order: 10, color: "bg-orange-50 text-orange-600", groupId: "parts", group: "parts", applicableStatusIds: ["S3"], allowedRoles: ["R1","R2"], notifyRoles: ["R1"], pipelineId: "P1" },
    { id: "SS11", label: "Parts Delayed", order: 11, color: "bg-orange-50 text-orange-600", groupId: "parts", group: "parts", applicableStatusIds: ["S3"], allowedRoles: ["R1"], notifyRoles: ["R2","R3"], pipelineId: "P1" },
    { id: "SS12", label: "Parts Issue", order: 12, color: "bg-red-50 text-red-600", groupId: "parts", group: "parts", applicableStatusIds: ["S3"], allowedRoles: ["R1"], notifyRoles: ["R2","R3"], pipelineId: "P1" },
    { id: "SS13", label: "Parts Arrived", order: 13, color: "bg-green-50 text-green-700", groupId: "parts", group: "parts", applicableStatusIds: ["S3"], allowedRoles: ["R1"], notifyRoles: ["R2"], pipelineId: "P1" },
    { id: "SS14", label: "QC In Progress", order: 14, color: "bg-blue-50 text-blue-600", groupId: "qc", group: "qc", applicableStatusIds: ["S3"], allowedRoles: ["R1","R2"], notifyRoles: [], pipelineId: "P1" },
    { id: "SS15", label: "QC Passed", order: 15, color: "bg-green-50 text-green-700", groupId: "qc", group: "qc", applicableStatusIds: ["S3"], allowedRoles: ["R1","R2"], notifyRoles: ["R3"], pipelineId: "P1", triggerMap: { S3: "S6" } },
    { id: "SS16", label: "QC Failed", order: 16, color: "bg-red-50 text-red-600", groupId: "qc", group: "qc", applicableStatusIds: ["S3"], allowedRoles: ["R1","R2"], notifyRoles: [], pipelineId: "P1" },
    { id: "SS17", label: "Partial Fix", order: 17, color: "bg-yellow-50 text-yellow-700", groupId: "qc", group: "qc", applicableStatusIds: ["S3"], allowedRoles: ["R1","R2"], notifyRoles: ["R3"], pipelineId: "P1" },
    { id: "SS18", label: "Engineer Visit Requested", order: 18, color: "bg-orange-50 text-orange-600", groupId: "escalated", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1","R2"], notifyRoles: ["R1"], pipelineId: "P1" },
    { id: "SS19", label: "Engineer Visit Scheduled", order: 19, color: "bg-blue-50 text-blue-600", groupId: "escalated", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1"], notifyRoles: ["R2"], pipelineId: "P1" },
    { id: "SS20", label: "Engineer On-Site", order: 20, color: "bg-blue-50 text-blue-600", groupId: "escalated", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1"], notifyRoles: ["R2"], pipelineId: "P1" },
    { id: "SS21", label: "Engineer Work Complete", order: 21, color: "bg-green-50 text-green-700", groupId: "escalated", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1","R2"], notifyRoles: ["R1"], pipelineId: "P1", triggerMap: { S4: "S3" } },
    { id: "SS22", label: "Pending Despatch", order: 22, color: "bg-orange-50 text-orange-700", groupId: "escalated", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1","R2"], notifyRoles: ["R4"], pipelineId: "P1" },
    { id: "SS23", label: "Dispatched", order: 23, color: "bg-blue-50 text-blue-600", groupId: "escalated", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1","R4"], notifyRoles: ["R1"], pipelineId: "P1" },
    { id: "SS24", label: "Received by Service Centre", order: 24, color: "bg-blue-50 text-blue-600", groupId: "escalated", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1","R4"], notifyRoles: [], pipelineId: "P1" },
    { id: "SS25", label: "Being Repaired", order: 25, color: "bg-blue-50 text-blue-600", groupId: "escalated", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1","R4"], notifyRoles: [], pipelineId: "P1" },
    { id: "SS26", label: "Service Centre Delayed", order: 26, color: "bg-red-50 text-red-600", groupId: "escalated", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1","R4"], notifyRoles: ["R1"], pipelineId: "P1" },
    { id: "SS27", label: "Shipped Back to Us", order: 27, color: "bg-purple-50 text-purple-600", groupId: "escalated", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1","R4"], notifyRoles: [], pipelineId: "P1" },
    { id: "SS28", label: "Received by Us", order: 28, color: "bg-green-50 text-green-700", groupId: "escalated", group: "escalated", applicableStatusIds: ["S4"], allowedRoles: ["R1","R4"], notifyRoles: ["R2"], pipelineId: "P1", triggerMap: { S4: "S5" } },
    { id: "SS29", label: "Customer Notified", order: 29, color: "bg-green-50 text-green-700", groupId: "ready", group: "ready", applicableStatusIds: ["S6"], allowedRoles: ["R1","R3"], notifyRoles: [], pipelineId: "P1" },
    { id: "SS30", label: "Reminder Sent", order: 30, color: "bg-yellow-50 text-yellow-700", groupId: "ready", group: "ready", applicableStatusIds: ["S6"], allowedRoles: ["R1","R3"], notifyRoles: [], pipelineId: "P1" },
    { id: "SS31", label: "Uncollected - Action Needed", order: 31, color: "bg-red-50 text-red-600", groupId: "ready", group: "ready", applicableStatusIds: ["S6"], allowedRoles: ["R1","R3"], notifyRoles: ["R1"], pipelineId: "P1" },
    { id: "SS32", label: "Beyond Economical Repair", order: 32, color: "bg-red-50 text-red-600", groupId: "no_fix", group: "no_fix", applicableStatusIds: ["S8"], allowedRoles: ["R1","R2"], notifyRoles: ["R3"], pipelineId: "P1" },
    { id: "SS33", label: "Customer Informed", order: 33, color: "bg-gray-50 text-gray-600", groupId: "no_fix", group: "no_fix", applicableStatusIds: ["S8"], allowedRoles: ["R1","R3"], notifyRoles: [], pipelineId: "P1" },
    { id: "SS34", label: "Collecting Unrepaired", order: 34, color: "bg-gray-50 text-gray-600", groupId: "no_fix", group: "no_fix", applicableStatusIds: ["S8"], allowedRoles: ["R1","R3"], notifyRoles: [], pipelineId: "P1", triggerMap: { S8: "S7" } },
    { id: "SS35", label: "Scrapped with Consent", order: 35, color: "bg-gray-50 text-gray-600", groupId: "no_fix", group: "no_fix", applicableStatusIds: ["S8"], allowedRoles: ["R1","R3"], notifyRoles: ["R1"], pipelineId: "P1" },
    { id: "SS36", label: "Warranty Voided - Customer Approval Needed", order: 36, color: "bg-red-100 text-red-600", groupId: "customer_comm", group: "customer_comm", applicableStatusIds: [], allowedRoles: [], notifyRoles: ["R3"], pipelineId: "P1", warrantyScope: "any", actionLabel: "Call customer - warranty void, confirm paid repair" },
    { id: "SS37", label: "Confirmed Under Warranty - Proceeding", order: 37, color: "bg-green-100 text-green-700", groupId: "customer_comm", group: "customer_comm", applicableStatusIds: [], allowedRoles: [], notifyRoles: ["R3"], pipelineId: "P1", warrantyScope: "any", actionLabel: "Inform customer - covered under warranty, no charge" },
];

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
    { fromStatusId: "S42", toStatusId: "S43" },
    { fromStatusId: "S42", toStatusId: "S48" },
    { fromStatusId: "S43", toStatusId: "S44" },
    { fromStatusId: "S43", toStatusId: "S48" },
    { fromStatusId: "S44", toStatusId: "S45" },
    { fromStatusId: "S44", toStatusId: "S48" },
    { fromStatusId: "S45", toStatusId: "S46" },
    { fromStatusId: "S46", toStatusId: "S47" },
    { fromStatusId: "S46", toStatusId: "S49" },
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

// ════════════════════════════════════════════════════════════════════════════
// SECTION 3 — Org structure: Branches + Departments
// ════════════════════════════════════════════════════════════════════════════

// Only the two branches needed for the typical setup. Add more via UI later.
// HQ inherits the organisation address from COMPANY_DETAILS — for a single-
// state business this lets you start with a printable invoice address on
// day one. The Online / Virtual branch carries no postal address by design.
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
    {
        id:    "BR-ONL",
        name:  "Online / Virtual",
        address:      null as string | null,
        phone:        null as string | null,
        addressLine1: "",
        addressLine2: "",
        city:         "",
        state:        "",
        pinCode:      "",
        country:      COMPANY_DETAILS.address.country,
        email:        null as string | null,
        // Online branch typically shares the HQ GSTIN — no separate registration.
        gstin:        HQ_GSTIN,
        gstStateCode: HQ_GSTIN.length >= 2 ? HQ_GSTIN.slice(0, 2) : "",
    },
];

const DEPARTMENTS = [
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
    for (const r of ROLES) {
        await prisma.role.upsert({
            where:  { id: r.id },
            update: { label: r.label, color: r.color, isSystem: r.isSystem, rank: r.rank },
            create: { id: r.id, label: r.label, color: r.color, isSystem: r.isSystem, rank: r.rank },
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
    console.log("[2/7] Workflow — Pipelines, Statuses, Sub-statuses, Transitions");
    for (const pl of PIPELINES) {
        await prisma.pipeline.upsert({
            where:  { id: pl.id },
            update: { name: pl.name, label: pl.label, description: pl.description, color: pl.color, isDefault: pl.isDefault ?? false, isActive: true, order: pl.order },
            create: { id: pl.id, name: pl.name, label: pl.label, description: pl.description, color: pl.color, isDefault: pl.isDefault ?? false, isActive: true, order: pl.order },
        });
        for (const s of pl.statuses) {
            await prisma.ticketStatus.upsert({
                where:  { id: s.id },
                update: { label: s.label, color: s.color, order: s.order, isTerminal: s.isTerminal, isEntryPoint: s.isEntryPoint, allowedRoles: [], notifyRoles: [], actionLabel: s.actionLabel ?? null, warrantyScope: "any", pipelineId: s.pipelineId },
                create: { id: s.id, label: s.label, color: s.color, order: s.order, isTerminal: s.isTerminal, isEntryPoint: s.isEntryPoint, allowedRoles: [], notifyRoles: [], actionLabel: s.actionLabel ?? null, warrantyScope: "any", pipelineId: s.pipelineId },
            });
        }
    }
    for (const g of SUB_STATUS_GROUPS) {
        await prisma.subStatusGroup.upsert({ where: { id: g.id }, update: { label: g.label, order: g.order }, create: g });
    }
    for (const ss of SUB_STATUSES) {
        await prisma.ticketSubStatus.upsert({
            where:  { id: ss.id },
            update: { label: ss.label, color: ss.color, group: ss.group, order: ss.order, applicableStatusIds: ss.applicableStatusIds, allowedRoles: ss.allowedRoles, notifyRoles: ss.notifyRoles, triggerMap: ss.triggerMap ?? {}, actionLabel: ss.actionLabel ?? null, autoRevertOnClear: true, handoffRole: null, warrantyScope: ss.warrantyScope ?? "any", groupId: ss.groupId, pipelineId: ss.pipelineId },
            create: { id: ss.id, label: ss.label, color: ss.color, group: ss.group, order: ss.order, applicableStatusIds: ss.applicableStatusIds, allowedRoles: ss.allowedRoles, notifyRoles: ss.notifyRoles, triggerMap: ss.triggerMap ?? {}, actionLabel: ss.actionLabel ?? null, autoRevertOnClear: true, handoffRole: null, warrantyScope: ss.warrantyScope ?? "any", groupId: ss.groupId, pipelineId: ss.pipelineId },
        });
    }
    for (const t of STATUS_TRANSITIONS) {
        await prisma.statusTransition.upsert({
            where:  { fromStatusId_toStatusId: { fromStatusId: t.fromStatusId, toStatusId: t.toStatusId } },
            update: {},
            create: t,
        });
    }
    for (const t of SUB_STATUS_TRANSITIONS) {
        const exists = await prisma.subStatusTransition.findFirst({
            where: { fromSubStatusId: t.fromSubStatusId, toSubStatusId: t.toSubStatusId },
            select: { id: true },
        });
        if (!exists) await prisma.subStatusTransition.create({ data: t });
    }
    console.log(`      ✓ ${PIPELINES.length} pipelines · ${PIPELINES.reduce((s, p) => s + p.statuses.length, 0)} statuses · ${SUB_STATUSES.length} sub-statuses\n`);

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
    for (const d of DEPARTMENTS) {
        await pool.query(
            `INSERT INTO "Department" (id, name, description, "branchId")
             VALUES ($1, $2, $3, NULL)
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description`,
            [d.id, d.name, d.description],
        );
    }
    console.log(`      ✓ ${BRANCHES.length} branches · ${DEPARTMENTS.length} departments\n`);

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

        // Upsert the PosCounter row.
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
    await prisma.position.upsert({
        where:  { id: "POS-SYSADMIN" },
        update: { title: "System Administrator", branchId: null, departmentId: null, roleTemplateId: "R1" },
        create: { id: "POS-SYSADMIN", title: "System Administrator", branchId: null, departmentId: null, roleTemplateId: "R1" },
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

    // ── Section 10: Inventory Brand master ─────────────────────────────
    console.log("[10/11] Inventory Brand master");
    const BRANDS = [
        // Computers & Laptops
        "Acer", "AMD", "Apple", "Asus", "Dell", "Gigabyte", "HP", "HCL",
        "Intel", "Lenovo", "LG", "MSI", "Samsung", "Sony",
        // Storage
        "Corsair", "Crucial", "Kingston", "SanDisk", "Seagate", "Toshiba",
        "Transcend", "WD",
        // Printers & Consumables
        "Brother", "Canon", "Epson", "Kyocera", "Lexmark", "Panasonic",
        "Ricoh", "TVS", "Xerox",
        // CCTV & Security
        "Annke", "Axis", "Bosch", "CP Plus", "Dahua", "Ezviz", "Godrej",
        "Hanwha", "Hikvision", "Honeywell", "Reolink", "Zicom",
        // Networking
        "Cisco", "D-Link", "Grandstream", "Netgear", "Tenda", "TP-Link", "Ubiquiti",
        // Peripherals & Accessories
        "APC", "Beetel", "Belkin", "Boat", "Hola", "iBall", "Intex",
        "Logitech", "Luminous", "Microtek", "Nvidia", "Stanley", "Zebronics",
    ];
    const uniqueBrands = [...new Set(BRANDS)];
    for (const name of uniqueBrands) {
        await prisma.invBrand.upsert({
            where:  { name },
            update: { isActive: true },
            create: { name, isActive: true },
        });
    }
    console.log(`      ✓ ${uniqueBrands.length} brands seeded\n`);

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

    // Spend-tier auto-discounts — admin-owned (rename / add / remove / toggle), so
    // only seed the starter set when the table is empty; never clobber admin edits.
    if ((await prisma.customerTier.count()) === 0) {
        await prisma.customerTier.createMany({
            data: [
                { name: "Bronze",   minSpend: 0,      discountPct: 0, sortOrder: 0 },
                { name: "Silver",   minSpend: 10000,  discountPct: 2, sortOrder: 1 },
                { name: "Gold",     minSpend: 50000,  discountPct: 5, sortOrder: 2 },
                { name: "Platinum", minSpend: 200000, discountPct: 8, sortOrder: 3 },
            ],
        });
        console.log(`      ✓ CustomerTier starter rows seeded (Bronze/Silver/Gold/Platinum)\n`);
    } else {
        console.log(`      • CustomerTier rows already present — left untouched\n`);
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
