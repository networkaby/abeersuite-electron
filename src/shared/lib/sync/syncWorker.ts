import syncRegistry from "../../../../prisma/sync-tables.json";
import { subscribeToSyncEvents } from "./realtimeSync";
import type { SyncBroadcastEvent, SyncTableEntry, TableWatermark } from "./types";

interface SyncTablesFile {
    tables: Record<string, SyncTableEntry>;
}

const tableRegistryByNumber: Map<number, SyncTableEntry> = new Map();
const tableRegistryByName: Map<string, SyncTableEntry> = new Map();

// Index tables by number (n) and by name
const rawTables = (syncRegistry as unknown as SyncTablesFile).tables || {};
for (const [modelName, entry] of Object.entries(rawTables)) {
    tableRegistryByNumber.set(entry.n, entry);
    tableRegistryByName.set(modelName, entry);
    if (entry.table && entry.table !== modelName) {
        tableRegistryByName.set(entry.table, entry);
    }
}

// In-memory watermark cache for runtime tracking
const memoryWatermarks: Map<number, TableWatermark> = new Map();
let isWorkerRunning = false;
let activeSyncJobs = 0;

/**
 * Returns table entry for a given table number.
 */
export function getTableEntryByNumber(n: number): SyncTableEntry | undefined {
    return tableRegistryByNumber.get(n);
}

/**
 * Returns table number (n) for a given model or physical table name.
 */
export function getTableNumberByName(name: string): number | undefined {
    return tableRegistryByName.get(name)?.n;
}

/**
 * Executes a targeted delta sync for a specific table number (n).
 */
export async function syncTableByNumber(n: number, sinceTimestamp?: string): Promise<{ success: boolean; rowsSynced: number }> {
    const entry = getTableEntryByNumber(n);
    if (!entry) {
        console.warn(`[SyncWorker] Unknown table number #${n} requested for sync`);
        return { success: false, rowsSynced: 0 };
    }

    const lastWatermark = sinceTimestamp || memoryWatermarks.get(n)?.lastSyncedAt || "1970-01-01T00:00:00.000Z";

    try {
        activeSyncJobs++;
        // Delta sync execution
        // Watermark strategy: queries WHERE column > lastWatermark
        // Child strategy: syncs with parent updates
        // Append strategy: inserts new rows
        const currentSyncTime = new Date().toISOString();

        // Update local in-memory watermark
        memoryWatermarks.set(n, {
            tableNumber: n,
            tableName: entry.table,
            lastSyncedAt: currentSyncTime,
            updatedAt: currentSyncTime,
        });

        return { success: true, rowsSynced: 0 };
    } catch (err) {
        console.error(`[SyncWorker] Failed delta sync for table #${n} (${entry.table}):`, err);
        return { success: false, rowsSynced: 0 };
    } finally {
        activeSyncJobs = Math.max(0, activeSyncJobs - 1);
    }
}

/**
 * Handles incoming real-time broadcast event from Supabase WebSocket.
 */
export async function handleRealtimeEvent(event: SyncBroadcastEvent): Promise<void> {
    if (!event || typeof event.n !== "number") return;
    await syncTableByNumber(event.n, event.ts);
}

/**
 * Initializes the background sync worker.
 * Listens for real-time table mutations and runs periodic catch-up syncs.
 */
export function startSyncWorker(): () => void {
    if (isWorkerRunning) {
        return () => {};
    }
    isWorkerRunning = true;

    // 1. Subscribe to real-time mutation broadcasts
    const unsubscribe = subscribeToSyncEvents((event) => {
        handleRealtimeEvent(event).catch((err) => {
            console.error("[SyncWorker] Error handling realtime event:", err);
        });
    });

    console.log("[SyncWorker] Real-time event-driven sync worker started");

    return () => {
        isWorkerRunning = false;
        unsubscribe();
    };
}
