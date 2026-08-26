"use strict";

/**
 * Listens on the app's own change channel so a sync fires when something actually
 * changes, instead of on a timer.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * Polling every table on a schedule is the expensive way to notice a change, and
 * egress is the whole reason this project exists. The app ALREADY broadcasts a
 * signal on every successful write, and the counter and the office share one
 * Supabase Realtime channel -- so when office staff post a purchase on Vercel, this
 * worker can hear about it for free and sync only the topics that moved.
 *
 * ── The signal is a HINT, never the source of truth ──────────────────────────
 * It is published by an axios response interceptor running IN A BROWSER
 * (src/shared/lib/realtime/appChannel.ts). A write made by a script, a seed, a
 * GitHub-Actions restore, or a browser whose publish failed emits nothing at all.
 * Treating it as authoritative would mean silently missing those changes forever.
 *
 * So: the signal only ever makes a sync happen SOONER. Correctness comes from the
 * watermarks and the reconcile pass, which run on their own schedule regardless of
 * whether a single signal is ever received.
 *
 * Payload is `{ topics, at }` and nothing else -- never a row -- so a forged or
 * duplicated message costs a wasted sync and can leak nothing.
 */

const { createClient } = require("@supabase/supabase-js");

/** Must match src/shared/lib/realtime/channel.ts in the app. */
const CHANNEL = "app:changes";
const EVENT = "changed";

/**
 * Wait this long after a signal before syncing.
 *
 * One user action is several requests (save, then re-read, then a badge refresh),
 * each announcing itself. Without a settle window the worker would run a cycle per
 * request rather than per change.
 */
const SETTLE_MS = 750;

/**
 * Coarse topics the app publishes, expanded to the tables they cover.
 *
 * The expansion lives HERE, not on the wire. The publisher derives its topic from
 * the API path and has no idea which tables a route touched; making it emit table
 * names would mean hand-maintaining a path-to-tables map across 335 routes, and that
 * map would rot silently the first time a route changed what it writes.
 *
 * An unknown topic falls back to syncing everything, which is the safe direction:
 * over-syncing costs a cycle, under-syncing loses data.
 */
const TOPIC_MODELS = {
    ledger: [
        "UniversalVoucher", "VoucherDetail", "VoucherAllocation", "Account",
        "AccountGroup", "VoucherSeries", "PosShift", "PosHandover", "LoyaltyAccount",
        "LoyaltyLedger", "GiftCard", "CouponRedemption", "AuditLog",
    ],
    stock: ["InvProduct", "InvStockLedger", "InvProductBranch", "Device"],
    catalogue: [
        "InvProduct", "InvBrand", "InvCategory", "InvProductGroup", "InvUnit",
        "GstRate", "Coupon", "PosService", "StrategyPoint",
    ],
    tickets: ["Ticket", "TicketLog", "TicketStatus", "Work", "WorkGroup", "TicketWorker", "Call"],
    parties: ["Person", "Company", "Phone", "Email", "PersonCompany", "CustomerGroup"],
    tasks: ["QuickNote", "WallPost"],
    settings: [
        "User", "Role", "Permission", "RolePermission", "Position", "Department",
        "Branch", "OrgDefaults", "PosCounter", "ServiceCenter",
    ],
    chat: ["ChatRoom", "ChatMessage", "ChatRoomMember"],
};

/**
 * Models a set of topics implies. Unknown topic => null, meaning "sync everything".
 * @returns {string[] | null}
 */
function modelsForTopics(topics) {
    if (!Array.isArray(topics) || topics.length === 0) return null;
    const out = new Set();
    for (const t of topics) {
        const models = TOPIC_MODELS[t];
        if (!models) return null; // unknown topic: do not guess, sync it all
        for (const m of models) out.add(m);
    }
    return [...out];
}

/**
 * Subscribe and call `onChange(models | null)` after each settled burst.
 *
 * Returns a stop function. Never throws: Realtime being unavailable must degrade to
 * "sync on the timer only", not take the worker down -- the timer is what makes the
 * signal optional in the first place.
 */
function listen(cfg, onChange, log) {
    const url = cfg.supabaseUrl;
    const key = cfg.supabaseAnonKey;
    if (!url || !key) {
        log("realtime: not configured (supabaseUrl / supabaseAnonKey absent) - timer only");
        return () => {};
    }

    let timer = null;
    let pending = new Set();
    let pendingAll = false;
    let client;

    try {
        client = createClient(url, key, { auth: { persistSession: false } });
    } catch (e) {
        log(`realtime: could not create client (${e.message}) - timer only`);
        return () => {};
    }

    const flush = () => {
        timer = null;
        const models = pendingAll ? null : [...pending];
        pending = new Set();
        pendingAll = false;
        try {
            onChange(models);
        } catch (e) {
            log(`realtime: sync from signal failed: ${e.message}`);
        }
    };

    const channel = client.channel(CHANNEL);
    channel.on("broadcast", { event: EVENT }, (msg) => {
        const models = modelsForTopics(msg && msg.payload && msg.payload.topics);
        if (models === null) pendingAll = true;
        else for (const m of models) pending.add(m);

        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, SETTLE_MS);
    });

    channel.subscribe((status) => {
        if (status === "SUBSCRIBED") log(`realtime: listening on ${CHANNEL}`);
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            // supabase-js retries on its own; say so once rather than every attempt.
            log(`realtime: ${status} - will keep retrying, timer still covers us`);
        }
    });

    return () => {
        if (timer) clearTimeout(timer);
        try { client.removeChannel(channel); } catch { /* shutting down anyway */ }
    };
}

/**
 * Names in TOPIC_MODELS that no longer exist in the registry.
 *
 * The map is hand-maintained, so a renamed or dropped model would leave a dead entry
 * that quietly narrows what a signal syncs -- no error, just a topic that stops
 * covering the table it was meant to. Checked at startup instead.
 */
function staleModels(registryTables) {
    const known = new Set(Object.keys(registryTables));
    const bad = [];
    for (const [topic, models] of Object.entries(TOPIC_MODELS)) {
        for (const m of models) if (!known.has(m)) bad.push(`${topic} -> ${m}`);
    }
    return bad;
}

module.exports = { listen, modelsForTopics, staleModels, TOPIC_MODELS, CHANNEL, EVENT, SETTLE_MS };
