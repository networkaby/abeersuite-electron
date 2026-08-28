"use client";

import { useEffect } from "react";
import { useOutboxStatus } from "@/shared/hooks/useOutboxStatus";
import { useCounterMode } from "@/shared/hooks/useCounterMode";
import { isElectronEnvironment } from "@/shared/lib/bridge/bridgeHealth";

/**
 * Sends sync and connection status to Electron's main process via IPC,
 * which updates the window title to show real-time status.
 * Renders nothing — purely side-effect based.
 */
export default function StatusTitleUpdater() {
    const syncStatus = useOutboxStatus();
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

        // Determine sync status label
        let syncLabel = "Synced";
        if (syncStatus.isCounter) {
            if (syncStatus.failed > 0) {
                syncLabel = `Sync error (${syncStatus.failed})`;
            } else if (syncStatus.pending > 0) {
                syncLabel = `Pending (${syncStatus.pending})`;
            }
        }

        // Determine connection status label
        let connectionLabel = "Online • Remote";
        if (counterMode.isCounter) {
            const isOffline = counterMode.mode === "LOCAL";
            const isLocal = counterMode.replicaReady;

            if (isOffline) {
                connectionLabel = "Offline • Local";
            } else if (isLocal) {
                connectionLabel = "Online • Local";
            }
        }

        api.updateWindowStatus({ sync: syncLabel, connection: connectionLabel });
    }, [syncStatus, counterMode]);

    return null;
}
