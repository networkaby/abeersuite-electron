// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CODE-OWNED CATALOG — the seed data that belongs to the CODE, not to any
// client's configuration. Shared by BOTH seeds:
//
//   • bootstrap-seed.ts   (generic new-client installer) — imports the
//     permission list and seeds it alongside its generic demo world.
//   • personal-bootstrap.ts (self-complete restore of YOUR config) — calls
//     `applyCodeOwnedCatalog()` so a hard-reset DB gets everything the personal
//     snapshot deliberately does NOT carry, without touching generic content.
//
// The personal snapshot excludes exactly three code-owned things (see the
// audit note in docs/seeds.md):
//   1. The Permission catalog (definitions — grants live in the snapshot)
//   2. VoucherSeries + BooksConfig (voucher numbering; seedVoucherSeries)
//   3. The Phone/Email XOR CHECK constraints (raw DDL, not data)
// This module owns all three. Add new permissions HERE (single source), never
// inline in either seed.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { PrismaClient } from "../../../src/generated/prisma/client";
import type { Pool } from "pg";
import { voucherPermissionSeeds } from "../../../src/shared/lib/auth/voucherMatrix";
import { sidebarPermissionSeeds } from "../../../src/shared/lib/auth/sidebarModules";
import { posVoucherPermissionSeeds } from "../../../src/shared/lib/auth/posVoucherMatrix";
import { seedVoucherSeries } from "../../../src/modules/accountancy/lib/seedVoucherSeries";

export interface PermissionSeed {
    id: string;
    label: string;
    module: string;
    description: string;
    systemOnly?: boolean;
}

export const PERMISSION_CATALOG: PermissionSeed[] = [
    // ── System-only sentinel — NOT auto-assigned to any role (see the R1 grant in
    // bootstrap-seed.ts). Only the env-based super admin (SUPER_ADMIN_EMAIL /
    // SUPER_ADMIN_PASSWORD in .env) can ever hold it at runtime. It lives in the
    // Permission table so FK lookups don't break, but the `systemOnly` flag keeps
    // it out of role grants and off the Role Matrix UI.
    { id: "admin:bypass", label: "Bypass all permission checks", module: "core", description: "Grants full access. Only usable by the env super admin — never grant this to a role.", systemOnly: true },

    // customers — Contacts (Person + Company) share ONE flat set. Contacts carry no
    // branch, so there is no radius to enforce: any branch may CRUD (gated only by
    // holding the write id). The old own/department/branch/org ladder and the
    // customers:manage umbrella are retired.
    { id: "customers:create", label: "Create customers", module: "customers", description: "Create Person / Company records." },
    { id: "customers:edit", label: "Edit customers", module: "customers", description: "Edit any Person / Company record (no branch limit)." },
    { id: "customers:delete", label: "Delete customers", module: "customers", description: "Delete any Person / Company record (no branch limit)." },
    { id: "customers:view:creditors", label: "Show suppliers (creditors)", module: "customers", description: "See parties in the Sundry Creditors group in the Contacts lists. Absent → the role browses customers (Sundry Debtors) only. UI-only filter; the party-lookup path is never filtered." },

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

    // accountancy
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

    // repair — the ticket resource (All Repair list + ticket page). View rides the
    // repair sidebar link; these gate the create / edit / delete actions on a ticket.
    { id: "tickets:create", label: "Create tickets", module: "repair", description: "Open new repair tickets (the Repair + intake)." },
    { id: "tickets:edit", label: "Edit tickets", module: "repair", description: "Edit a repair ticket's device, problem, priority, cost and notes." },
    { id: "tickets:delete", label: "Delete tickets", module: "repair", description: "Delete a repair ticket." },
];

// ── XOR CHECK constraints (raw DDL — cannot live in the snapshot) ──────────
export async function ensureXorCheck(pool: Pool, table: "Phone" | "Email", constraintName: string) {
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

/**
 * Apply everything code-owned to the DB: permission catalog (upsert + prune of
 * retired ids, keeping Work/WorkGroup-referenced ones), the Phone/Email XOR
 * constraints, and the voucher numbering series. Idempotent; deletes ONLY
 * permissions that no longer exist in code. Used by personal-bootstrap so it
 * never needs the generic installer.
 */
export async function applyCodeOwnedCatalog(prisma: PrismaClient, pool: Pool): Promise<{ permissions: number; pruned: number }> {
    for (const p of PERMISSION_CATALOG) {
        await prisma.permission.upsert({
            where:  { id: p.id },
            update: { label: p.label, module: p.module, description: p.description },
            create: p,
        });
    }

    // Prune retired permission ids — same rule as the generic installer: keep
    // everything in the catalog plus any id referenced by a Work / WorkGroup.
    const keepIds = new Set(PERMISSION_CATALOG.map((p) => p.id));
    const workRefs = await prisma.$queryRaw<{ permissionId: string }[]>`
        SELECT "permissionId" FROM "Work"      WHERE "permissionId" IS NOT NULL
        UNION
        SELECT "permissionId" FROM "WorkGroup" WHERE "permissionId" IS NOT NULL`;
    for (const r of workRefs) keepIds.add(r.permissionId);
    const pruned = await prisma.permission.deleteMany({ where: { id: { notIn: [...keepIds] } } });

    await ensureXorCheck(pool, "Phone", "Phone_owner_xor");
    await ensureXorCheck(pool, "Email", "Email_owner_xor");

    await seedVoucherSeries(prisma);

    return { permissions: PERMISSION_CATALOG.length, pruned: pruned.count };
}
