"use client";

import { CloudUpload, CloudDownload, CloudOff, CloudCheck, TriangleAlert } from "lucide-react";
import { useSyncStatus } from "@/shared/hooks/useSyncStatus";
import { timeAgo } from "@/shared/lib/format/timeAgo";

/**
 * This counter's sync, both directions.
 *
 * UP is `_outbox` — did my sale actually reach the server. DOWN is the replica
 * this machine reads from — is it being kept in step. Only the up half existed
 * before, so a replica that had quietly stopped receiving showed a green
 * "Synced" badge the whole time.
 *
 * ── Priority, and why this order ─────────────────────────────────────────────
 * Worst-first, where "worst" means "needs a person soonest":
 *   1. dead-lettered writes — work that will never leave this machine unaided.
 *   2. an incomplete replica — reports render fine and silently omit rows, which
 *      reads as "those records do not exist" rather than "this copy isn't ready".
 *   3. queued writes — normal offline behaviour, resolves itself.
 *   4. an owed download — the most transient state and the least harmful.
 *
 * Renders nothing off a counter PC, same as CounterStatusBadge: no outbox, no
 * replica, nothing to report.
 */
export default function SyncStatusBadge() {
    const status = useSyncStatus();

    if (!status || !status.isCounter) return null;

    const base = "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium";
    const rose = "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-200";
    const amber = "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200";
    const emerald = "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200";

    const lastSynced = status.lastSyncedAt
        ? `Last upload ${timeAgo(status.lastSyncedAt)}.`
        : "No writes uploaded from this PC yet.";

    // 1. Dead-lettered writes — the only state that cannot resolve on its own.
    if (status.failed > 0) {
        return (
            <span className={`${base} ${rose}`}
                title={`${status.failed} saved item(s) could not be sent to the server after repeated attempts and need attention. ${lastSynced}`}
                aria-label={`Sync error — ${status.failed} rejected`}>
                <CloudOff className="size-3.5" aria-hidden />
                Sync error ({status.failed})
            </span>
        );
    }

    // 2. The replica is not whole. Deliberately ranked above queued writes: a
    //    missing upload is visible work waiting, whereas missing ROWS look like
    //    data that never existed.
    const replica = status.replica;
    if (replica && (replica.failing.length > 0 || replica.neverSynced.length > 0)) {
        const broken = replica.failing.length > 0;
        const names = broken ? replica.failing : replica.neverSynced;
        return (
            <span className={`${base} ${rose}`}
                title={`${broken
                    ? `This computer's copy could not update: ${names.join(", ")}.`
                    : `This computer's copy has never received: ${names.join(", ")}.`
                    } Screens may be missing rows until this resolves. ${replica.tablesTotal > 0
                        ? `${replica.tablesSynced} of ${replica.tablesTotal} tables in step.` : ""}`}
                aria-label="Local copy incomplete">
                <TriangleAlert className="size-3.5" aria-hidden />
                Copy incomplete
            </span>
        );
    }

    // 3. This PC's own writes are queued.
    if (status.pending > 0) {
        return (
            <span className={`${base} ${amber}`}
                title={`${status.pending} item(s) saved on this PC are queued and will upload automatically once connected. ${lastSynced}`}
                aria-label={`Upload pending — ${status.pending} queued`}>
                <CloudUpload className="size-3.5" aria-hidden />
                Upload ({status.pending})
            </span>
        );
    }

    // 4. Somebody elsewhere saved something and the worker has not confirmed it
    //    landed yet. Topics, not table names — that is all the signal carries, by
    //    design (see realtime/topics.ts). Self-clears on __SYNC_APPLIED__ or, for
    //    a cycle that pulled nothing and so stayed silent, on the hook's TTL.
    if (status.downloading.length > 0) {
        const shown = status.downloading.slice(0, 2).join(", ");
        const more = status.downloading.length - 2;
        return (
            <span className={`${base} ${amber}`}
                title={`Changes were made elsewhere (${status.downloading.join(", ")}). This computer's copy is fetching them now — screens refresh on their own once they arrive.`}
                aria-label="Downloading changes">
                <CloudDownload className="size-3.5" aria-hidden />
                Download ({shown}{more > 0 ? ` +${more}` : ""})
            </span>
        );
    }

    return (
        <span className={`${base} ${emerald}`}
            title={`Everything saved on this PC has reached the server, and this computer's copy is in step.${replica?.lastCycleAt ? ` Last checked ${timeAgo(replica.lastCycleAt)}.` : ""} ${lastSynced}`}
            aria-label="Synced">
            <CloudCheck className="size-3.5" aria-hidden />
            Synced
        </span>
    );
}
