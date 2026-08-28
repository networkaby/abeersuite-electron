/**
 * POST /api/sync/push
 *
 * Applies outbox mutations from a counter to Supabase.
 *
 * ── Not on the counter's own path any more ──────────────────────────────────
 * A counter flushes its outbox in-process (see src/shared/lib/sync/flusher.ts): the
 * Next server already holds both connections, so there is no reason to make it talk to
 * itself over HTTP. This endpoint remains for a pusher that genuinely arrives over the
 * network, and it delegates to the same `pushMutations()` the flusher uses — the two
 * must not drift, because ordering and the PosCounter binding rule live in there.
 *
 * ── What is deliberately not solved here ────────────────────────────────────
 * Row ownership: nothing confirms a pushed id actually falls inside the calling
 * counter's reserved block, so an authenticated staff session can address any row in a
 * syncable table. Tracked separately.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { pushMutations } from "@/shared/lib/sync/push";
import type { OutboxRecord } from "@/shared/lib/sync/outbox";
import { z } from "zod";

const mutationSchema = z.object({
    id: z.number().int(),
    /** PHYSICAL table name, as the capture trigger records it (e.g. "pos_shifts"). */
    tableName: z.string().min(1),
    rowPk: z.string().min(1),
    /** `{column: value}` for the primary key — compound keys carry every column. */
    rowKey: z.record(z.string(), z.unknown()),
    operation: z.enum(["create", "update"]),
    payload: z.record(z.string(), z.unknown()),
    idempotencyKey: z.string().min(1),
});

const pushPayloadSchema = z.object({
    mutations: z.array(mutationSchema).min(1).max(200),
});

export async function POST(req: NextRequest) {
    const { response } = await requireAuth();
    if (response) return response;

    let body: z.infer<typeof pushPayloadSchema>;
    try {
        body = pushPayloadSchema.parse(await req.json());
    } catch (err) {
        return NextResponse.json(
            { error: "Invalid payload", details: err instanceof Error ? err.message : String(err) },
            { status: 400 },
        );
    }

    // Sort by id here too: the ordering argument in push.ts is about the order rows are
    // APPLIED, and a caller that batched them differently must not break it.
    const records = body.mutations
        .map((m): OutboxRecord => ({
            id: m.id,
            table_name: m.tableName,
            row_pk: m.rowPk,
            row_key: m.rowKey,
            operation: m.operation,
            payload: m.payload,
            created_at: new Date(),
            pushed_at: null,
            idempotency_key: m.idempotencyKey,
            error: null,
            attempts: 0,
            next_attempt_at: null,
            dead_lettered_at: null,
        }))
        .sort((a, b) => a.id - b.id);

    const { pushedIds, failure } = await pushMutations(records);

    return NextResponse.json({
        successfulIds: pushedIds,
        // At most one: the run stops at the first failure so later rows cannot overtake
        // the one that is stuck. The caller retries from there.
        failed: failure ? [{ id: failure.id, error: failure.error, permanent: failure.permanent }] : [],
        total: records.length,
    });
}
