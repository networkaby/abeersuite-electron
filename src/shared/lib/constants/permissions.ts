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

    // Assignments
    ASSIGNMENTS_VIEW_OWN:               "assignments:view:own",
    ASSIGNMENTS_VIEW_BRANCH:            "assignments:view:branch",
    ASSIGNMENTS_VIEW_DEPARTMENT:        "assignments:view:department",
    ASSIGNMENTS_VIEW_ORG:               "assignments:view:org",
    ASSIGNMENTS_VIEW_TEAM:              "assignments:view-team",
    ASSIGNMENTS_VIEW_ORG_LEGACY:        "assignments:view-org",

    // Companies
    COMPANIES_CREATE:                   "companies:create",
    COMPANIES_EDIT_ORG:                 "companies:edit:org",
    COMPANIES_DELETE_ORG:               "companies:delete:org",
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

    // Finance — invoices, vouchers, journals, payments, allocations
    FINANCE_INVOICE_CANCEL:             "finance:invoice:cancel",
    FINANCE_INVOICE_DELETE:             "finance:invoice:delete",
    FINANCE_INVOICE_HARD_DELETE:        "finance:invoice:hard-delete",
    FINANCE_JOURNAL_CANCEL:             "finance:journal:cancel",
    FINANCE_JOURNAL_DELETE:             "finance:journal:delete",
    FINANCE_JOURNAL_HARD_DELETE:        "finance:journal:hard-delete",
    FINANCE_VOUCHER_CREATE:             "finance:voucher:create",
    FINANCE_VOUCHER_POST:               "finance:voucher:post",
    FINANCE_VOUCHER_CANCEL:             "finance:voucher:cancel",
    FINANCE_VOUCHER_DELETE:             "finance:voucher:delete",
    FINANCE_VOUCHER_HARD_DELETE:        "finance:voucher:hard-delete",
    FINANCE_PAYMENT_CANCEL:             "finance:payment:cancel",
    FINANCE_PAYMENT_DELETE:             "finance:payment:delete",
    FINANCE_PAYMENT_HARD_DELETE:        "finance:payment:hard-delete",
    FINANCE_ALLOCATION_MANAGE:          "finance:allocation:manage",
    FINANCE_OPENING_BALANCE_MANAGE:     "finance:opening-balance:manage",

    // Loyalty — earn/redeem wallet config + manual adjustments
    LOYALTY_MANAGE:                     "loyalty:manage",

    // Coupons — promotions + gift-card management
    COUPONS_MANAGE:                     "coupons:manage",

    // Inventory
    INVENTORY_MANAGE:                   "inventory:manage",
    INVENTORY_VIEW_BR:                  "inventory:view:branch",
    INVENTORY_EDIT_BR:                  "inventory:edit:branch",
    INVENTORY_VIEW_ORG:                 "inventory:view:org",
    INVENTORY_EDIT_ORG:                 "inventory:edit:org",
    INVENTORY_VOUCHER_CANCEL:           "inventory:voucher:cancel",
    INVENTORY_VOUCHER_DELETE:           "inventory:voucher:delete",
    INVENTORY_VOUCHER_HARD_DELETE:      "inventory:voucher:hard-delete",

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

    // Settings
    SETTINGS_EDIT:                      "settings:edit",
    SETTINGS_MANAGE:                    "settings:manage",
    SETTINGS_STATUSES:                  "settings:statuses",
    SETTINGS_STATUSES_CREATE:           "settings:statuses:create",
    SETTINGS_STATUSES_EDIT:             "settings:statuses:edit",
    SETTINGS_STATUSES_DELETE:           "settings:statuses:delete",
    SETTINGS_PIPELINES:                 "settings:pipelines",
    SETTINGS_PIPELINES_CREATE:          "settings:pipelines:create",
    SETTINGS_PIPELINES_EDIT:            "settings:pipelines:edit",
    SETTINGS_PIPELINES_DELETE:          "settings:pipelines:delete",

    // Tickets
    TICKETS_CREATE:                     "tickets:create",
    TICKETS_VIEW_OWN:                   "tickets:view:own",
    TICKETS_VIEW_BRANCH:                "tickets:view:branch",
    TICKETS_VIEW_DEPARTMENT:            "tickets:view:department",
    TICKETS_VIEW_ORG:                   "tickets:view:org",
    TICKETS_EDIT_OWN:                   "tickets:edit:own",
    TICKETS_EDIT_BRANCH:                "tickets:edit:branch",
    TICKETS_EDIT_DEPARTMENT:            "tickets:edit:department",
    TICKETS_EDIT_ORG:                   "tickets:edit:org",
    TICKETS_DELETE_OWN:                 "tickets:delete:own",
    TICKETS_DELETE_BRANCH:              "tickets:delete:branch",
    TICKETS_DELETE_DEPARTMENT:          "tickets:delete:department",
    TICKETS_DELETE_ORG:                 "tickets:delete:org",
    TICKETS_ASSIGN:                     "tickets:assign",
    TICKETS_STATUS_SET:                 "tickets:status:set",
    TICKETS_SUBSTATUS_SET:              "tickets:substatus:set",
    TICKETS_MANAGE_PARTICIPANTS:        "tickets:manage-participants",

    // Users
    USERS_CREATE:                       "users:create",
    USERS_EDIT_ORG:                     "users:edit:org",
    USERS_DELETE_ORG:                   "users:delete:org",
    USERS_MANAGE:                       "users:manage",

    // Administration — internal work board (pipeline-based todos)
    ADMINISTRATION_TASKS_VIEW:          "administration:tasks:view",
    ADMINISTRATION_TASKS_MANAGE:        "administration:tasks:manage",

    // Warranty
    WARRANTY_CONVERT:                   "warranty:convert",

    // Auto-added by check-doc-sync --fix:
    SERVICE_CENTERS_VIEW:                "service-centers:view",
    SERVICE_CENTERS_MANAGE:              "service-centers:manage",
    SERVICE_CENTERS_VIEW_BRANCH:         "service-centers:view:branch",
    SERVICE_CENTERS_VIEW_ORG:            "service-centers:view:org",
    SERVICE_CENTERS_CREATE:              "service-centers:create",
    SERVICE_CENTERS_EDIT_ORG:            "service-centers:edit:org",
    SERVICE_CENTERS_DELETE_ORG:          "service-centers:delete:org",

    // Seeded gated-work permissions (work:<opaque id>).
    WORK_W1:                             "work:W1",
    WORK_W2:                             "work:W2",
    WORK_W3:                             "work:W3",
    WORK_W4:                             "work:W4",
} as const;

export type PermissionId = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
