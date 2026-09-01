/**
 * Sync Engine Types & Event Payloads
 */

export type SyncStrategy = "child" | "watermark" | "append" | "full";

export interface SyncTableEntry {
    n: number;
    table: string;
    pk: string[];
    strategy: SyncStrategy;
    column?: string;
    parent?: string;
}


export interface TableWatermark {
    tableNumber: number;
    tableName: string;
    lastSyncedAt: string;
    lastRecordCount?: number;
    updatedAt: string;
}

export interface OutboxMutation {
    id: string;
    tableNumber: number;
    tableName: string;
    action: "INSERT" | "UPDATE" | "DELETE";
    payload: Record<string, unknown>;
    createdAt: string;
    retries: number;
    lastError?: string;
}

export interface SyncStatusSummary {
    isOnline: boolean;
    isSyncing: boolean;
    lastSyncTimestamp: string | null;
    pendingOutboxCount: number;
    tablesTracked: number;
}
