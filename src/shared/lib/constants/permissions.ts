/**
 * Permission identifiers — single source of truth for the strings passed to
 * `requirePermission(id)`, `hasPermission(user, id)`, and `makePermissionLayout(id)`.
 *
 * The canonical list is seeded by `prisma/seeds/bootstrap-seed.ts`. Adding a new
 * permission means: (1) add it to the seed file, (2) add it here, (3) re-seed the
 * dev DB. The mapping is `area:operation[:scope]` → `AREA_OPERATION[_SCOPE]`.
 */
export const PERMISSIONS = {
    // ── Code-only sentinel — NOT in the DB seed, NOT grantable via the Role Matrix UI.
    // Only the env-based super admin (SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD) can
    // ever hold this. Never add "admin:bypass" to bootstrap-seed.ts.
    ADMIN_BYPASS:                       "admin:bypass",

    // Accountancy Masters — the chart of accounts (Account Groups, Ledgers, Chart
    // of Accounts), gated together. Read access rides the accountancy sidebar nav.
    ACCOUNTANCY_MASTERS_CREATE:         "accountancy:masters:create",
    ACCOUNTANCY_MASTERS_EDIT:           "accountancy:masters:edit",
    ACCOUNTANCY_MASTERS_DELETE:         "accountancy:masters:delete",

    // Customers (Contacts = Person + Company; share ONE flat set). Contacts carry
    // no branch, so there is no radius to enforce — any branch may CRUD (gated only
    // by holding the write id).
    CUSTOMERS_CREATE:                   "customers:create",
    CUSTOMERS_EDIT:                     "customers:edit",
    CUSTOMERS_DELETE:                   "customers:delete",
    // Show suppliers (Sundry Creditors) in the Contacts lists. Absent → a role
    // browses customers (Sundry Debtors) only; suppliers are filtered out of the
    // Person / Companies lists. UI-only filter — the party-lookup path (repair
    // service slips, vouchers) is never filtered.
    CUSTOMERS_VIEW_CREDITORS:           "customers:view:creditors",

    // Finance — per-kind GL voucher gates: finance:voucher:<action>:<kind>.
    // The trailing segment is the VoucherType (kebab-case), NOT a scope — a
    // deliberate exception to area:operation:scope (like work:<id>), because a
    // department's accounting tools are split by voucher kind, not by visibility
    // radius. Authorization is per-kind (no generic fallback).
    //   • CANCEL covers cancel + edit + convert-to-draft (one eligibility).
    //   • DELETE is the single removal (soft-delete was retired 2026-06-09;
    //     the former "hard-delete" is now just "delete").
    // Single source of truth for the kind↔permission mapping: voucherMatrix.ts.
    FINANCE_VOUCHER_CREATE_PAYMENT:      "finance:voucher:create:payment",
    FINANCE_VOUCHER_POST_PAYMENT:        "finance:voucher:post:payment",
    FINANCE_VOUCHER_CANCEL_PAYMENT:      "finance:voucher:cancel:payment",
    FINANCE_VOUCHER_DELETE_PAYMENT:      "finance:voucher:delete:payment",

    FINANCE_VOUCHER_CREATE_RECEIPT:      "finance:voucher:create:receipt",
    FINANCE_VOUCHER_POST_RECEIPT:        "finance:voucher:post:receipt",
    FINANCE_VOUCHER_CANCEL_RECEIPT:      "finance:voucher:cancel:receipt",
    FINANCE_VOUCHER_DELETE_RECEIPT:      "finance:voucher:delete:receipt",

    FINANCE_VOUCHER_CREATE_CONTRA:       "finance:voucher:create:contra",
    FINANCE_VOUCHER_POST_CONTRA:         "finance:voucher:post:contra",
    FINANCE_VOUCHER_CANCEL_CONTRA:       "finance:voucher:cancel:contra",
    FINANCE_VOUCHER_DELETE_CONTRA:       "finance:voucher:delete:contra",

    FINANCE_VOUCHER_CREATE_CREDIT_NOTE:      "finance:voucher:create:credit-note",
    FINANCE_VOUCHER_POST_CREDIT_NOTE:        "finance:voucher:post:credit-note",
    FINANCE_VOUCHER_CANCEL_CREDIT_NOTE:      "finance:voucher:cancel:credit-note",
    FINANCE_VOUCHER_DELETE_CREDIT_NOTE:      "finance:voucher:delete:credit-note",

    FINANCE_VOUCHER_CREATE_DEBIT_NOTE:      "finance:voucher:create:debit-note",
    FINANCE_VOUCHER_POST_DEBIT_NOTE:        "finance:voucher:post:debit-note",
    FINANCE_VOUCHER_CANCEL_DEBIT_NOTE:      "finance:voucher:cancel:debit-note",
    FINANCE_VOUCHER_DELETE_DEBIT_NOTE:      "finance:voucher:delete:debit-note",

    FINANCE_VOUCHER_CREATE_JOURNAL:      "finance:voucher:create:journal",
    FINANCE_VOUCHER_POST_JOURNAL:        "finance:voucher:post:journal",
    FINANCE_VOUCHER_CANCEL_JOURNAL:      "finance:voucher:cancel:journal",
    FINANCE_VOUCHER_DELETE_JOURNAL:      "finance:voucher:delete:journal",

    // Retention — view rides the sidebar link grant; each page has an independent
    // create / edit / delete.
    LOYALTY_CREATE:                     "loyalty:create",
    LOYALTY_EDIT:                       "loyalty:edit",
    LOYALTY_DELETE:                     "loyalty:delete",
    COUPONS_CREATE:                     "coupons:create",
    COUPONS_EDIT:                       "coupons:edit",
    COUPONS_DELETE:                     "coupons:delete",
    GIFT_CARDS_CREATE:                  "gift-cards:create",
    GIFT_CARDS_EDIT:                    "gift-cards:edit",
    GIFT_CARDS_DELETE:                  "gift-cards:delete",
    TIERS_CREATE:                       "tiers:create",
    TIERS_EDIT:                         "tiers:edit",
    TIERS_DELETE:                       "tiers:delete",

    // Repair — the ticket resource (All Repair list + ticket page). View rides the
    // repair sidebar link; these granular keys gate the create / edit / delete
    // actions on a ticket. Flat (no branch radius) — a ticket is worked by whoever
    // holds the write id, matching the current "open to all staff" repair posture.
    TICKETS_CREATE:                     "tickets:create",
    TICKETS_EDIT:                       "tickets:edit",
    TICKETS_DELETE:                     "tickets:delete",

    // CRM / Administration — the deal and internal-task resources, same flat
    // create / edit / delete shape as tickets (no branch radius). CREATE also gates
    // the "New Deal +" / "New Task +" quick action; EDIT / DELETE gate the buttons
    // on the detail dialog. UI-visibility only, like the other resource families.
    DEALS_CREATE:                       "deals:create",
    DEALS_EDIT:                         "deals:edit",
    DEALS_DELETE:                       "deals:delete",
    TASKS_CREATE:                       "tasks:create",
    TASKS_EDIT:                         "tasks:edit",
    TASKS_DELETE:                       "tasks:delete",

    // Help Desk — front-desk enquiry tickets (Help board + POS counter Enquiry).
    // CREATE gates logging one; EDIT gates advise / close-with-outcome / convert;
    // DELETE gates removal. UI-visibility only, like the other resource families.
    HELP_CREATE:                        "help:create",
    HELP_EDIT:                          "help:edit",
    HELP_DELETE:                        "help:delete",
    // Gate for the "More +" quick action (opens the all-create-actions dialog).
    // Behaves like a create action — its own tick in the role's Quick Actions.
    QUICK_ACTIONS_MORE:                 "quick-actions:more",

    // Inventory module pages — Products (the catalog) and Masters (the 8 setup
    // tables, gated together). View rides the sidebar link; these granular keys are
    // the gates on the CRUD routes. Product tax fields are carved out separately as
    // compliance:tax:edit.
    PRODUCTS_CREATE:                    "products:create",
    PRODUCTS_EDIT:                      "products:edit",
    PRODUCTS_DELETE:                    "products:delete",
    INVENTORY_MASTERS_CREATE:           "inventory:masters:create",
    INVENTORY_MASTERS_EDIT:             "inventory:masters:edit",
    INVENTORY_MASTERS_DELETE:           "inventory:masters:delete",

    // Pricing Strategy — one edit gate per page. Viewing rides the sidebar link
    // grant. Each key passes its matching route.
    PRICING_STRATEGY_SET:               "pricing:strategy:set",
    // Separate from SET: Reset wipes every point in one click.
    PRICING_STRATEGY_RESET:             "pricing:strategy:reset",
    PRICING_COSTING_MANAGE:             "pricing:costing:manage",
    PRICING_LABELS_APPLY:               "pricing:labels:apply",

    // POS — shift / till / handover lifecycle
    POS_SHIFT_OPEN:                     "pos:shift:open",
    POS_SHIFT_CLOSE:                    "pos:shift:close",
    POS_SHIFT_DROP:                     "pos:shift:drop",
    // Oversight: emergency-close a stuck OPEN shift on another operator's behalf
    // (from the counters board). Distinct from the operator's own `pos:shift:close`.
    POS_SHIFT_FORCE_CLOSE:              "pos:shift:force-close",

    // Roles
    ROLES_CREATE:                       "roles:create",
    ROLES_EDIT:                     "roles:edit",
    ROLES_DELETE:                   "roles:delete",

    // Branches / Departments / Positions / POS Counters — split out of the former
    // shared settings:manage. create/edit/delete are the independent action grants
    // the Role matrix ticks; page access rides the admin sidebar nav.
    BRANCHES_CREATE:                     "branches:create",
    BRANCHES_EDIT:                       "branches:edit",
    BRANCHES_DELETE:                     "branches:delete",
    DEPARTMENTS_CREATE:                  "departments:create",
    DEPARTMENTS_EDIT:                    "departments:edit",
    DEPARTMENTS_DELETE:                  "departments:delete",
    POSITIONS_CREATE:                    "positions:create",
    POSITIONS_EDIT:                      "positions:edit",
    POSITIONS_DELETE:                    "positions:delete",
    POS_COUNTERS_CREATE:                 "pos-counters:create",
    POS_COUNTERS_EDIT:                   "pos-counters:edit",
    POS_COUNTERS_DELETE:                 "pos-counters:delete",

    // Settings
    SETTINGS_MANAGE:                    "settings:manage",


    // Compliance (GST reports) — read access rides the accountancy sidebar nav;
    // this is the one extra gate for the Tax Classification page's inline edits
    // (rate / HSN / taxability).
    COMPLIANCE_TAX_EDIT:                 "compliance:tax:edit",

    // Users
    USERS_CREATE:                       "users:create",
    USERS_EDIT:                     "users:edit",
    USERS_DELETE:                   "users:delete",
} as const;

export type PermissionId = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
