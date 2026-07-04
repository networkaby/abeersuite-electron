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

    // Accountancy — scoped views/edits
    ACCOUNTANCY_VIEW_OWN:               "accountancy:view:own",
    ACCOUNTANCY_VIEW_BR:                "accountancy:view:br",
    ACCOUNTANCY_VIEW_ORG:               "accountancy:view:org",
    ACCOUNTANCY_CREATE_OWN:             "accountancy:create:own",
    ACCOUNTANCY_EDIT_OWN:               "accountancy:edit:own",
    ACCOUNTANCY_EDIT_BR:                "accountancy:edit:br",
    ACCOUNTANCY_EDIT_ORG:               "accountancy:edit:org",
    ACCOUNTANCY_DELETE_OWN:             "accountancy:delete:own",
    ACCOUNTANCY_DELETE_BR:              "accountancy:delete:br",
    ACCOUNTANCY_DELETE_ORG:             "accountancy:delete:org",
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

    // Customers
    CUSTOMERS_VIEW:                     "customers:view",
    CUSTOMERS_VIEW_OWN:                 "customers:view:own",
    CUSTOMERS_VIEW_BRANCH:              "customers:view:branch",
    CUSTOMERS_VIEW_DEPARTMENT:          "customers:view:department",
    CUSTOMERS_VIEW_ORG:                 "customers:view:org",
    CUSTOMERS_CREATE:                   "customers:create",
    CUSTOMERS_EDIT_OWN:                 "customers:edit:own",
    CUSTOMERS_EDIT_BRANCH:              "customers:edit:branch",
    CUSTOMERS_EDIT_DEPARTMENT:          "customers:edit:department",
    CUSTOMERS_EDIT_ORG:                 "customers:edit:org",
    CUSTOMERS_DELETE_OWN:               "customers:delete:own",
    CUSTOMERS_DELETE_BRANCH:            "customers:delete:branch",
    CUSTOMERS_DELETE_DEPARTMENT:        "customers:delete:department",
    CUSTOMERS_DELETE_ORG:               "customers:delete:org",
    CUSTOMERS_MANAGE:                   "customers:manage",
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

    // Inventory
    INVENTORY_MANAGE:                   "inventory:manage",
    INVENTORY_VIEW_BR:                  "inventory:view:branch",
    INVENTORY_EDIT_BR:                  "inventory:edit:branch",
    INVENTORY_VIEW_ORG:                 "inventory:view:org",
    INVENTORY_EDIT_ORG:                 "inventory:edit:org",
    INVENTORY_VOUCHER_CANCEL:           "inventory:voucher:cancel",
    INVENTORY_VOUCHER_DELETE:           "inventory:voucher:delete",
    INVENTORY_VOUCHER_HARD_DELETE:      "inventory:voucher:hard-delete",
    // Inventory module pages — Products (the catalog) and Masters (the 8 setup
    // tables, gated together). View rides the sidebar link; inventory:manage stays
    // the umbrella (each key OR inventory:manage passes the route). Product tax
    // fields are still carved out separately as compliance:tax:edit.
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
    POS_SHIFT_VIEW_BR:                  "pos:shift:view:branch",
    POS_SHIFT_VIEW_ORG:                 "pos:shift:view:org",
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


    // Auto-added by check-doc-sync --fix:
    SERVICE_CENTERS_VIEW:                "service-centers:view",
    SERVICE_CENTERS_MANAGE:              "service-centers:manage",
    SERVICE_CENTERS_VIEW_BRANCH:         "service-centers:view:branch",
    SERVICE_CENTERS_VIEW_ORG:            "service-centers:view:org",
} as const;

export type PermissionId = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
