import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser realtime client — follows the PRIMARY database (DB1 / DB2).
 *
 * Every tab that listens and every server that publishes must sit on the same Supabase
 * project, so realtime moves with the primary on a switch (owner, 2026-11-17: two
 * projects, so one free realtime quota running out does not stop updates for good).
 *
 *   NEXT_PUBLIC_SUPABASE_URL_1 / _PUBLISHABLE_KEY_1   — DB1's project
 *   NEXT_PUBLIC_SUPABASE_URL_2 / _PUBLISHABLE_KEY_2   — DB2's project
 *
 * Both pairs are public and baked into the bundle (spelled out literally so Next inlines
 * them). A page asks `/api/realtime/project` ONCE which one is primary and keeps that
 * answer for its lifetime, so a channel is always removed from the client that made it.
 * A tab left open across a night switch stays on the old project until reloaded; its
 * screens then follow the 5-minute heartbeat instead of instant nudges.
 *
 * Callers that open a channel await `realtimeReady` first.
 */

type RtId = "DB1" | "DB2";

const PAIRS: Record<RtId, { url?: string; key?: string }> = {
    DB1: {
        url: process.env.NEXT_PUBLIC_SUPABASE_URL_1,
        key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY_1,
    },
    DB2: {
        url: process.env.NEXT_PUBLIC_SUPABASE_URL_2,
        key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY_2,
    },
};

const hasDb2 = !!(PAIRS.DB2.url && PAIRS.DB2.key);
let chosen: RtId = "DB1";
const clients: Partial<Record<RtId, SupabaseClient>> = {};
// A counter's own pair, handed over by the office at start (never the bundle's baked one).
let handed: { url: string; key: string } | null = null;
let handedClient: SupabaseClient | null = null;

function client(): SupabaseClient {
    if (handed) return (handedClient ??= createClient(handed.url, handed.key));
    const id = chosen === "DB2" && hasDb2 ? "DB2" : "DB1";
    return (clients[id] ??= createClient(PAIRS[id].url!, PAIRS[id].key!));
}

/** A counter window (Electron shell) — it asks its local server for the office's pair. */
const isCounterWindow = () =>
    typeof window !== "undefined" && !!(window as { electronAPI?: unknown }).electronAPI;

/** Resolves once this page knows the primary's project. Never rejects (DB1 on any error). */
export const realtimeReady: Promise<void> =
    typeof window === "undefined" || (!hasDb2 && !isCounterWindow())
        ? Promise.resolve()
        : fetch("/api/realtime/project", { cache: "no-store" })
              .then((r) => (r.ok ? (r.json() as Promise<{ primary?: string; url?: string; key?: string }>) : null))
              .then((j) => {
                  if (j?.primary === "DB2") chosen = "DB2";
                  if (j?.url && j?.key) handed = { url: j.url, key: j.key };
              })
              .catch(() => {});

/** Which project this page uses — for the Settings card. */
export function realtimeProject(): RtId {
    return chosen === "DB2" && hasDb2 ? "DB2" : "DB1";
}

/** The client for the primary's project. Await `realtimeReady` before opening a channel. */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
    get(_t, prop) {
        const c = client();
        const v = Reflect.get(c, prop, c);
        return typeof v === "function" ? v.bind(c) : v;
    },
});
