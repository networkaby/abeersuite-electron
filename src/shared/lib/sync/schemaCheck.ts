import { prisma } from "@/shared/lib/prisma/prismaClient";
import syncRegistry from "../../../../prisma/sync-tables.json";

export interface SchemaSyncStatus {
    schemaValid: boolean;
    totalTables: number;
    missingTables: string[];
    lastCheckedAt: string;
}

/**
 * Self-healing schema check: verifies that all models in sync-tables.json
 * exist in the local database and are ready for replication.
 */
export async function verifyLocalSchema(): Promise<SchemaSyncStatus> {
    const missingTables: string[] = [];
    const tables = (syncRegistry as { tables: Record<string, { table: string }> }).tables;
    const tableNames = Object.values(tables).map((t) => t.table);

    try {
        // Query Postgres information_schema for existing table names
        const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
            `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';`
        );
        const existing = new Set(rows.map((r) => r.table_name.toLowerCase()));

        for (const name of tableNames) {
            if (!existing.has(name.toLowerCase())) {
                missingTables.push(name);
            }
        }
    } catch (err) {
        console.error("[SchemaCheck] Error querying local information_schema:", err);
        return {
            schemaValid: false,
            totalTables: tableNames.length,
            missingTables: ["*"],
            lastCheckedAt: new Date().toISOString(),
        };
    }

    return {
        schemaValid: missingTables.length === 0,
        totalTables: tableNames.length,
        missingTables,
        lastCheckedAt: new Date().toISOString(),
    };
}
