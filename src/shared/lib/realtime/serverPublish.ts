/**
 * Server-side counterpart to `publishChange` in `appChannel.ts`, for the rare
 * write that reaches the database WITHOUT going through this app's own
 * browser — the epbx-bridge posting straight to `/api/calls` from the counter
 * PC's own process (see that route's POST handler doc). Every other write
 * publishes for free via `attachChangePublisher`'s axios interceptor; reach
 * for this only when a mutation genuinely bypasses the browser.
 *
 * Same channel, same event, same `{ topics, at }` payload as the browser side
 * (see `channel.ts`), so every open tab's `useRealtimeTopics` — the counter
 * call follow-up popup included — reacts identically regardless of which side
 * published, instead of waiting on that surface's fallback poll.
 *
 * Connects, sends, and drops the socket again immediately: a one-off
 * announcement, not a listener, so this never holds a connection open the way
 * the browser leader's LISTEN socket does.
 */
import { createClient } from "@supabase/supabase-js";
import { CHANGE_CHANNEL_NAME, CHANGE_EVENT_NAME } from "./channel";
import type { Topic } from "./topics";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const JOIN_TIMEOUT_MS = 5_000;

/** Best-effort — a missed nudge costs nothing but the surface falling back to
 *  its own poll, so a failure here must never break the caller's request. */
export async function publishChangeServer(topics: readonly Topic[]): Promise<void> {
    if (topics.length === 0) return;
    const client = createClient(url, key);
    const channel = client.channel(CHANGE_CHANNEL_NAME);
    try {
        await new Promise<void>((resolve) => {
            channel.subscribe((status) => { if (status === "SUBSCRIBED") resolve(); });
            setTimeout(resolve, JOIN_TIMEOUT_MS);
        });
        await channel.send({
            type: "broadcast",
            event: CHANGE_EVENT_NAME,
            payload: { topics, at: new Date().toISOString() },
        });
    } catch {
        /* best-effort */
    } finally {
        void client.removeChannel(channel);
    }
}
