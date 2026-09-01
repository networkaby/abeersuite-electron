/**
 * Applies captured local mutations to Supabase, in order.
 *
 * The counter writes to its own PostgreSQL; a trigger records each committed row in
 * `_outbox` (see `_outbox_capture` in scripts/gen-local-schema.ts). This module is the
 * other half: it drains that queue upward.
 *
 * ── Order is the whole correctness argument ─────────────────────────────────
 * `_outbox.id` comes from a SERIAL allocated inside the trigger, at the moment the row
 * is written. Local foreign keys are enforced immediately, so when a child row was
 * inserted its parent was already visible to that transaction — meaning the parent was
 * either written earlier in the same transaction (lower id) or had already committed
 * (lower id, because a sequence allocates monotonically). So `id(parent) < id(child)`,
 * always, and replaying in `id` order satisfies the cloud's foreign keys without a
 * topological sort.
 *
 * That argument only holds if two things are true, and the previous version broke both:
 * the queue must be read in `id` order (it read `created_at`, which is transaction
 * START time and can invert between overlapping transactions), and a failure must stop
 * the chain rather than letting later rows overtake the one that is stuck.
 *
 * Stopping on failure is only safe because of the dead-letter in `outbox.ts`: without
 * it, one unpushable row would halt the counter's sync forever.
 */

import { prismaLive } from "@/shared/lib/prisma/prismaClient";
import { SYNC_REGISTRY, type SyncRegistryEntry } from "./syncRegistry.generated";
import type { OutboxRecord } from "./outbox";

/**
 * Tables a counter has no business pushing, whatever it managed to write locally.
 *
 * A denylist rather than an allowlist, deliberately. An allowlist is what the previous
 * design used, and a model missing from it failed silently — which is how 27 models
 * came to write locally and never sync. A denylist fails OPEN, so a table added
 * tomorrow syncs by default and only the genuinely dangerous ones need remembering.
 */
const NEVER_PUSH = new Set<string>([
    "User", "Session", "Account_auth", "UserPermission", "UserPosition",
    "RolePermission", "DepartmentPermission", "PersonPortalCredential",
]);

/** Raised for a mutation that can never succeed, however many times it is retried. */
export class PermanentPushError extends Error {}

/**
 * Prisma's `where` for this row.
 *
 * A compound primary key is addressed through its generated composite input —
 * `{ productId_branchId: { productId, branchId } }` for `InvProductBranch` — which is
 * why `row_key` is stored as jsonb with its types intact rather than a joined string
 * that would have to be re-typed here.
 */
function whereFor(entry: SyncRegistryEntry, rowKey: Record<string, unknown>): Record<string, unknown> {
    if (entry.pk.length === 1) return { [entry.pk[0]]: rowKey[entry.pk[0]] };
    const composite = entry.pk.join("_");
    return { [composite]: Object.fromEntries(entry.pk.map((c) => [c, rowKey[c]])) };
}

/**
 * The counter's device lock must never overwrite the office's view of it.
 *
 * `PosCounter` is written from both ends: the office releases or reassigns a counter,
 * and the counter itself stamps `boundDeviceId` when a shift opens. It carries no
 * `updatedAt`, so ordinary last-write-wins cannot arbitrate — a counter that had been
 * offline would simply overwrite whatever the office had decided.
 *
 * So the binding fields are taken from the server whenever the server already names a
 * DIFFERENT device: an offline machine cannot take a counter that someone else now
 * holds. The rest of the payload still applies, and the counter converges on the
 * server's answer at the next pull.
 */
async function reconcileCounterBinding(
    payload: Record<string, unknown>,
    where: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    const server = await (prismaLive as unknown as {
        posCounter: { findUnique: (a: unknown) => Promise<{ boundDeviceId: string | null; boundDeviceLabel: string | null; boundAt: Date | null } | null> };
    }).posCounter.findUnique({
        where,
        select: { boundDeviceId: true, boundDeviceLabel: true, boundAt: true },
    });

    if (!server?.boundDeviceId) return payload;
    if (server.boundDeviceId === payload.boundDeviceId) return payload;

    console.warn(
        `[SyncPush] pos_counters ${JSON.stringify(where)}: refusing to move the device lock from ` +
        `${server.boundDeviceId} to ${String(payload.boundDeviceId)} — keeping the server's binding.`,
    );
    return {
        ...payload,
        boundDeviceId: server.boundDeviceId,
        boundDeviceLabel: server.boundDeviceLabel,
        boundAt: server.boundAt,
    };
}

/**
 * A local datetime, exactly as `to_jsonb` renders `timestamp(3) without time zone`.
 * Anchored at both ends: a value carrying an offset or a `Z` is already complete and
 * must be left alone.
 */
const BARE_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?$/;

/**
 * Stamps `Z` on the payload's DateTime columns.
 *
 * The counter's capture trigger stores `to_jsonb(NEW)`, and Prisma maps every
 * `DateTime` to `timestamp(3) WITHOUT time zone` — so a captured row carries
 * `2026-09-01T17:02:24.286` with no zone at all. Prisma rejects that upstream
 * ("premature end of input. Expected ISO-8601 DateTime"), and the row retried until it
 * dead-lettered. It looked table-specific because a counter that writes little else
 * only ever queued view-markers, but EVERY model with a date was exposed.
 *
 * The stored value is already UTC — Prisma writes UTC into these columns — so this
 * completes the spelling and moves no clock. Columns come from the registry rather
 * than a shape test, so a text column holding a date-shaped string is never touched.
 *
 * Runs before the last-write-wins check as well as the upsert, because `new Date()` on
 * a zone-less string parses as LOCAL time: comparing that against the cloud's
 * `updatedAt` was wrong by the machine's offset, and on IST that is five and a half
 * hours in which a counter could overwrite a newer edit from the office.
 */
function withZonedDates(
    payload: Record<string, unknown>,
    dates: readonly string[],
): Record<string, unknown> {
    let out: Record<string, unknown> | null = null;
    for (const col of dates) {
        const v = payload[col];
        if (typeof v !== "string" || !BARE_DATETIME.test(v)) continue;
        out ??= { ...payload };
        out[col] = `${v.replace(" ", "T")}Z`;
    }
    return out ?? payload;
}

export interface PushOutcome {
    /** Ids applied (or deliberately discarded as superseded), in order. */
    pushedIds: number[];
    /** The row that stopped the run, if any. Everything after it is untouched. */
    failure: { id: number; error: string; permanent: boolean } | null;
}

/**
 * Applies records to Supabase in `id` order, stopping at the first failure.
 *
 * Callers pass records already ordered by id (see `getPendingOutbox`).
 */
export async function pushMutations(records: OutboxRecord[]): Promise<PushOutcome> {
    const pushedIds: number[] = [];

    for (const rec of records) {
        try {
            const entry = SYNC_REGISTRY[rec.table_name];
            if (!entry) {
                throw new PermanentPushError(`No registry entry for table '${rec.table_name}'`);
            }
            if (NEVER_PUSH.has(entry.model)) {
                throw new PermanentPushError(`Model '${entry.model}' must not be pushed from a counter`);
            }

            const delegate = (prismaLive as unknown as Record<string, {
                upsert: (a: unknown) => Promise<unknown>;
                findUnique: (a: unknown) => Promise<{ updatedAt?: Date } | null>;
            }>)[entry.delegate];
            if (!delegate?.upsert) {
                throw new PermanentPushError(`Prisma has no delegate '${entry.delegate}' for ${entry.model}`);
            }

            let payload = withZonedDates(rec.payload, entry.dates);
            const where = whereFor(entry, rec.row_key);

            // Last-write-wins for models that carry a timestamp. A counter that was
            // offline may be replaying an edit the office has already superseded;
            // applying it would silently undo the newer change. Dropping it counts as
            // success — the counter should stop carrying it, not retry forever.
            const incoming = typeof payload.updatedAt === "string" || payload.updatedAt instanceof Date
                ? new Date(payload.updatedAt as string | Date)
                : null;
            if (incoming && !Number.isNaN(incoming.getTime())) {
                const existing = await delegate.findUnique({ where, select: { updatedAt: true } });
                if (existing?.updatedAt && existing.updatedAt >= incoming) {
                    pushedIds.push(rec.id);
                    continue;
                }
            }

            if (rec.table_name === "pos_counters") {
                payload = await reconcileCounterBinding(payload, where);
            }

            // Always upsert, never a bare update: the payload is a complete row image,
            // and an update whose target is missing in the cloud (a create that failed
            // and was dead-lettered, a row the office deleted) would fail forever.
            await delegate.upsert({ where, create: payload, update: payload });
            pushedIds.push(rec.id);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[SyncPush] mutation ${rec.id} on ${rec.table_name} failed:`, message);
            return {
                pushedIds,
                failure: { id: rec.id, error: message, permanent: err instanceof PermanentPushError },
            };
        }
    }

    return { pushedIds, failure: null };
}
