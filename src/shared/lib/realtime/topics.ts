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
    | "chat";       // a new DM room came into existence (messages ride their own broadcast)

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
    [/^\/api\/pos\/(shifts|cash-movements|handovers|till-ledger)/, ["ledger"]],
    [/^\/api\/gift-cards/,                          ["ledger"]],
    [/^\/api\/refunds/,                             ["ledger"]],
    [/^\/api\/loyalty\//,                           ["ledger"]],
    [/^\/api\/(ecommerce|shop)\/orders/,            ["ledger", "stock"]],
    [/^\/api\/orders\//,                            ["ledger"]],
    // A restore rewrites everything; an audit restore can bring a voucher back.
    [/^\/api\/audit\//,                             ["ledger", "stock"]],

    // ── Stock & catalogue ────────────────────────────────────────────────────
    [/^\/api\/inventory\/products/,                 ["stock", "catalogue"]],
    [/^\/api\/inventory\/(brands|categories|masters|attribute-masters|units|product-groups|gst-rates|boms|warranty-terms|naming-config)/, ["catalogue"]],
    [/^\/api\/pricing-strategy\//,                  ["catalogue"]],
    [/^\/api\/coupons/,                             ["catalogue"]],
    [/^\/api\/(ecommerce|shop)\/products/,          ["catalogue"]],
    [/^\/api\/pos\/services/,                       ["catalogue"]],

    // ── Work pipeline ────────────────────────────────────────────────────────
    [/^\/api\/(tickets|works|workers|work-groups|pipelines|ticket-statuses|help|deals|deliveries|calls|priorities)/, ["tickets"]],

    // ── Customers ────────────────────────────────────────────────────────────
    [/^\/api\/(person|companies|contacts|customer-tools|customer-tiers|customer-tier-periods|customer-quality|crm)/, ["parties"]],

    // ── Desk clutter ─────────────────────────────────────────────────────────
    [/^\/api\/(admin-tasks|admin-task-recurrences|quick-notes|quick-log|notifications|wall-posts)/, ["tasks"]],

    // ── Configuration ────────────────────────────────────────────────────────
    [/^\/api\/(settings|roles|permissions|users|positions|departments|branches|org-chart|service-centers)/, ["settings"]],

    // ── Chat room discovery ──────────────────────────────────────────────────
    // A new message riding an existing room delivers over its OWN "room:<id>"
    // broadcast (see GlobalInboxListener) — that only needs a topic here for the
    // FIRST message of a brand new DM, which mints the room this path creates.
    [/^\/api\/inbox\/direct/,                       ["chat"]],
];

/**
 * Topics a successful write to `pathname` should announce.
 *
 * `pathname` must be a PATH — no origin, no query string. Returns an empty array
 * for anything unlisted, which the publisher reads as "say nothing".
 */
export function topicsForApiPath(pathname: string): Topic[] {
    const hit = new Set<Topic>();
    for (const [re, topics] of RULES) {
        if (re.test(pathname)) for (const t of topics) hit.add(t);
    }
    return [...hit];
}
