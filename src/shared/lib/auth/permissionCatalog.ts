// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PERMISSION CATALOG — every permission the code knows, as seed rows.
//
// Single source for the Permission table. Lives in src/shared so BOTH the seeds
// (prisma/seeds/lib/codeOwnedCatalog.ts re-exports it) and the running app can
// read it: the Departments / Role save paths call `ensureCatalogPermissions()`
// so an id that is real in code but not yet in the DB (a nav link added to
// SETTINGS_NAV mints `ui:sidebar:settings:<link>` on its own) is created on
// first use instead of being rejected or silently dropped.
// Add new permissions HERE (single source), never inline in either seed.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { voucherPermissionSeeds } from "./voucherMatrix";
import { sidebarPermissionSeeds } from "./sidebarModules";
import { posVoucherPermissionSeeds } from "./posVoucherMatrix";

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
    { id: "auth:login:outside-counter", label: "Can login outside counter", module: "core", description: "Allow login from a non-counter machine (without bridge). Without this permission, login is restricted to counter machines only." },

    // mobile — the phone app at /m-staff-app. "Can use Mobile App" signs a person in
    // for the phone app only; "Can login outside counter" opens it too, with the
    // office website. Then one tick per screen.
    { id: "mobile:app:access", label: "Can use Mobile App", module: "mobile", description: "Sign in to the phone app from anywhere, even without 'Can login outside counter'. Such a sign-in opens the phone app only, never the office website." },
    { id: "mobile:stock:view", label: "Mobile: stock & price", module: "mobile", description: "Phone app: search products and see available quantity (total and per branch) and sale price." },
    { id: "mobile:parties:view", label: "Mobile: party", module: "mobile", description: "Phone app: search parties and see their balance, vouchers with running balance, and unpaid bills." },
    { id: "mobile:receivables:view", label: "Mobile: receivables", module: "mobile", description: "Phone app: who owes us — total, age, and each party's unpaid bills." },
    { id: "mobile:payables:view", label: "Mobile: payables", module: "mobile", description: "Phone app: whom we owe — total, age, and each supplier's unpaid bills." },
    { id: "mobile:daybook:view", label: "Mobile: day book", module: "mobile", description: "Phone app: every voucher of a chosen day." },
    { id: "mobile:photos:edit", label: "Mobile: photos", module: "mobile", description: "Phone app: take or pick shop photos for products, brands, groups and collections. A photo that makes a product shop-ready lists it, as the office photo save does." },
    { id: "mobile:inbox:view", label: "Mobile: inbox", module: "mobile", description: "Phone app: read and reply to customer WhatsApp messages and chats." },
    { id: "mobile:posts:share", label: "Mobile: posts", module: "mobile", description: "Phone app: see the posts waiting for WhatsApp Channel / Status, share each into WhatsApp and mark it done. The person must also be an admin of our WhatsApp Channel (or hold the company phone, for Status)." },

    // customers — Contacts (Person + Company) share ONE flat set. Contacts carry no
    // branch, so there is no radius to enforce: any branch may CRUD (gated only by
    // holding the write id). The old own/department/branch/org ladder and the
    // customers:manage umbrella are retired.
    { id: "customers:create", label: "Create customers", module: "customers", description: "Create Person / Company records." },
    { id: "customers:edit", label: "Edit customers", module: "customers", description: "Edit any Person / Company record (no branch limit)." },
    { id: "customers:delete", label: "Delete customers", module: "customers", description: "Delete any Person / Company record (no branch limit). Also carries the party's OPENING BALANCE on the Contacts profile — rewriting what a party owed before the books started moves real money the same way removing the party does, so the two ride one tick." },
    { id: "customers:view:creditors", label: "Show suppliers (creditors)", module: "customers", description: "Show suppliers (Sundry Creditors) in Contacts lists and voucher party dropdowns. Absent → browses customers (Sundry Debtors) only; suppliers filtered from both surfaces." },

    // admin
    { id: "settings:manage", label: "Manage org settings", module: "admin", description: "Organisation-wide settings — org defaults, payment methods, printer/QR/voucher templates, backups, downloads, imports." },
    { id: "settings:db:switch", label: "Switch primary database", module: "admin", description: "Settings → Backup & Restore → Databases: make staging (DB1 / DB2) the primary. Allowed only after a good nightly copy and before 8 AM, when both are the same. Separate from settings:manage because it moves every user, counter and service to another database." },
    { id: "settings:ai:manage", label: "Manage AI setup", module: "admin", description: "Settings → AI Setup — add, edit and test AI keys (Gemini / OpenAI / Claude) and choose which keys each AI use tries, in order. Separate from settings:manage because the page handles secret keys." },
    { id: "settings:tracking:manage", label: "Manage tracking codes", module: "admin", description: "Settings → Tracking Codes — Google Analytics, Tag Manager, Meta / TikTok Pixel ids and custom HTML loaded on the online shop. Separate from settings:manage because custom code runs on every shop page." },
    { id: "settings:app:manage", label: "Manage app settings", module: "admin", description: "Settings → App Settings — WhatsApp number ids (OTP / bills), WhatsApp Business Account id, OTP template, Meta app id. A saved value wins over .env. Secrets on the page need settings:app:secrets as well. Separate from settings:manage because a wrong number id stops every bill and login code." },
    { id: "settings:app:secrets", label: "Edit secrets in app settings", module: "admin", description: "Settings → App Settings — save, replace or clear tokens and passwords (WhatsApp token, Meta app secret, courier, payment and email keys). Stored locked with SCRAMBLE_KEY_SECRET, never shown back; a blank box uses Vercel / .env. Admin only." },
    { id: "settings:incoming:manage", label: "Manage Incoming API", module: "admin", description: "Settings → Incoming API: see, make, paste or remove the keys outside programs use to call in (Google Business API, cron-job.org, phone system, Shiprocket, WhatsApp webhook), switch a caller off, and set the Google Business API reply mode and rules. Separate from settings:manage because the page handles secret keys." },
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

    // hr — the staff record (HR & People → Staff Directory). View rides the HR
    // sidebar link; this one key gates every write: the profile (job, personal,
    // bank), salary revisions, and "mark as left". Self-edits of personal / bank
    // details on one's own profile page need no grant.
    { id: "hr:staff:edit", label: "Edit staff records", module: "hr", description: "Edit any staff member's HR profile (staff code, joining date, personal and bank details, salary structure) and mark them as left." },
    { id: "hr:attendance:edit", label: "Mark attendance", module: "hr", description: "Mark days on the attendance register from the office (the till marks its own sign-ins) and keep the holiday list." },
    { id: "hr:leave:approve", label: "Approve leave", module: "hr", description: "Approve or reject leave requests, and file leave on someone else's behalf. Anyone may file their own." },
    // Payroll — generate a month's run and post it as one journal voucher.
    // Separate from hr:staff:edit: a clerk may keep records without ever being
    // able to accrue a lakh of salary. Posting also needs the JOURNAL post gate.
    { id: "hr:payroll:run", label: "Run payroll", module: "hr", description: "Generate the monthly payroll run from every staff member's salary structure, and post it to the books as one journal voucher." },

    // finance — per-kind GL voucher gates (finance:voucher:<action>:<kind>). The
    // routes accept the per-kind key OR the generic key above. CANCEL covers
    // cancel + edit + convert-to-draft; DELETE is the single removal (soft-delete
    // retired 2026-06-09, "hard-delete" renamed to "delete"). Source of truth for
    // the kind↔permission mapping: src/shared/lib/auth/voucherMatrix.ts.
    { id: "finance:voucher:create:payment", label: "Create payment voucher", module: "finance", description: "Create a Payment voucher." },
    { id: "finance:voucher:post:payment", label: "Post payment voucher", module: "finance", description: "Post a Payment voucher (applies GL)." },
    { id: "finance:voucher:cancel:payment", label: "Cancel / edit payment voucher", module: "finance", description: "Cancel, edit, or convert-to-draft a Payment voucher." },
    { id: "finance:voucher:delete:payment", label: "Delete payment voucher", module: "finance", description: "Remove a Payment voucher (recoverable from the Recycle Bin)." },

    { id: "finance:voucher:create:receipt", label: "Create receipt voucher", module: "finance", description: "Create a Receipt voucher." },
    { id: "finance:voucher:post:receipt", label: "Post receipt voucher", module: "finance", description: "Post a Receipt voucher (applies GL)." },
    { id: "finance:voucher:cancel:receipt", label: "Cancel / edit receipt voucher", module: "finance", description: "Cancel, edit, or convert-to-draft a Receipt voucher." },
    { id: "finance:voucher:delete:receipt", label: "Delete receipt voucher", module: "finance", description: "Remove a Receipt voucher (recoverable from the Recycle Bin)." },

    { id: "finance:voucher:create:contra", label: "Create contra voucher", module: "finance", description: "Create a Contra voucher." },
    { id: "finance:voucher:post:contra", label: "Post contra voucher", module: "finance", description: "Post a Contra voucher (applies GL)." },
    { id: "finance:voucher:cancel:contra", label: "Cancel / edit contra voucher", module: "finance", description: "Cancel, edit, or convert-to-draft a Contra voucher." },
    { id: "finance:voucher:delete:contra", label: "Delete contra voucher", module: "finance", description: "Remove a Contra voucher (recoverable from the Recycle Bin)." },

    { id: "finance:voucher:create:credit-note", label: "Create credit note", module: "finance", description: "Create a Credit Note." },
    { id: "finance:voucher:post:credit-note", label: "Post credit note", module: "finance", description: "Post a Credit Note (applies GL)." },
    { id: "finance:voucher:cancel:credit-note", label: "Cancel / edit credit note", module: "finance", description: "Cancel, edit, or convert-to-draft a Credit Note." },
    { id: "finance:voucher:delete:credit-note", label: "Delete credit note", module: "finance", description: "Remove a Credit Note (recoverable from the Recycle Bin)." },

    { id: "finance:voucher:create:debit-note", label: "Create debit note", module: "finance", description: "Create a Debit Note." },
    { id: "finance:voucher:post:debit-note", label: "Post debit note", module: "finance", description: "Post a Debit Note (applies GL)." },
    { id: "finance:voucher:cancel:debit-note", label: "Cancel / edit debit note", module: "finance", description: "Cancel, edit, or convert-to-draft a Debit Note." },
    { id: "finance:voucher:delete:debit-note", label: "Delete debit note", module: "finance", description: "Remove a Debit Note (recoverable from the Recycle Bin)." },

    { id: "finance:voucher:create:journal", label: "Create journal voucher", module: "finance", description: "Create a Journal voucher (general GL adjustment)." },
    { id: "finance:voucher:post:journal", label: "Post journal voucher", module: "finance", description: "Post a Journal voucher (applies GL)." },
    { id: "finance:voucher:cancel:journal", label: "Cancel / edit journal voucher", module: "finance", description: "Cancel, edit, or convert-to-draft a Journal voucher." },
    { id: "finance:voucher:delete:journal", label: "Delete journal voucher", module: "finance", description: "Remove a Journal voucher (recoverable from the Recycle Bin)." },

    // inventory module pages — Products catalog + Masters (8 setup tables, gated
    // together). View rides the sidebar link; inventory:manage is the umbrella.
    { id: "products:create", label: "Create products", module: "inventory", description: "Add items to the product catalog." },
    { id: "products:edit", label: "Edit products", module: "inventory", description: "Edit product catalog items (non-tax fields; tax uses compliance:tax:edit)." },
    { id: "products:delete", label: "Delete products", module: "inventory", description: "Delete product catalog items." },
    { id: "inventory:masters:create", label: "Create inventory masters", module: "inventory", description: "Add brands, units, collections, groups, warranty terms, attributes, GST rates, and BOMs." },
    { id: "inventory:masters:edit", label: "Edit inventory masters", module: "inventory", description: "Edit the inventory setup/master tables." },
    { id: "inventory:masters:delete", label: "Delete inventory masters", module: "inventory", description: "Delete inventory setup/master records." },

    // pricing strategy — the day-to-day work needs NO key of its own: holding any
    // Pricing Strategy sidebar link is the permission (requireModuleAccess). The
    // single exception is Reset, which clears EVERY point in one click (base + all
    // brand/category/group/SKU) and reprices the whole catalogue — an accident, not
    // a job, so it keeps its own tick.
    { id: "pricing:strategy:reset", label: "Reset all strategy points", module: "inventory", description: "Clear every strategy point at once on the Pricing Strategy → Strategies page." },

    // ecommerce — Customize Home needs no key of its own: holding the link is the
    // permission. The one guard is the permanent FALLBACK sections (priority -1):
    // they are what the storefront shows whenever nothing else is scheduled, so
    // they stay locked unless the role holds this.
    { id: "ecommerce:fallback:unlock", label: "Unlock fallback sections", module: "ecommerce", description: "Show the Unlock button on E-Commerce → Customize Home, which opens every permanent fallback section at once to edit, move, switch off or delete, and to make a section a new fallback." },
    { id: "ecommerce:product:deep-edit", label: "Deep edit product (no tax / opening / sale price / SKU)", module: "ecommerce", description: "E-Commerce → Products → Edit → Deep edit: save the inventory product master without Inventory \"Edit products\". The Tax & opening tab is hidden, and SKU and Sale price are locked. It also allows changing the product's Group (shown in the shop as its Category), Brand and Collections on the E-Commerce product form." },

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
    { id: "pos:shift:open", label: "Open POS shift", module: "pos", description: "Open your own till session with an opening cash float." },
    { id: "pos:shift:close", label: "Close POS shift", module: "pos", description: "Declare physical cash count and hand over to manager (posts Contra)." },
    { id: "pos:shift:drop", label: "Record mid-shift cash drop", module: "pos", description: "Log cash dropped into the safe during an open shift." },
    { id: "pos:shift:force-close", label: "Force-close another's shift", module: "pos", description: "Emergency-close a stuck open shift on behalf of the operator (counts the drawer; closedBy = you)." },
    { id: "pos:upi-request:send", label: "Send UPI payment request", module: "pos", description: "Send the customer a WhatsApp from the shop's number with a Pay now button that opens their UPI app (Share UPI QR dialog)." },

    // accountancy
    { id: "compliance:tax:edit", label: "Change tax classification", module: "accountancy", description: "Edit GST rate, HSN code, and taxability on inventory items and product groups from the Tax Classification page." },
    { id: "accountancy:masters:create", label: "Create accounting masters", module: "accountancy", description: "Create account groups and GL ledgers (chart of accounts)." },
    { id: "accountancy:masters:edit", label: "Edit accounting masters", module: "accountancy", description: "Edit account groups and GL ledgers." },
    { id: "accountancy:masters:delete", label: "Delete accounting masters", module: "accountancy", description: "Delete account groups." },
    { id: "accountancy:reminders:send", label: "Send due reminder", module: "accountancy", description: "Send a WhatsApp + app due reminder to one customer from the Receivables report." },
    { id: "accountancy:reminders:send-all", label: "Send due reminder to all", module: "accountancy", description: "\"Send reminder to all\" on the Receivables report — messages every customer who owes, in one go." },

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

    // retention protection — blacklist products from discount engines.
    { id: "retention:protection:manage", label: "Manage product protection", module: "retention", description: "Add/remove products from the discount blacklist (protection)." },

    // campaigns — writing and saving a campaign opens on the sidebar link; sending
    // reaches every customer at once, so it is its own tick (wired in phase 2).
    { id: "campaigns:send", label: "Send campaigns", module: "campaigns", description: "Send a campaign to customers (app notification now, WhatsApp later). Writing and saving drafts rides the Campaigns sidebar link." },
    { id: "campaigns:google:connect", label: "Connect Google Business Profile", module: "campaigns", description: "Connect, change or disconnect the shop's Google Business Profile on Campaigns → Channels, so posts go to Google by themselves." },
    { id: "campaigns:facebook:connect", label: "Connect Facebook Page / Instagram", module: "campaigns", description: "Connect, change or disconnect the shop's Facebook Page (and the Instagram business account linked to it) on Campaigns → Channels, so posts go to Facebook and Instagram by themselves." },
    { id: "campaigns:consent:edit", label: "Re-subscribe an email", module: "campaigns", description: "On Campaigns → Consent, take an address off the email unsubscribe list — only when the customer asks to get offer emails again." },


    // repair — the ticket resource (All Repair list + ticket page). View rides the
    // repair sidebar link; these gate the create / edit / delete actions on a ticket.
    { id: "tickets:create", label: "Create tickets", module: "repair", description: "Open new repair tickets (the Repair + intake)." },
    { id: "tickets:edit", label: "Edit tickets", module: "repair", description: "Edit a repair ticket's device, problem, priority, cost and notes." },
    { id: "tickets:delete", label: "Delete tickets", module: "repair", description: "Delete a repair ticket." },

    // crm / administration — the deal and internal-task resources, same flat
    // create / edit / delete shape as tickets (no branch radius). View rides the
    // Deals / Work Board sidebar link; these gate the actions on the record.
    { id: "deals:create", label: "Create deals", module: "crm", description: "Add a deal to the CRM pipeline (the New Deal + quick action)." },
    { id: "deals:edit", label: "Edit deals", module: "crm", description: "Edit a deal's title, value, source, priority, owner and follow-up; move it between pipeline stages." },
    { id: "deals:delete", label: "Delete deals", module: "crm", description: "Delete a deal from the CRM pipeline." },
    { id: "messages:reply", label: "Reply to customer messages", module: "crm", description: "Send a WhatsApp reply from CRM → Messages (only within 24 hours of the customer's last message). Viewing rides the Messages sidebar link." },
    { id: "reviews:reply", label: "Reply to reviews", module: "crm", description: "Write, change or remove the shop's public reply to a Google review from CRM → Reviews, and refresh the list from Google. Viewing rides the Reviews sidebar link." },
    { id: "tasks:create", label: "Create tasks", module: "administration", description: "Add an internal work item on the Administration board (the New Task + quick action)." },
    { id: "tasks:edit", label: "Edit tasks", module: "administration", description: "Edit an internal work item's title, description, category, priority, assignee and due date; move it between stages." },
    { id: "tasks:delete", label: "Delete tasks", module: "administration", description: "Delete an internal work item from the Administration board." },

    // help — the front-desk enquiry ticket (Help Desk board + POS counter Enquiry
    // button). View rides the help sidebar link; these gate create / edit / delete
    // (incl. advise, close-with-outcome, and convert to a repair / deal).
    { id: "help:create", label: "Create help tickets", module: "help", description: "Log a front-desk enquiry (the New Help + quick action and the POS counter Enquiry button)." },
    { id: "help:edit", label: "Edit help tickets", module: "help", description: "Advise, move stage, close with an outcome, and convert a help ticket into a repair / deal / sale." },
    { id: "help:delete", label: "Delete help tickets", module: "help", description: "Delete a help ticket." },
    { id: "quick-actions:more", label: "Show More + quick action", module: "core", description: "Show the More + button in the Quick Actions bar (opens the all-create-actions dialog)." },
];
