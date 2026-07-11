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

    // Accountancy — flat view gate (radius is always branch, decided by position;
    // :own/:br/:org retired). The old create/edit/delete scope ladder was removed:
    // those keys enforced nothing — accountancy writes run through the voucher
    // matrix (finance:voucher:*) and accountancy:masters:* instead.
    ACCOUNTANCY_VIEW:                   "accountancy:view",
    // Accountancy Masters — the chart of accounts (Account Groups, Ledgers, Chart
    // of Accounts), gated together. Separate from viewing (was gated by view:org)
    // and from voucher creation. Opening Balance keeps finance:opening-balance:manage.
    ACCOUNTANCY_MASTERS_CREATE:         "accountancy:masters:create",
    ACCOUNTANCY_MASTERS_EDIT:           "accountancy:masters:edit",
    ACCOUNTANCY_MASTERS_DELETE:         "accountancy:masters:delete",

    // Companies — people + companies share the Contacts (customers:*) permission
    // set, so companies have no CRUD keys of their own. companies:manage is kept
    // only for Customer Tools (merge/convert).
    COMPANIES_MANAGE:                   "companies:manage",

    // Deals (sales pipeline)
    DEALS_VIEW:                         "deals:view",
    DEALS_MANAGE:                       "deals:manage",

    // Customers (Contacts = Person + Company; share ONE flat set). Contacts carry
    // no branch, so there is no radius to enforce — any branch may CRUD (gated only
    // by holding the write id). The old own/department/branch/org ladder and the
    // customers:manage umbrella are retired (radius = branch, and Contacts have none).
    CUSTOMERS_VIEW:                     "customers:view",
    CUSTOMERS_CREATE:                   "customers:create",
    CUSTOMERS_EDIT:                     "customers:edit",
    CUSTOMERS_DELETE:                   "customers:delete",
    CUSTOMERS_HARD_DELETE:              "customers:hard-delete",

    // E-commerce
    ECOMMERCE_MANAGE:                   "ecommerce:manage",

    // Finance — vouchers, journals, allocations
    FINANCE_JOURNAL_CANCEL:             "finance:journal:cancel",
    FINANCE_JOURNAL_DELETE:             "finance:journal:delete",
    FINANCE_JOURNAL_HARD_DELETE:        "finance:journal:hard-delete",
    FINANCE_VOUCHER_CREATE:             "finance:voucher:create",
    FINANCE_VOUCHER_POST:               "finance:voucher:post",
    FINANCE_VOUCHER_CANCEL:             "finance:voucher:cancel",
    FINANCE_VOUCHER_DELETE:             "finance:voucher:delete",
    FINANCE_VOUCHER_HARD_DELETE:        "finance:voucher:hard-delete",

    // Finance — per-kind GL voucher gates: finance:voucher:<action>:<kind>.
    // The trailing segment is the VoucherType (kebab-case), NOT a scope — a
    // deliberate exception to area:operation:scope (like work:<id>), because a
    // department's accounting tools are split by voucher kind, not by visibility
    // radius. Routes check the per-kind key OR the generic key above (additive
    // fallback, so legacy grants keep working).
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
    FINANCE_ALLOCATION_MANAGE:          "finance:allocation:manage",
    FINANCE_OPENING_BALANCE_MANAGE:     "finance:opening-balance:manage",

    // Retention — view rides the sidebar link grant; each page has an independent
    // create / edit / delete, plus a money-sensitive guard where one exists.
    // `<page>:manage` stays as the umbrella (grants all actions on that page).
    LOYALTY_MANAGE:                     "loyalty:manage",
    LOYALTY_CREATE:                     "loyalty:create",
    LOYALTY_EDIT:                       "loyalty:edit",
    LOYALTY_DELETE:                     "loyalty:delete",
    COUPONS_MANAGE:                     "coupons:manage",
    COUPONS_CREATE:                     "coupons:create",
    COUPONS_EDIT:                       "coupons:edit",
    COUPONS_DELETE:                     "coupons:delete",
    GIFT_CARDS_MANAGE:                  "gift-cards:manage",       // split from coupons
    GIFT_CARDS_CREATE:                  "gift-cards:create",
    GIFT_CARDS_EDIT:                    "gift-cards:edit",
    GIFT_CARDS_DELETE:                  "gift-cards:delete",
    TIERS_MANAGE:                       "tiers:manage",            // was borrowed customers:manage
    TIERS_CREATE:                       "tiers:create",
    TIERS_EDIT:                         "tiers:edit",
    TIERS_DELETE:                       "tiers:delete",

    // Inventory — flat view/edit (radius is always branch, decided by position;
    // :branch/:org retired). INVENTORY_EDIT is the voucher-authoring key (GRN /
    // Challan / etc. create+post via the voucher matrix). Cross-branch stock view
    // is admin-only.
    INVENTORY_MANAGE:                   "inventory:manage",
    INVENTORY_VIEW:                     "inventory:view",
    INVENTORY_EDIT:                     "inventory:edit",
    INVENTORY_VOUCHER_CANCEL:           "inventory:voucher:cancel",
    INVENTORY_VOUCHER_DELETE:           "inventory:voucher:delete",
    INVENTORY_VOUCHER_HARD_DELETE:      "inventory:voucher:hard-delete",
    // Inventory module pages — Products (the catalog) and Masters (the 8 setup
    // tables, gated together). View rides the sidebar link; these granular keys
    // are the ONLY gates on the CRUD routes (inventory:manage no longer passes
    // them — it remains only for inventory admin/config: naming-convention writes,
    // item import, pricing pages, voucher-register nav). Product tax fields are
    // still carved out separately as compliance:tax:edit.
    PRODUCTS_CREATE:                    "products:create",
    PRODUCTS_EDIT:                      "products:edit",
    PRODUCTS_DELETE:                    "products:delete",
    INVENTORY_MASTERS_CREATE:           "inventory:masters:create",
    INVENTORY_MASTERS_EDIT:             "inventory:masters:edit",
    INVENTORY_MASTERS_DELETE:           "inventory:masters:delete",

    // Pricing Strategy — one edit gate per page. Viewing rides the sidebar link
    // grant; the "Needs attention" page edits the product itself, so its edits
    // stay on inventory:manage (not listed here). Each key OR inventory:manage
    // passes the matching route (inventory:manage is the umbrella).
    PRICING_STRATEGY_SET:               "pricing:strategy:set",
    PRICING_COSTING_MANAGE:             "pricing:costing:manage",
    PRICING_LABELS_APPLY:               "pricing:labels:apply",

    // POS — shift / till / handover lifecycle
    POS_SHIFT_OPEN:                     "pos:shift:open",
    POS_SHIFT_CLOSE:                    "pos:shift:close",
    POS_SHIFT_DROP:                     "pos:shift:drop",
    // Radius is always branch (decided by the holder's position), so shift view
    // carries no scope suffix — flat pos:shift:view. Cross-branch ("all") view is
    // admin-only. Replaced the old :branch/:org pair (retired with the org scope).
    POS_SHIFT_VIEW:                     "pos:shift:view",
    POS_SHIFT_MANAGE:                   "pos:shift:manage",

    // Roles
    ROLES_CREATE:                       "roles:create",
    ROLES_EDIT_ORG:                     "roles:edit:org",
    ROLES_DELETE_ORG:                   "roles:delete:org",
    ROLES_MANAGE:                       "roles:manage",

    // Branches / Departments / Positions / POS Counters — split out of the
    // former shared settings:manage. `:manage` is the umbrella (grants all + gates
    // the admin tab); create/edit/delete are the independent action grants the
    // Role matrix ticks. Mutating routes accept the action key OR `:manage`.
    BRANCHES_MANAGE:                     "branches:manage",
    BRANCHES_CREATE:                     "branches:create",
    BRANCHES_EDIT:                       "branches:edit",
    BRANCHES_DELETE:                     "branches:delete",
    DEPARTMENTS_MANAGE:                  "departments:manage",
    DEPARTMENTS_CREATE:                  "departments:create",
    DEPARTMENTS_EDIT:                    "departments:edit",
    DEPARTMENTS_DELETE:                  "departments:delete",
    POSITIONS_MANAGE:                    "positions:manage",
    POSITIONS_CREATE:                    "positions:create",
    POSITIONS_EDIT:                      "positions:edit",
    POSITIONS_DELETE:                    "positions:delete",
    POS_COUNTERS_MANAGE:                 "pos-counters:manage",
    POS_COUNTERS_CREATE:                 "pos-counters:create",
    POS_COUNTERS_EDIT:                   "pos-counters:edit",
    POS_COUNTERS_DELETE:                 "pos-counters:delete",

    // Settings
    SETTINGS_MANAGE:                    "settings:manage",


    // Compliance (GST reports) — read access rides the general accountancy:view:*
    // permissions; this is the one extra gate for the Tax Classification page's
    // inline edits (rate / HSN / taxability), replacing the borrowed
    // inventory:manage so it isn't tangled up with unrelated inventory-master CRUD.
    COMPLIANCE_TAX_EDIT:                 "compliance:tax:edit",

    // Users
    USERS_CREATE:                       "users:create",
    USERS_EDIT_ORG:                     "users:edit:org",
    USERS_DELETE_ORG:                   "users:delete:org",
    USERS_MANAGE:                       "users:manage",

    // Administration — internal work board (pipeline-based todos)
    ADMINISTRATION_TASKS_VIEW:          "administration:tasks:view",
    ADMINISTRATION_TASKS_MANAGE:        "administration:tasks:manage",
} as const;

export type PermissionId = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
