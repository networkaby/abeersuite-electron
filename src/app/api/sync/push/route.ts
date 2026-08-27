/**
 * POST /api/sync/push
 *
 * Ingestion endpoint for offline outbox mutations. Receives serialized mutations
 * from counters and applies them idempotently to the cloud database (Supabase).
 *
 * ── Why the typed Prisma client, not raw SQL ─────────────────────────────────
 * The previous version built `INSERT`/`ON CONFLICT DO UPDATE` SQL by interpolating
 * `Object.keys(payload)` — client-controlled JSON keys — directly as column
 * identifiers. `tableName` was allowlisted; column names never were, which is a
 * live SQL-injection hole reachable by any authenticated session. Routing through
 * `prismaLive[model].upsert(...)` closes that by construction: Prisma validates
 * `payload` against the actual schema and never builds SQL from a string, so an
 * unknown/malicious key is rejected as a validation error, not executed.
 *
 * `tableName` here is the Prisma MODEL name (e.g. "UniversalVoucher"), matching
 * the convention `prisma/sync-tables.json` already uses — not the raw DB table
 * name. Several of these models have no `@@map`, so their real table name equals
 * the model name anyway; the previous allowlist's snake_case guesses
 * ("universal_vouchers" etc.) didn't match the real tables for 10 of the 14
 * entries, which is further evidence this endpoint had never been exercised.
 *
 * Row-ownership verification (confirming a pushed id actually belongs to the
 * calling counter's own reserved id-range block) is deliberately out of scope
 * here — tracked separately, not solved by this change.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prismaLive } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { OUTBOX_MODEL_DELEGATES } from "@/shared/lib/sync/outbox";
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
            const { tableName, payload, operation, rowPk } = mutation;

            const delegateName = OUTBOX_MODEL_DELEGATES[tableName];
            if (!delegateName) {
                failed.push({ id: mutation.id, error: `Model '${tableName}' is not permitted in sync push` });
                continue;
            }

            if (Object.keys(payload).length === 0) {
                successfulIds.push(mutation.id);
                continue;
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const delegate = (prismaLive as any)[delegateName];
            const targetId = operation === "create" ? payload.id : Number(rowPk);

            // ── Last-write-wins for edits ────────────────────────────────────
            // Creates never need this: the id is minted from this counter's own
            // reserved block and cannot already exist in cloud. An update might be
            // editing a row that also changed in the cloud between sync cycles —
            // without a check, whichever write reaches this endpoint last always
            // wins, regardless of which edit is actually newer. Only applies when
            // the payload actually carries updatedAt; models without one keep the
            // previous unconditional-overwrite behaviour.
            const incomingUpdatedAt = payload.updatedAt instanceof Date
                ? payload.updatedAt
                : typeof payload.updatedAt === "string"
                    ? new Date(payload.updatedAt)
                    : null;

            if (incomingUpdatedAt) {
                const existing = await delegate.findUnique({
                    where: { id: targetId },
                    select: { updatedAt: true },
                });
                if (existing && existing.updatedAt >= incomingUpdatedAt) {
                    // Cloud already has an equal-or-newer edit — the offline edit
                    // loses. Still counts as "successfully processed": the counter
                    // should drop it from its outbox, not retry it forever.
                    successfulIds.push(mutation.id);
                    continue;
                }
            }

            if (operation === "create") {
                // Prisma validates `payload`'s keys/shape against the model itself —
                // an unknown field throws here rather than reaching SQL.
                await delegate.upsert({
                    where:  { id: payload.id },
                    create: payload,
                    update: payload,
                });
            } else {
                await delegate.update({
                    where: { id: targetId },
                    data:  payload,
                });
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
