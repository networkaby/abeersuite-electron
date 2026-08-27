"use client";

import { CloudUpload, CloudOff, CloudCheck } from "lucide-react";
import { useOutboxStatus } from "@/shared/hooks/useOutboxStatus";
import { timeAgo } from "@/shared/lib/format/timeAgo";

/**
 * This PC's own offline-write sync state — "did my sale actually reach the
 * server yet?" Sourced from the outbox (`_outbox` table), flushed every 15s
 * by electron/outboxFlusher.ts. Not the same thing as CounterStatusBadge,
 * which is about which database READS come from — this is about whether
 * WRITES made on this PC have gone out.
 *
 * Renders nothing off a counter PC, same as CounterStatusBadge — there is no
 * outbox to report on.
 */
export default function SyncStatusBadge() {
    const status = useOutboxStatus();

    if (!status || !status.isCounter) return null;

    const base = "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium";
    const lastSynced = status.lastSyncedAt ? `Last synced ${timeAgo(status.lastSyncedAt)}.` : "No writes synced from this PC yet.";

    if (status.failed > 0) {
        return (
            <span
                className={`${base} border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-200`}
                title={`${status.failed} offline mutation(s) were rejected by the server and need review. ${lastSynced}`}
                aria-label={`Sync error — ${status.failed} rejected`}
            >
                <CloudOff className="size-3.5" aria-hidden />
                Sync error ({status.failed})
            </span>
        );
    }

    if (status.pending > 0) {
        return (
            <span
                className={`${base} border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200`}
                title={`${status.pending} sale(s)/ticket(s) saved on this PC are queued and will upload automatically once connected. ${lastSynced}`}
                aria-label={`Sync pending — ${status.pending} queued`}
            >
                <CloudUpload className="size-3.5" aria-hidden />
                Pending ({status.pending})
            </span>
        );
    }

    return (
        <span
            className={`${base} border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200`}
            title={`Everything saved on this PC has reached the server. ${lastSynced}`}
            aria-label="Synced"
        >
            <CloudCheck className="size-3.5" aria-hidden />
            Synced
        </span>
    );
}
