/**
 * POST /api/sync/push
 *
 * Ingestion endpoint for offline outbox mutations. Receives serialized mutations
 * from counters, applies them idempotently to the cloud database (Supabase), and
 * returns an array of successfully committed outbox IDs.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prismaLive } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { z } from "zod";

const mutationSchema = z.object({
    id:             z.number().int(),
    tableName:      z.string().min(1),
    rowPk:          z.string().min(1),
    operation:      z.enum(["create", "update"]),
    payload:        z.record(z.string(), z.unknown()),
    idempotencyKey: z.string().min(1),
});

const pushPayloadSchema = z.object({
    mutations: z.array(mutationSchema).min(1).max(200),
});

export async function POST(req: NextRequest) {
    const { user, response } = await requireAuth();
    if (response) return response;

    let body: z.infer<typeof pushPayloadSchema>;
    try {
        const json = await req.json();
        body = pushPayloadSchema.parse(json);
    } catch (err) {
        return NextResponse.json(
            { error: "Invalid payload", details: err instanceof Error ? err.message : String(err) },
            { status: 400 },
        );
    }

    const successfulIds: number[] = [];
    const failed: Array<{ id: number; error: string }> = [];

    for (const mutation of body.mutations) {
        try {
            // Apply each mutation transactionally or via raw query with ON CONFLICT
            // Note: We use dynamic table mapping or raw SQL to preserve explicit reserved IDs
            const { tableName, payload, operation } = mutation;

            // Safe table allowlist for outbox replication
            const ALLOWED_TABLES = new Set([
                "universal_vouchers",
                "voucher_details",
                "voucher_gl_lines",
                "voucher_inventory_lines",
                "voucher_links",
                "tickets",
                "ticket_logs",
                "ticket_repairs",
                "ticket_helps",
                "ticket_deals",
                "pos_shifts",
                "pos_cash_drops",
                "pos_expenditures",
                "pos_receipts",
            ]);

            if (!ALLOWED_TABLES.has(tableName)) {
                failed.push({ id: mutation.id, error: `Table '${tableName}' is not permitted in sync push` });
                continue;
            }

            const keys = Object.keys(payload);
            if (keys.length === 0) {
                successfulIds.push(mutation.id);
                continue;
            }

            const columns = keys.map((k) => `"${k}"`).join(", ");
            const placeholders = keys.map((_, idx) => `$${idx + 1}`).join(", ");
            const values = Object.values(payload);

            if (operation === "create") {
                // Upsert on primary key conflict to remain idempotent
                const updateClauses = keys
                    .filter((k) => k !== "id" && k !== "created_at")
                    .map((k) => `"${k}" = EXCLUDED."${k}"`)
                    .join(", ");

                const conflictClause = updateClauses.length > 0
                    ? `ON CONFLICT (id) DO UPDATE SET ${updateClauses}`
                    : `ON CONFLICT (id) DO NOTHING`;

                await prismaLive.$executeRawUnsafe(
                    `INSERT INTO "${tableName}" (${columns}) VALUES (${placeholders}) ${conflictClause}`,
                    ...values,
                );
            } else {
                // Update
                const pkVal = mutation.rowPk;
                const setClauses = keys
                    .filter((k) => k !== "id")
                    .map((k, idx) => `"${k}" = $${idx + 1}`)
                    .join(", ");

                await prismaLive.$executeRawUnsafe(
                    `UPDATE "${tableName}" SET ${setClauses} WHERE id = $${values.length + 1}`,
                    ...values,
                    pkVal,
                );
            }

            successfulIds.push(mutation.id);
        } catch (err) {
            console.error(`[SyncPush] Error processing mutation ${mutation.id} on ${mutation.tableName}:`, err);
            failed.push({
                id: mutation.id,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    return NextResponse.json({
        successfulIds,
        failed,
        total: body.mutations.length,
    });
}
