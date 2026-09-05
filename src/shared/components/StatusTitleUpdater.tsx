"use client";

import { useEffect } from "react";
import { useSyncStatus } from "@/shared/hooks/useSyncStatus";
import { useCounterMode } from "@/shared/hooks/useCounterMode";
import { isElectronEnvironment } from "@/shared/lib/bridge/bridgeHealth";
import { shellStatus } from "@/shared/lib/counter/statusLabels";

/**
 * Pushes sync and connection status to Electron's main process, which puts it in
 * the window title. Renders nothing.
 *
 * The connection half now comes from `shellStatus()`, the same helper the shell
 * badge uses. It previously computed its own answer from `replicaReady` alone
 * while the badge tested `preference !== "live" && replicaReady`, and ignored
 * `cloudReachable` entirely — so on a counter with READ_MODE=live and a ready
 * replica the badge said "Live" while the title said "Online • Local", and under
 * WRITE_MODE=local with Supabase down the title still claimed "Online". One
 * helper, one answer, and the vocabulary matches what is on screen.
 */
export default function StatusTitleUpdater() {
    const syncStatus = useSyncStatus();
    const counterMode = useCounterMode();

    useEffect(() => {
        if (!isElectronEnvironment()) return;

        const api = (window as unknown as {
            electronAPI?: {
                updateWindowStatus?: (status: { sync: string; connection: string }) => void;
            };
        }).electronAPI;

        if (!api?.updateWindowStatus) return;
        if (!syncStatus || !counterMode) return;

        // Same priority as SyncStatusBadge — keep the two in step if either changes.
        let sync = "Synced";
        if (syncStatus.isCounter) {
            const replica = syncStatus.replica;
            if (syncStatus.failed > 0) sync = `Sync error (${syncStatus.failed})`;
            else if (syncStatus.overdrawnGiftCards > 0) sync = `Gift card overdrawn (${syncStatus.overdrawnGiftCards})`;
            else if (replica && (replica.failing.length || replica.neverSynced.length)) sync = "Copy incomplete";
            else if (syncStatus.pending > 0) sync = `Upload (${syncStatus.pending})`;
            else if (syncStatus.downloading.length > 0) sync = "Download";
        }

        // Off a counter there are no dials to report — the app is simply on the server.
        const { read, write } = shellStatus(counterMode);
        const connection = counterMode.isCounter ? `R:${read.word} · W:${write.word}` : "Live";

        api.updateWindowStatus({ sync, connection });
    }, [syncStatus, counterMode]);

    return null;
}
