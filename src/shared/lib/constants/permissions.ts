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
    ADMIN_BYPASS: "admin:bypass",

    // Auth — login location control.
    // When granted, the user may log in from any machine. Without it, login is
    // restricted to counter machines (those that answer a bridge health check —
    // see src/shared/lib/bridge/bridgeHealth.ts).
    AUTH_LOGIN_OUTSIDE_COUNTER: "auth:login:outside-counter",

    // Mobile app (/m-staff-app). MOBILE_APP_ACCESS lets a person sign in off a counter
    // for the phone app only (auth/phoneOnly.ts); AUTH_LOGIN_OUTSIDE_COUNTER opens it
    // too, with the office website. Then one tick per phone screen.
    MOBILE_APP_ACCESS: "mobile:app:access",
    MOBILE_STOCK_VIEW: "mobile:stock:view",
    MOBILE_PARTIES_VIEW: "mobile:parties:view",
    MOBILE_RECEIVABLES_VIEW: "mobile:receivables:view",
    MOBILE_PAYABLES_VIEW: "mobile:payables:view",
    MOBILE_DAYBOOK_VIEW: "mobile:daybook:view",
    MOBILE_PHOTOS_EDIT: "mobile:photos:edit",
    MOBILE_INBOX_VIEW: "mobile:inbox:view",
    MOBILE_POSTS_SHARE: "mobile:posts:share",

    // Accountancy Masters — the chart of accounts (Account Groups, Ledgers, Chart
    // of Accounts), gated together. Read access rides the accountancy sidebar nav.
    ACCOUNTANCY_MASTERS_CREATE: "accountancy:masters:create",
    ACCOUNTANCY_MASTERS_EDIT: "accountancy:masters:edit",
    ACCOUNTANCY_MASTERS_DELETE: "accountancy:masters:delete",

    // Due reminders from the Receivables report. SEND = one customer at a time;
    // SEND_ALL = "Send reminder to all", kept apart because one press can message
    // every customer who owes. The automation itself is Settings (settings:manage).
    ACCOUNTANCY_REMINDERS_SEND: "accountancy:reminders:send",
    ACCOUNTANCY_REMINDERS_SEND_ALL: "accountancy:reminders:send-all",

    // Customers (Contacts = Person + Company; share ONE flat set). Contacts carry
    // no branch, so there is no radius to enforce — any branch may CRUD (gated only
    // by holding the write id).
    CUSTOMERS_CREATE: "customers:create",
    CUSTOMERS_EDIT: "customers:edit",
    // DELETE also carries the party's opening balance (the Contacts profile card and
    // PATCH /api/accounts/[id]): rewriting what a party owed before the books started
    // moves real money the same way removing the party does, so both ride this tick.
    CUSTOMERS_DELETE: "customers:delete",
    // Show suppliers (Sundry Creditors) in Contacts lists AND voucher party dropdowns.
    // Absent → browses customers (Sundry Debtors) only; suppliers are filtered from
    // both surfaces (Contacts pages + party pickers in vouchers / repair slips).
    CUSTOMERS_VIEW_CREDITORS: "customers:view:creditors",

    // Finance — per-kind GL voucher gates: finance:voucher:<action>:<kind>.
    // The trailing segment is the VoucherType (kebab-case), NOT a scope — a
    // deliberate exception to area:operation:scope (like work:<id>), because a
    // department's accounting tools are split by voucher kind, not by visibility
    // radius. Authorization is per-kind (no generic fallback).
    //   • CANCEL covers cancel + edit + convert-to-draft (one eligibility).
    //   • DELETE is the single removal (soft-delete was retired 2026-06-09;
    //     the former "hard-delete" is now just "delete").
    // Single source of truth for the kind↔permission mapping: voucherMatrix.ts.
    FINANCE_VOUCHER_CREATE_PAYMENT: "finance:voucher:create:payment",
    FINANCE_VOUCHER_POST_PAYMENT: "finance:voucher:post:payment",
    FINANCE_VOUCHER_CANCEL_PAYMENT: "finance:voucher:cancel:payment",
    FINANCE_VOUCHER_DELETE_PAYMENT: "finance:voucher:delete:payment",

    FINANCE_VOUCHER_CREATE_RECEIPT: "finance:voucher:create:receipt",
    FINANCE_VOUCHER_POST_RECEIPT: "finance:voucher:post:receipt",
    FINANCE_VOUCHER_CANCEL_RECEIPT: "finance:voucher:cancel:receipt",
    FINANCE_VOUCHER_DELETE_RECEIPT: "finance:voucher:delete:receipt",

    FINANCE_VOUCHER_CREATE_CONTRA: "finance:voucher:create:contra",
    FINANCE_VOUCHER_POST_CONTRA: "finance:voucher:post:contra",
    FINANCE_VOUCHER_CANCEL_CONTRA: "finance:voucher:cancel:contra",
    FINANCE_VOUCHER_DELETE_CONTRA: "finance:voucher:delete:contra",

    FINANCE_VOUCHER_CREATE_CREDIT_NOTE: "finance:voucher:create:credit-note",
    FINANCE_VOUCHER_POST_CREDIT_NOTE: "finance:voucher:post:credit-note",
    FINANCE_VOUCHER_CANCEL_CREDIT_NOTE: "finance:voucher:cancel:credit-note",
    FINANCE_VOUCHER_DELETE_CREDIT_NOTE: "finance:voucher:delete:credit-note",

    FINANCE_VOUCHER_CREATE_DEBIT_NOTE: "finance:voucher:create:debit-note",
    FINANCE_VOUCHER_POST_DEBIT_NOTE: "finance:voucher:post:debit-note",
    FINANCE_VOUCHER_CANCEL_DEBIT_NOTE: "finance:voucher:cancel:debit-note",
    FINANCE_VOUCHER_DELETE_DEBIT_NOTE: "finance:voucher:delete:debit-note",

    FINANCE_VOUCHER_CREATE_JOURNAL: "finance:voucher:create:journal",
    FINANCE_VOUCHER_POST_JOURNAL: "finance:voucher:post:journal",
    FINANCE_VOUCHER_CANCEL_JOURNAL: "finance:voucher:cancel:journal",
    FINANCE_VOUCHER_DELETE_JOURNAL: "finance:voucher:delete:journal",

    // Retention — view rides the sidebar link grant; each page has an independent
    // create / edit / delete.
    LOYALTY_CREATE: "loyalty:create",
    LOYALTY_EDIT: "loyalty:edit",
    LOYALTY_DELETE: "loyalty:delete",
    COUPONS_CREATE: "coupons:create",
    COUPONS_EDIT: "coupons:edit",
    COUPONS_DELETE: "coupons:delete",
    GIFT_CARDS_CREATE: "gift-cards:create",
    GIFT_CARDS_EDIT: "gift-cards:edit",
    GIFT_CARDS_DELETE: "gift-cards:delete",
    TIERS_CREATE: "tiers:create",
    TIERS_EDIT: "tiers:edit",
    TIERS_DELETE: "tiers:delete",

    // Retention Protection
    RETENTION_PROTECTION_MANAGE: "retention:protection:manage",


    // Repair — the ticket resource (All Repair list + ticket page). View rides the
    // repair sidebar link; these granular keys gate the create / edit / delete
    // actions on a ticket. Flat (no branch radius) — a ticket is worked by whoever
    // holds the write id, matching the current "open to all staff" repair posture.
    TICKETS_CREATE: "tickets:create",
    TICKETS_EDIT: "tickets:edit",
    TICKETS_DELETE: "tickets:delete",

    // CRM / Administration — the deal and internal-task resources, same flat
    // create / edit / delete shape as tickets (no branch radius). CREATE also gates
    // the "New Deal +" / "New Task +" quick action; EDIT / DELETE gate the buttons
    // on the detail dialog. UI-visibility only, like the other resource families.
    DEALS_CREATE: "deals:create",
    DEALS_EDIT: "deals:edit",
    DEALS_DELETE: "deals:delete",
    TASKS_CREATE: "tasks:create",
    TASKS_EDIT: "tasks:edit",
    TASKS_DELETE: "tasks:delete",

    // Help Desk — front-desk enquiry tickets (Help board + POS counter Enquiry).
    // CREATE gates logging one; EDIT gates advise / close-with-outcome / convert;
    // DELETE gates removal. UI-visibility only, like the other resource families.
    HELP_CREATE: "help:create",
    HELP_EDIT: "help:edit",
    HELP_DELETE: "help:delete",
    // Customer Messages (CRM → Messages). View rides the sidebar link; REPLY gates
    // sending a WhatsApp reply — checked at the API, since each reply costs money.
    MESSAGES_REPLY: "messages:reply",
    // Reviews (CRM → Reviews). View rides the sidebar link; REPLY gates the public
    // answer on Google — everyone can read it, so it is its own tick.
    REVIEWS_REPLY: "reviews:reply",
    // Campaigns — writing rides the sidebar link; SEND reaches every customer at once.
    CAMPAIGNS_SEND: "campaigns:send",
    CAMPAIGNS_GOOGLE_CONNECT: "campaigns:google:connect",
    CAMPAIGNS_FACEBOOK_CONNECT: "campaigns:facebook:connect",
    CAMPAIGNS_CONSENT_EDIT: "campaigns:consent:edit",
    // Gate for the "More +" quick action (opens the all-create-actions dialog).
    // Behaves like a create action — its own tick in the role's Quick Actions.
    QUICK_ACTIONS_MORE: "quick-actions:more",

    // Inventory module pages — Products (the catalog) and Masters (the 8 setup
    // tables, gated together). View rides the sidebar link; these granular keys are
    // the gates on the CRUD routes. Product tax fields are carved out separately as
    // compliance:tax:edit.
    PRODUCTS_CREATE: "products:create",
    PRODUCTS_EDIT: "products:edit",
    PRODUCTS_DELETE: "products:delete",
    INVENTORY_MASTERS_CREATE: "inventory:masters:create",
    INVENTORY_MASTERS_EDIT: "inventory:masters:edit",
    INVENTORY_MASTERS_DELETE: "inventory:masters:delete",

    // Pricing Strategy — the work on these pages rides the sidebar link grant
    // itself (requireModuleAccess). Reset is the lone exception: it wipes every
    // point in one click, so it keeps a key of its own.
    PRICING_STRATEGY_RESET: "pricing:strategy:reset",

    // E-Commerce → Customize Home — the page itself rides the sidebar link.
    // Permanent fallback sections (priority -1) stay locked; this key shows the
    // Unlock button that opens them all for editing at once.
    ECOMMERCE_FALLBACK_UNLOCK: "ecommerce:fallback:unlock",
    // Settings → E-Commerce → Photo cleanup: deletes Cloudinary files for good.
    ECOMMERCE_PHOTO_CLEANUP: "ecommerce:photos:cleanup",
    // E-Commerce → Products → Edit: change the product's inventory Group / Brand.
    ECOMMERCE_PRODUCT_MASTERS: "ecommerce:product:masters",
    ECOMMERCE_PRODUCT_ATTENTION: "ecommerce:product:attention",

    // POS — shift / till / handover lifecycle
    POS_SHIFT_OPEN: "pos:shift:open",
    POS_SHIFT_CLOSE: "pos:shift:close",
    POS_SHIFT_DROP: "pos:shift:drop",
    // Oversight: emergency-close a stuck OPEN shift on another operator's behalf
    // (from the counters board). Distinct from the operator's own `pos:shift:close`.
    POS_SHIFT_FORCE_CLOSE: "pos:shift:force-close",
    // Share UPI QR → WhatsApp: send the PAY_REQUEST template from the shop's number.
    POS_UPI_REQUEST_SEND: "pos:upi-request:send",

    // Roles
    ROLES_CREATE: "roles:create",
    ROLES_EDIT: "roles:edit",
    ROLES_DELETE: "roles:delete",

    // Branches / Departments / Positions / POS Counters — split out of the former
    // shared settings:manage. create/edit/delete are the independent action grants
    // the Role matrix ticks; page access rides the admin sidebar nav.
    BRANCHES_CREATE: "branches:create",
    BRANCHES_EDIT: "branches:edit",
    BRANCHES_DELETE: "branches:delete",
    DEPARTMENTS_CREATE: "departments:create",
    DEPARTMENTS_EDIT: "departments:edit",
    DEPARTMENTS_DELETE: "departments:delete",
    POSITIONS_CREATE: "positions:create",
    POSITIONS_EDIT: "positions:edit",
    POSITIONS_DELETE: "positions:delete",
    POS_COUNTERS_CREATE: "pos-counters:create",
    POS_COUNTERS_EDIT: "pos-counters:edit",
    POS_COUNTERS_DELETE: "pos-counters:delete",

    // Settings
    SETTINGS_MANAGE: "settings:manage",
    SETTINGS_AI_MANAGE: "settings:ai:manage",
    SETTINGS_TRACKING_MANAGE: "settings:tracking:manage",
    // Settings → Incoming API — every outside caller's key; one tick for the whole page.
    SETTINGS_INCOMING_MANAGE: "settings:incoming:manage",


    // Compliance (GST reports) — read access rides the accountancy sidebar nav;
    // this is the one extra gate for the Tax Classification page's inline edits
    // (rate / HSN / taxability).
    COMPLIANCE_TAX_EDIT: "compliance:tax:edit",

    // Users
    USERS_CREATE: "users:create",
    USERS_EDIT: "users:edit",
    USERS_DELETE: "users:delete",

    // HR & People — one write gate for the staff record. View rides the HR
    // sidebar link (ui:sidebar:hr:staff); this key covers the profile, the
    // salary revisions and "mark as left". A person may always save their OWN
    // personal / bank details (the self rule of PUT /api/users/[id]).
    HR_STAFF_EDIT: "hr:staff:edit",
    // Attendance register + holiday list (marking a day, adding a holiday), and
    // deciding leave. Filing one's own leave needs no grant.
    HR_ATTENDANCE_EDIT: "hr:attendance:edit",
    HR_LEAVE_APPROVE: "hr:leave:approve",
    // Payroll — generating a month's run is a separate, heavier act than editing
    // one person's record, so it has its own key. Posting the run to the books
    // ALSO needs the journal-voucher post gate, checked by the post route.
    HR_PAYROLL_RUN: "hr:payroll:run",
} as const;

export type PermissionId = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
