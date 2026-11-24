/**
 * Change topics — the vocabulary of "something moved over there".
 *
 * A topic is a COARSE domain bucket, not a table name. The whole point of the
 * signal is that it carries nothing but "these buckets changed, at this time":
 * every screen re-reads its own endpoint with its own filters and its own
 * permissions, so the wire never carries a row, an amount or a party name. That
 * is also what makes the transport swappable — the same `{ topics, at }` payload
 * can arrive from Supabase Realtime today and from our own VM socket later
 * without a single listener changing.
 *
 * Topics are derived from the API path a mutation was sent to, so a new write
 * route starts signalling the moment its prefix is listed below — no call site
 * has to remember to fire anything. A path that matches nothing signals nothing,
 * which is deliberate: silence is cheaper than noise, and adding a rule here is
 * a one-line change when a surface turns out to want it.
 */

export type Topic =
    | "ledger"      // vouchers, journals, payments — anything that writes the books
    | "stock"       // stock ledger + the product/branch caches on top of it
    | "tickets"     // the work pipeline: tickets, works, workers, deals, help
    | "parties"     // customers: person, company, contacts, tiers
    | "catalogue"   // products, brands, categories, pricing, coupons
    | "tasks"       // admin tasks, notes, notifications, wall posts
    | "settings"    // org config, users, roles, positions, branches
    | "chat"        // a new DM room came into existence (messages ride their own broadcast)
    | "messages";   // customer messages (WhatsApp …) + their ticks — CRM → Messages only.
                    // Kept off "chat" so a customer reply never wakes every tab's team inbox.

/**
 * Every topic, for a publisher that genuinely cannot narrow it down.
 *
 * The only caller is the outbox flusher: it announces after a counter's rows reach
 * Supabase, and all it has at that point is table names from `_outbox`. Mapping those
 * back to topics would mean a second hand-maintained map, which is exactly how the sync
 * worker's own topic map rotted to 60-of-113 coverage before it was deleted. Announcing
 * everything cannot rot, and the cost is bounded: pushes are debounced and batched, and
 * a counter's writes are overwhelmingly ledger/stock, which is what the busiest screens
 * subscribe to anyway.
 */
export const ALL_TOPICS: readonly Topic[] = [
    "ledger", "stock", "tickets", "parties", "catalogue", "tasks", "settings", "chat", "messages",
];

/**
 * Path prefix → topics. First match wins per rule; ALL matching rules
 * contribute, so `/api/inventory/vouchers/12/post` yields both ledger and stock.
 *
 * Ordering is irrelevant — every rule is tested and the results unioned.
 */
const RULES: ReadonlyArray<readonly [RegExp, readonly Topic[]]> = [
    // ── Books ────────────────────────────────────────────────────────────────
    [/^\/api\/accountancy\//,                       ["ledger"]],
    [/^\/api\/inventory\/vouchers/,                 ["ledger", "stock"]],
    [/^\/api\/pos\/(sale|return|estimate|order)/,   ["ledger", "stock"]],
    [/^\/api\/pos\/(shifts|cash-movements|till-ledger)/,  ["ledger"]],
    [/^\/api\/gift-cards/,                          ["ledger"]],
    [/^\/api\/refunds/,                             ["ledger"]],
    [/^\/api\/loyalty\//,                           ["ledger"]],
    [/^\/api\/(ecommerce|shop)\/orders/,            ["ledger", "stock"]],
    [/^\/api\/orders\//,                            ["ledger"]],
    [/^\/api\/accounts/,                            ["ledger"]],
    [/^\/api\/pos\/(coupon-offers|coupon-validate|gift-card-lookup)/, ["ledger"]],
    [/^\/api\/retention/,                           ["ledger"]],
    [/^\/api\/bi\/gst-purchase-planning/,           ["ledger"]],
    // A restore rewrites everything; an audit restore can bring a voucher back.
    [/^\/api\/audit\//,                             ["ledger", "stock"]],

    // ── Stock & catalogue ────────────────────────────────────────────────────
    [/^\/api\/inventory\/products/,                 ["stock", "catalogue"]],
    [/^\/api\/inventory\/(brands|categories|masters|attribute-masters|units|product-groups|gst-rates|boms|warranty-terms|naming-config)/, ["catalogue"]],
    [/^\/api\/pricing-strategy\//,                  ["catalogue"]],
    // Group pricing writes CustomerGroup + its price rules (a child set).
    [/^\/api\/pricing-strategy\/group-pricing/,      ["parties"]],
    [/^\/api\/coupons/,                             ["catalogue"]],
    [/^\/api\/(ecommerce|shop)\/products/,          ["catalogue"]],
    [/^\/api\/pos\/services/,                       ["catalogue"]],
    [/^\/api\/ecommerce\/(home-layout|publish-rules|stock-policy|ads)/, ["catalogue"]],
    // The phone app's Photos screen: a product's gallery or a brand/group/category image.
    [/^\/api\/mobile\/photos\/(product|master)\//,  ["catalogue"]],

    // ── Work pipeline ────────────────────────────────────────────────────────
    [/^\/api\/(tickets|works|workers|work-groups|pipelines|ticket-statuses|help|deals|deliveries|calls|priorities)/, ["tickets"]],
    // Courier webhooks move a ticket's stage and mirror it onto the order.
    [/^\/api\/shop\/(delivery-updates|shipway-updates)/, ["tickets", "ledger"]],

    // ── Customers ────────────────────────────────────────────────────────────
    [/^\/api\/(person|companies|contacts|customer-tiers|customer-tier-periods|customer-quality|crm)/, ["parties"]],
    // A convert or merge re-points the party's bills, tickets and CRM notes as
    // well as the party rows, so every screen showing those follows it too.
    [/^\/api\/customer-tools/,                      ["parties", "ledger", "tickets"]],

    // ── Desk clutter ─────────────────────────────────────────────────────────
    [/^\/api\/(admin-tasks|admin-task-recurrences|quick-notes|quick-log|notifications|wall-posts)/, ["tasks"]],
    // An admin task IS a Ticket row — same model, admin pipeline — so a write here
    // moves the tickets bucket as much as `/api/tickets` does. Saying only "tasks"
    // left the two surfaces that watch Ticket rows deaf to it: the Work Board (every
    // board on `useTicketsDelta` listens on "tickets") and the sidebar badges (they
    // count `prisma.ticket`). Both then showed a task moved on another machine only
    // after a manual Refresh — or, on a counter, whenever its sync worker happened to
    // pull anything at all, which is why the till looked live and the web looked stuck.
    [/^\/api\/admin-tasks/,                         ["tickets"]],

    // Imports live under /api/settings but write master data: products (+ opening
    // stock) and customers (+ opening balances), so they wake those screens too.
    [/^\/api\/settings\/item-import\/commit/,         ["catalogue", "stock"]],
    [/^\/api\/settings\/customer-import\/commit/,     ["parties", "ledger"]],

    // ── Configuration ────────────────────────────────────────────────────────
    // Matched by ADDRESS, not by what a route writes: a route under /api/settings that
    // writes master data (products, customers, books) needs its own rule ABOVE this
    // one, like the imports, or it announces only "settings" and those screens stay stale.
    [/^\/api\/(settings|roles|permissions|users|positions|departments|branches|org-chart)/, ["settings"]],
    // HR & People — the staff record is org config like users and positions.
    [/^\/api\/hr\//,                                 ["settings"]],
    [/^\/api\/pos\/counters/,                       ["settings"]],
    [/^\/api\/due-reminders/,                       ["settings"]],
    // Campaigns are office-written messages, not books or parties; the list follows "settings".
    [/^\/api\/campaigns/,                           ["settings"]],

    // ── Chat room discovery ──────────────────────────────────────────────────
    // A new message riding an existing room delivers over its OWN "room:<id>"
    // broadcast (see GlobalInboxListener) — that only needs a topic here for the
    // FIRST message of a brand new DM, which mints the room this path creates.
    [/^\/api\/inbox\/direct/,                       ["chat"]],
    [/^\/api\/inbox\/rooms/,                        ["chat"]],
    [/^\/api\/messages/,                            ["messages"]],
];

/** True when `t` is one of our topic names — for checking a body from the wire. */
export function isTopic(t: unknown): t is Topic {
    return (ALL_TOPICS as readonly unknown[]).includes(t);
}

/** POSTs that only COMPUTE (a dry run before a commit) and write nothing. Their prefix
 *  rule would otherwise announce, waking every screen for a change that never happened. */
const READ_ONLY_POST = /preview$/;

/**
 * Topics a successful write to `pathname` should announce.
 *
 * `pathname` must be a PATH — no origin, no query string. Returns an empty array
 * for anything unlisted, which the publisher reads as "say nothing".
 */
export function topicsForApiPath(pathname: string): Topic[] {
    if (READ_ONLY_POST.test(pathname)) return [];
    const hit = new Set<Topic>();
    for (const [re, topics] of RULES) {
        if (re.test(pathname)) for (const t of topics) hit.add(t);
    }
    return [...hit];
}

/**
 * Topic → the Prisma models a screen re-reads right after a write to that topic.
 *
 * Consumed by ONE caller: the `WRITE_MODE=v_live` write relay
 * (shared/lib/counter/writeRelay.ts), which asks the sync worker to pull exactly these
 * before it releases the response, so the screen that refetches after a save finds the
 * new rows in the replica. Names are `prisma/sync-tables.json` model names; a `child`
 * table comes along with its parent, so only parents are listed.
 *
 * This is NOT the worker's old topic map, which silently NARROWED what a signal synced
 * and rotted to 60-of-113 coverage. A model missing here degrades softly: the browser's
 * own change signal makes the worker pull everything a moment later, exactly as it does
 * today. So the list only has to name what a screen shows immediately after its own
 * save — and adding one line here is the whole fix when a screen turns out to lag.
 */
export const TOPIC_MODELS: Readonly<Record<Topic, readonly string[]>> = {
    ledger: [
        "UniversalVoucher", "VoucherDetail", "VoucherAllocation", "VoucherSeries", "VoucherSeriesCounter",
        "Account", "PosShift", "PosHandover", "GiftCard", "LoyaltyAccount", "CouponRedemption",
        "RedemptionHold", "AdditionalCostAllocation", "AuditLog",
        "BankStatementImport", "BankStatementLine", "BankStatementMatch",
    ],
    stock: ["InvProduct", "InvProductBranch", "UniversalVoucher"],
    tickets: [
        "Ticket", "TicketLog", "TicketWorker", "TicketStatus", "StatusTransition", "Work", "WorkGroup",
        "WorkGroupWork", "Pipeline", "Call", "DeliveryMethod",
    ],
    parties: [
        "Person", "Company", "PersonCompany", "Phone", "Email", "SocialConnection", "CustomerGroup",
        "CustomerTier", "CustomerTierPeriod", "CreditLimitConfig", "Account",
    ],
    catalogue: [
        "InvProduct", "InvBrand", "InvCategory", "InvProductGroup", "InvAttributeMaster", "InvUnit",
        "InvBom", "InvWarrantyTerm", "InvNamingConfig", "GstRate", "Coupon", "CouponConfig",
        "StrategyPoint", "PosService", "LoyaltyConfig", "LoyaltyEarnRule", "LoyaltyMilestone",
    ],
    tasks: ["TaskRecurrence", "WallPost", "User"],
    settings: [
        "OrgDefaults", "BooksConfig", "Branch", "Department", "DepartmentPermission", "Role",
        "RolePermission", "Permission", "Position", "User", "UserPermission", "UserPosition",
        "PosCounter", "PaymentGateway", "AccountGroup", "OfflinePolicy", "BackupConfig",
        "VoucherPrintTemplate", "VoucherSeries", "Device", "CustomerGroup",
        "CreditLimitConfig", "StaffProfile", "StaffSalary", "AiKey", "AiChainStep",
    ],
    chat: ["ChatRoom", "ChatRoomMember"],
    messages: ["Message", "MessageClaim"],
};

/** The union of `TOPIC_MODELS` for `topics`, de-duplicated. */
export function modelsForTopics(topics: readonly Topic[]): string[] {
    const out = new Set<string>();
    for (const t of topics) for (const m of TOPIC_MODELS[t]) out.add(m);
    return [...out];
}
