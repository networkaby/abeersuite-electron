/**
 * One line of progress for a replica that is still filling — shared by the readiness
 * overlay (ReplicaReadyGate) and the onboarding wizard, which both wait on the same
 * `_sync_status` row and should say the same thing about it.
 */

export interface ReplicaProgress {
    failing: string[];
    neverSynced: string[];
    tablesSynced: number;
    tablesTotal: number;
}

export function replicaProgressStep(replica: ReplicaProgress | null | undefined): string {
    if (!replica) return "Checking the local copy…";
    if (replica.failing.length > 0) {
        return `Retrying ${replica.failing.length} table(s): ${replica.failing.slice(0, 3).join(", ")}`;
    }
    if (replica.tablesTotal > 0) {
        const next = replica.neverSynced.length > 0 ? ` — next: ${replica.neverSynced.slice(0, 3).join(", ")}` : "";
        return `Copying tables: ${replica.tablesSynced} of ${replica.tablesTotal}${next}`;
    }
    return "Waiting for the first sync cycle to start…";
}

/**
 * "May the app open on this replica?" — the worker's verdict plus proof it has actually
 * run. `/api/sync/status` reports `ready: true` when there is no status row at all (a
 * never-synced replica reads as "nothing wrong" for the badge), so the onboarding wait
 * must also see a completed cycle before it trusts the flag.
 */
export function replicaIsFilled(replica: { ready: boolean; lastCycleAt: string | null } | null | undefined): boolean {
    return Boolean(replica && replica.ready && replica.lastCycleAt);
}
