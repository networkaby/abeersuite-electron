"use client";

/**
 * Both directions of this counter's sync, for the shell badge.
 *
 * Was `useOutboxStatus`, which reported only the push side. The name changed with
 * the scope: a badge that says "Synced" while the replica underneath it has
 * stopped receiving is worse than no badge, because people believe it.
 *
 * Three sources, each answering something the others cannot:
 *
 *  1. `/api/sync/status` — the outbox counts (did MY writes leave) and the
 *     replica's own health (has it ever synced these tables, is anything
 *     failing). Polled, because both are slow-moving facts.
 *  2. `app:changes` — somebody elsewhere saved something. This is the ONLY
 *     signal that a download is owed; the replica cannot know it without
 *     asking Supabase. Coarse by design: topics are 8 domain buckets, never
 *     table names (see realtime/topics.ts).
 *  3. `__SYNC_APPLIED__` via `syncApplied.ts` — the worker reporting that
 *     pulled rows are committed and queryable. Clears (2).
 */

import { useEffect, useState, useRef } from "react";
import axios from "axios";
import { onChangeSignal } from "@/shared/lib/realtime/appChannel";
import { ensureSyncAppliedBridge, SYNC_APPLIED_EVENT } from "@/shared/lib/realtime/syncApplied";
import type { Topic } from "@/shared/lib/realtime/topics";

/** The replica's account of itself. Mirrors `ReplicaLagResult`. */
export type ReplicaHealth = {
    neverSynced: string[];
    failing: string[];
    lastCycleAt: string | null;
    ready: boolean;
    tablesSynced: number;
    tablesTotal: number;
};

/** Mirror of the JSON shape returned by /api/sync/status. */
export type ApiSyncStatus = {
    isCounter: boolean;
    /** Captured writes not yet pushed, excluding dead-lettered ones. */
    pending: number;
    /** DEAD-LETTERED writes: given up on, and the one state needing a human. */
    failed: number;
    /** Pending writes that have failed at least once and are backing off. */
    retrying: number;
    lastSyncedAt: string | null;
    /** Null off a counter PC, where there is no replica to describe. */
    replica: ReplicaHealth | null;
};

/**
 * What the hook returns: the polled shape plus the live download claim, which is
 * browser-only state and never comes back from the server.
 */
export type SyncStatus = ApiSyncStatus & {
    /** Topics announced since the worker last confirmed a commit. Empty when idle. */
    downloading: Topic[];
};

/** Same cadence as useCounterMode — see that hook for the reasoning. */
const POLL_MS = 10_000;

/**
 * How long a "download owed" claim may stand without the worker confirming it.
 *
 * `__SYNC_APPLIED__` is SILENT when a cycle pulled nothing (sync-once.js only
 * prints it for `pulledTotal > 0`), and a signal often describes a change this
 * counter already has — someone re-saving a row it pulled a minute ago. Without a
 * cap those cases would pin the badge to "Downloading" permanently, which is
 * exactly the kind of indicator that teaches people to ignore indicators.
 *
 * Generous rather than tight: a cycle settles 750ms and then scans every
 * registered table, so a slow one takes seconds. This is a backstop for the
 * silent case, not the normal clear path.
 */
const DOWNLOAD_CLAIM_TTL_MS = 30_000;

export function useSyncStatus(): SyncStatus | null {
    const [status, setStatus] = useState<ApiSyncStatus | null>(null);
    const [downloading, setDownloading] = useState<Topic[]>([]);
    /** Latest isCounter, read inside listeners without resubscribing them. */
    const isCounterRef = useRef(false);

    useEffect(() => {
        let cancelled = false;

        const read = async () => {
            try {
                const { data } = await axios.get<ApiSyncStatus>("/api/sync/status");
                if (cancelled) return;
                isCounterRef.current = data.isCounter;
                setStatus(data);
            } catch {
                // Leave the last known status in place rather than flashing "unknown".
            }
        };

        void read();
        const timer = setInterval(() => void read(), POLL_MS);
        const onVisible = () => {
            if (document.visibilityState === "visible") void read();
        };
        document.addEventListener("visibilitychange", onVisible);

        return () => {
            cancelled = true;
            clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, []);

    // ── The transient "a download is owed" window ────────────────────────────
    // Only meaningful where a worker exists to owe it: off a counter the browser
    // reads Supabase directly, so there is no replica to be behind and a signal
    // implies nothing to wait for.
    useEffect(() => {
        let expiry: ReturnType<typeof setTimeout> | null = null;

        const clear = () => {
            if (expiry) { clearTimeout(expiry); expiry = null; }
            setDownloading((prev) => (prev.length ? [] : prev));
        };

        const off = onChangeSignal((sig) => {
            if (!isCounterRef.current || !sig.topics.length) return;
            setDownloading((prev) => {
                const merged = new Set([...prev, ...sig.topics]);
                return merged.size === prev.length ? prev : [...merged];
            });
            if (expiry) clearTimeout(expiry);
            expiry = setTimeout(clear, DOWNLOAD_CLAIM_TTL_MS);
        });

        ensureSyncAppliedBridge();
        // The worker committed rows, so whatever was owed has landed. Also re-poll:
        // a cycle that pulled rows may have cleared a `failing` table too.
        const onApplied = () => clear();
        window.addEventListener(SYNC_APPLIED_EVENT, onApplied);

        return () => {
            off();
            window.removeEventListener(SYNC_APPLIED_EVENT, onApplied);
            if (expiry) clearTimeout(expiry);
        };
    }, []);

    if (!status) return null;
    return { ...status, downloading };
}
