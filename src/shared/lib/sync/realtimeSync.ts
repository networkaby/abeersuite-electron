import { supabase } from "@/shared/lib/supabase/supabaseClient";
import { getCounterInstallationId } from "@/shared/lib/bridge/bridgeHealth";
import type { SyncBroadcastEvent } from "./types";

const SYNC_CHANNEL_NAME = "abeersuite:sync-events";
const BROADCAST_EVENT_TYPE = "table_mutation";

let currentChannel: ReturnType<typeof supabase.channel> | null = null;
const eventListeners: Set<(event: SyncBroadcastEvent) => void> = new Set();
let cachedOriginId: string | null = null;

async function getLocalOriginId(): Promise<string> {
    if (cachedOriginId) return cachedOriginId;
    const counterId = await getCounterInstallationId();
    cachedOriginId = counterId || `WEB-${typeof window !== "undefined" ? window.crypto.randomUUID() : "server"}`;
    return cachedOriginId;
}

/**
 * Initializes and subscribes to the shared Supabase Realtime broadcast channel.
 */
export function initRealtimeSync(): void {
    if (currentChannel) return;

    currentChannel = supabase.channel(SYNC_CHANNEL_NAME, {
        config: {
            broadcast: { self: false }, // don't receive self-emitted events
        },
    });

    currentChannel
        .on("broadcast", { event: BROADCAST_EVENT_TYPE }, (payload) => {
            const data = payload.payload as SyncBroadcastEvent;
            if (!data || typeof data.n !== "number") return;

            // Notify all registered listener hooks
            eventListeners.forEach((listener) => {
                try {
                    listener(data);
                } catch (err) {
                    console.error("[RealtimeSync] Listener error:", err);
                }
            });
        })
        .subscribe((status) => {
            if (status === "SUBSCRIBED") {
                console.log("[RealtimeSync] Subscribed to real-time mutation channel");
            }
        });
}

/**
 * Registers a listener to be notified when a table mutation event arrives.
 * Returns an unsubscribe function.
 */
export function subscribeToSyncEvents(onEvent: (event: SyncBroadcastEvent) => void): () => void {
    initRealtimeSync();
    eventListeners.add(onEvent);
    return () => {
        eventListeners.delete(onEvent);
    };
}

/**
 * Broadcasts a table mutation event to all active terminals via Supabase Realtime.
 */
export async function broadcastTableMutation(
    tableNumber: number,
    action: "UPSERT" | "DELETE" = "UPSERT",
    key?: string | number,
    timestamp?: string
): Promise<void> {
    if (!currentChannel) {
        initRealtimeSync();
    }

    const originId = await getLocalOriginId();
    const eventPayload: SyncBroadcastEvent = {
        n: tableNumber,
        ts: timestamp || new Date().toISOString(),
        originId,
        action,
        key,
    };

    try {
        await currentChannel?.send({
            type: "broadcast",
            event: BROADCAST_EVENT_TYPE,
            payload: eventPayload,
        });
    } catch (err) {
        console.warn("[RealtimeSync] Broadcast failed (will sync via standard delta):", err);
    }
}
