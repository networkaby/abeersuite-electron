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
 * it, one unpushable row would halt the counter's sync forever. Only a REFUSAL moves a
 * row toward it. An outage stops every row alike and says nothing about this one, so it
 * costs no attempt — otherwise two hours offline dead-letters perfectly good work.
 */

import type { Prisma } from "@/generated/prisma/client";
import { prismaLive } from "@/shared/lib/prisma/prismaClient";
import { SYNC_REGISTRY, type SyncRegistryEntry } from "./syncRegistry.generated";
import type { OutboxRecord } from "./outbox";
import { NEVER_PUSH_MODELS } from "./neverPush";
import { emptyTouches, noteTouches, rebuildTotalsAfterPush } from "./rebuildTotals";
import { CLOUD_RANGE_END } from "@/shared/lib/counter/idRange";
import { isConnectionFailure } from "./connectionError";

/**
 * Tables a counter has no business pushing. The list lives in `neverPush.ts` because
 * the schema generator uses the same one to attach no capture trigger to these tables
 * — so normally nothing here is ever reached. Kept as defence in depth for a replica
 * provisioned before that change.
 */
const NEVER_PUSH = new Set<string>(NEVER_PUSH_MODELS);

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
 * A till's number row never winds the cloud's copy back.
 *
 * Since 2026-09-25 numbering is counter-wise on every write mode, so a till's
 * `VoucherSeriesCounter` row has TWO writers: the till itself while it writes to its
 * own replica, and the office for every sale the till relays under `v_live`. The
 * till's push carries its whole row image, and an image taken before the office's
 * latest increments would set `nextSeq` back and re-issue numbers already printed.
 *
 * So within one generation (same `resetGen` and `fyStartYear`) the higher `nextSeq`
 * wins. A cloud row already in a LATER generation — the office's reset, or the new
 * financial year — makes the replay stale, and it is dropped. The worst this can
 * cost is a gap in the run, never a repeated number.
 *
 * Returns the payload to write, or null to drop the record as superseded.
 */
async function mergeSeriesCounter(
    payload: Record<string, unknown>,
    where: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
    const cloud = await prismaLive.voucherSeriesCounter.findUnique({
        where: where as Prisma.VoucherSeriesCounterWhereUniqueInput,
        select: { nextSeq: true, resetGen: true, fyStartYear: true },
    });
    if (!cloud) return payload;
    const gen = (resetGen: unknown, fy: unknown) => [Number(resetGen ?? 0), Number(fy ?? 0)] as const;
    const [cReset, cFy] = gen(cloud.resetGen, cloud.fyStartYear);
    const [iReset, iFy] = gen(payload.resetGen, payload.fyStartYear);
    if (cReset > iReset || (cReset === iReset && cFy > iFy)) return null;
    if (cReset === iReset && cFy === iFy && cloud.nextSeq > Number(payload.nextSeq ?? 0)) {
        return { ...payload, nextSeq: cloud.nextSeq };
    }
    return payload;
}

/**
 * The counter's device lock must never overwrite the office's view of it.
 *
 * `PosCounter` is written from both ends: the office releases or reassigns a counter,
 * and the counter itself stamps `boundDeviceId` when a shift opens. It carries no
 * `updatedAt`, so ordinary last-write-wins cannot arbitrate — a counter that had been
 * offline would simply overwrite whatever the office had decided.
 *
 * Two ways the office can win, and the second one used to be missed entirely:
 *
 *  1. The server already names a DIFFERENT device. An offline machine cannot take a
 *     counter that someone else now holds.
 *  2. The server names NOBODY because the counter was RELEASED. `boundDeviceId = null`
 *     alone cannot say this — an unclaimed counter looks the same — so the release
 *     stamps `releasedAt`, and a bind minted before that stamp is a stale replay from
 *     a machine that has not yet learnt it was released. Refusing it is the whole
 *     point of a release: the machine must go back through the setup wizard and take
 *     a new counter number, not quietly reclaim the one it lost. A genuine first bind
 *     (no `releasedAt`) and a rebind made after the release both still apply.
 *
 * The rest of the payload always applies, and the counter converges on the server's
 * answer at the next pull.
 */
async function reconcileCounterBinding(
    payload: Record<string, unknown>,
    where: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    // The office key columns are written only straight to Supabase (relayKey.ts, the
    // bind / release routes). A replayed row carries the replica's older copy, which
    // would roll a renewal back or lift a revoke — so a push never carries them.
    const { relayKeyHash: _h, relayKeyPrevHash: _p, relayKeyIssuedAt: _i, relayKeyRevokedAt: _r, ...rest } = payload;
    void _h; void _p; void _i; void _r;
    payload = rest;
    const server = await (prismaLive as unknown as {
        posCounter: { findUnique: (a: unknown) => Promise<{ boundDeviceId: string | null; boundDeviceLabel: string | null; boundAt: Date | null; releasedAt: Date | null } | null> };
    }).posCounter.findUnique({
        where,
        select: { boundDeviceId: true, boundDeviceLabel: true, boundAt: true, releasedAt: true },
    });

    if (!server) return payload;

    const keepServerBinding = () => ({
        ...payload,
        boundDeviceId: server.boundDeviceId,
        boundDeviceLabel: server.boundDeviceLabel,
        boundAt: server.boundAt,
        releasedAt: server.releasedAt,
    });

    // (1) Someone else holds it.
    if (server.boundDeviceId && server.boundDeviceId !== payload.boundDeviceId) {
        console.warn(
            `[SyncPush] pos_counters ${JSON.stringify(where)}: refusing to move the device lock from ` +
            `${server.boundDeviceId} to ${String(payload.boundDeviceId)} — keeping the server's binding.`,
        );
        return keepServerBinding();
    }

    // (2) It was released, and this bind predates the release.
    if (!server.boundDeviceId && server.releasedAt && payload.boundDeviceId) {
        const boundAt = payload.boundAt instanceof Date ? payload.boundAt
            : typeof payload.boundAt === "string" ? new Date(payload.boundAt)
            : null;
        const stale = !boundAt || Number.isNaN(boundAt.getTime()) || boundAt <= server.releasedAt;
        if (stale) {
            console.warn(
                `[SyncPush] pos_counters ${JSON.stringify(where)}: refusing to re-bind to ` +
                `${String(payload.boundDeviceId)} — the counter was released at ` +
                `${server.releasedAt.toISOString()} and this binding is older. ` +
                `That PC must run counter setup again.`,
            );
            return keepServerBinding();
        }
    }

    return payload;
}

/**
 * A shift the office has already CLOSED can never be re-opened or re-closed by a replay.
 *
 * The counter is offline; an admin force-closes its shift on the office's request (a
 * PC died, or the day has to be shut). Later the counter wakes and pushes what it
 * wrote against a shift it still believed was open. Ordinary last-write-wins settles
 * that on timestamps, and both answers are wrong: a newer local close overwrites the
 * admin's declared cash and variance and points the row at a SECOND closing Contra —
 * the same cash swept to the vault twice — while an older one is dropped silently and
 * the counter's replica keeps disagreeing with live until the next pull.
 *
 * The close is a physical cash count made by a person. It stands. The counter's job on
 * recovery is to start a FRESH shift (see CounterReconciler), not to re-litigate this
 * one, so the replay is dropped as superseded and the counter converges on the pull.
 */
async function shiftIsAlreadyClosed(where: Record<string, unknown>): Promise<boolean> {
    const server = await (prismaLive as unknown as {
        posShift: { findUnique: (a: unknown) => Promise<{ status: string } | null> };
    }).posShift.findUnique({ where, select: { status: true } });
    return server?.status === "CLOSED";
}

/**
 * A voucher that has left DRAFT never goes back there by a replayed push.
 *
 * Posting is a one-way transition, not a value to arbitrate, so last-write-wins is
 * the wrong rule for it — and it genuinely can lose. A counter holds a voucher it
 * still believes is a draft; the office posts it; the counter, offline, writes to
 * that row again (the capture trigger ships `to_jsonb(NEW)`, the WHOLE row, so even
 * an edit that only touches a narration re-asserts the stale `status`). That write
 * is honestly LATER, so LWW lets it through and the cloud's POSTED row is overwritten
 * with a DRAFT image. Nothing about clocks is needed for this; it is simply what
 * last-write-wins means when one of the values is a lifecycle state.
 *
 * Since numbering moved to post time the cost is permanent: the DRAFT image carries
 * `voucherNo: null`, so an allocated number is blanked out of a GST-relevant series
 * and the series never re-issues it.
 *
 * ── Why `binding`, and not `status` alone ───────────────────────────────────
 * There IS a legitimate counter-side POSTED → DRAFT writer: the "Mark Draft" toggle
 * on the POS Sales Register (PATCH /api/inventory/vouchers/[id]/status). It refuses
 * anything whose `binding` is not OPTIONAL, because only a non-binding document
 * (estimate, order) carries a free lifecycle status. So the exact rule is REGULAR —
 * a real transaction, whose status belongs to the post/cancel flow — and a blanket
 * status check would have silently eaten every estimate a cashier un-finalised.
 *
 * ── The coupling this depends on ────────────────────────────────────────────
 * The one other POSTED → DRAFT writer is `parkVoucherAsDraftInTx` (the POS shift
 * reopen), and its vouchers ARE regular. It is safe only because the reopen route
 * writes through `prismaAuthoritative`, which is live-only — so a park never reaches
 * a replica and never enters the outbox. If reopen is ever moved onto the mode-routed
 * `prisma`, or a local-write fallback is added to `wrapLive`, this guard will start
 * eating legitimate un-posts. Change them together.
 */
function voucherWouldUnpost(
    server: { status?: string | null; binding?: string | null } | null,
    payload: Record<string, unknown>,
): boolean {
    if (!server || payload.status !== "DRAFT") return false;
    if (server.status === "CANCELLED") return true;                      // no legitimate producer at all
    return server.status === "POSTED" && server.binding === "REGULAR";   // …and none for a real transaction
}

/**
 * Voucher line tables whose ids the office RECYCLES, and which a counter also writes.
 *
 * Both carry no `updatedAt` and no `createdAt` (registry `dates: []`), so the
 * last-write-wins branch below never runs for them and every push of one is an
 * unconditional upsert. That is only safe while nothing can replay a line the office
 * has since thrown away — and the office edit routes throw them away by the voucherful:
 * `voucherGlLine.deleteMany` + `createMany` in the voucher PATCH, the journal-entry
 * PATCH, the opening-bill rewrite, `reapplyTradingVoucherInPlace` and the shift repost;
 * `voucherInventoryLine.deleteMany` + recreate in the inventory voucher PATCH and the
 * order route. Every one of those mints FRESH ids for the replacement lines.
 *
 * So a counter still holding an unpushed `_outbox` row for one of the discarded ids
 * resurrects it. The line lands under a voucher that is still POSTED, which is exactly
 * the set `recomputeAccountBalances` re-sums — and that re-sum is authoritative, so the
 * inflated figure becomes `Account.balance` cloud-wide with no error raised and nothing
 * reporting that the voucher's debits and credits have stopped agreeing.
 *
 * The window is only rows still PENDING on a counter (a pushed row is never re-sent,
 * and a pulled row never re-enters the outbox), but it is not exotic: the drain is 50
 * rows at a time in `_outbox.id` order, so a counter that queued through an outage
 * routinely puts a batch boundary mid-voucher — spine up, its lines still waiting — and
 * a line that fails stops the whole run for hours of backoff. During those hours the
 * office is looking at a voucher whose lines are missing or partial, which is the very
 * thing someone reaches in to correct.
 */
const RECYCLED_CHILD_LINES = new Set<string>(["VoucherGlLine", "VoucherInventoryLine"]);

/**
 * Has the OFFICE authored this voucher's lines since the counter wrote its own?
 *
 * If it has, the counter's copy was discarded upstream and must not be re-created.
 *
 * The test is the id range, and it works because a counter physically cannot mint an id
 * in the cloud's. `idRange.ts` gives the cloud 1 … CLOUD_RANGE_END - 1 and each counter
 * a ten-million block above it, and `prismaClient.ts` refuses EVERY local write until
 * that reservation is confirmed applied — precisely so an unreserved sequence cannot
 * mint from 1 and collide. So a cloud-range line hanging off this voucher can only have
 * been written upstream, and its presence says the office has rewritten the line set.
 *
 * ── Why not the obvious guard ───────────────────────────────────────────────
 * "Refuse lines when the parent voucher is POSTED upstream" would reject every ordinary
 * sale. A POS sale creates its spine DRAFT, attaches the lines, then flips the spine to
 * POSTED (transactionEngine's `existingSpineId` branch), so the lines carry a HIGHER
 * `_outbox.id` than the spine and push after it; and the handover-accept path inserts
 * the spine already POSTED with its lines nested in the same statement. Both are honest
 * writes arriving at a POSTED parent.
 *
 * Nor does an `updatedAt` on these tables help. Last-write-wins can only drop a row when
 * the cloud row EXISTS; a resurrected line's row was deleted, `findUnique` answers null,
 * and the upsert takes its CREATE half regardless of any timestamp.
 *
 * ── What keeps this correct ─────────────────────────────────────────────────
 * A counter only ever CREATES these lines, and only for a voucher it created itself —
 * it has no path that edits an existing one. So the cloud parent of a legitimate push
 * holds nothing but counter-range lines: none at all on the first batch, and this
 * counter's own on the tail of a sale split across several. The day some counter route
 * starts writing lines onto a voucher the office authored, this guard will begin eating
 * them, which is why `check-guard-lint.ts` makes a new recycler announce itself.
 */
export interface LineDelegate {
    findFirst: (a: unknown) => Promise<{ id: number } | null>;
}

/**
 * Should this replayed voucher line be dropped as superseded?
 *
 * The WHOLE decision lives here rather than inline in the push loop, so the
 * verification script exercises the same code the counter runs instead of a
 * re-spelling of it that could drift. `memo` holds one answer per parent voucher for
 * the life of a push run — safe, because a run only ever ADDS counter-range lines and
 * so cannot turn a "no" into a "yes" underneath itself.
 */
export async function lineReplayWasSuperseded(
    delegate: LineDelegate,
    tableName: string,
    lineId: number,
    universalVoucherId: number,
    memo: Map<number, boolean>,
): Promise<boolean> {
    if (!RECYCLED_CHILD_LINES.has(tableName)) return false;
    // Only a counter-minted line can be a stale replay. A cloud-range id here was not
    // written by this counter, so it is none of this guard's business.
    if (!Number.isFinite(lineId) || lineId < CLOUD_RANGE_END) return false;
    if (!Number.isFinite(universalVoucherId)) return false;

    const cached = memo.get(universalVoucherId);
    if (cached !== undefined) return cached;

    const officeLine = await delegate.findFirst({
        where:  { universalVoucherId, id: { lt: CLOUD_RANGE_END } },
        select: { id: true },
    });
    const superseded = officeLine != null;
    memo.set(universalVoucherId, superseded);
    return superseded;
}

/**
 * A local datetime, exactly as `to_jsonb` renders `timestamp(3) without time zone`.
 * Anchored at both ends: a value carrying an offset or a `Z` is already complete and
 * must be left alone.
 */
const BARE_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?$/;

/**
 * A local DATE, as `to_jsonb` renders a `@db.Date` column — no time part at all.
 * `UniversalVoucher.date` is one, and it is on the path of every voucher a counter
 * writes, so this blocked the whole queue behind it (push stops at the first failure):
 * Prisma answered "premature end of input. Expected ISO-8601 DateTime" and every later
 * row waited. Widening BARE_DATETIME would have been wrong — a date needs a time
 * supplied, not just a `Z` appended.
 */
const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

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
        if (typeof v !== "string") continue;
        if (BARE_DATETIME.test(v)) {
            out ??= { ...payload };
            out[col] = `${v.replace(" ", "T")}Z`;
        } else if (BARE_DATE.test(v)) {
            // Midnight UTC — exactly what Prisma itself writes into a `@db.Date`
            // column, so this round-trips the value rather than shifting the day.
            out ??= { ...payload };
            out[col] = `${v}T00:00:00Z`;
        }
    }
    return out ?? payload;
}

export interface PushOutcome {
    /** Ids applied (or deliberately discarded as superseded), in order. */
    pushedIds: number[];
    /**
     * The row that stopped the run, if any. Everything after it is untouched.
     *
     * `unreachable` means Supabase was never reached — the row did nothing wrong, so it
     * must not spend any of its attempts on the outage (see `markOutboxUnreachable`).
     */
    failure: { id: number; error: string; permanent: boolean; unreachable: boolean } | null;
}

/**
 * Applies records to Supabase in `id` order, stopping at the first failure.
 *
 * Callers pass records already ordered by id (see `getPendingOutbox`).
 */
export async function pushMutations(records: OutboxRecord[]): Promise<PushOutcome> {
    const pushedIds: number[] = [];
    const touches = emptyTouches();
    // One answer per parent voucher per run. Safe to hold: this run only ever ADDS
    // counter-range lines, so it cannot turn a "no" into a "yes" underneath itself.
    const rewrittenParents = new Map<number, boolean>();

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
                findFirst: (a: unknown) => Promise<{ id: number } | null>;
            }>)[entry.delegate];
            if (!delegate?.upsert) {
                throw new PermanentPushError(`Prisma has no delegate '${entry.delegate}' for ${entry.model}`);
            }

            // Only the columns the office has: a replica keeps a column the office has
            // since dropped, and Prisma would refuse the whole row for that one key.
            let payload = onlyColumns(withZonedDates(rec.payload, entry.dates), entry.columns);
            const where = whereFor(entry, rec.row_key);

            // Last-write-wins for models that carry a timestamp. A counter that was
            // offline may be replaying an edit the office has already superseded;
            // applying it would silently undo the newer change. Dropping it counts as
            // success — the counter should stop carrying it, not retry forever.
            //
            // The voucher lifecycle rides along in the SAME read (see
            // voucherWouldUnpost): it has to be checked even when the row is newer
            // than the cloud's, because that is exactly the case LWW would wave
            // through, so it cannot sit behind the short-circuit below.
            // A person's day has two writers and must never be won whole by either.
            // See mergeAttendanceDay.
            if (entry.model === "AttendanceDay") {
                await mergeAttendanceDay(payload);
                pushedIds.push(rec.id);
                continue;
            }

            const isVoucher = rec.table_name === "UniversalVoucher";
            const incoming = typeof payload.updatedAt === "string" || payload.updatedAt instanceof Date
                ? new Date(payload.updatedAt as string | Date)
                : null;
            const needsServerRow = isVoucher || (incoming != null && !Number.isNaN(incoming.getTime()));
            const existing = needsServerRow
                ? await delegate.findUnique({
                    where,
                    select: isVoucher
                        ? { updatedAt: true, status: true, binding: true }
                        : { updatedAt: true },
                }) as ({ updatedAt?: Date; status?: string | null; binding?: string | null } | null)
                : null;

            if (isVoucher && voucherWouldUnpost(existing, payload)) {
                console.warn(
                    `[SyncPush] UniversalVoucher ${JSON.stringify(where)}: dropping a replayed write — ` +
                    `it carries status DRAFT, and this voucher is already ${existing?.status} ` +
                    `(binding ${existing?.binding}) upstream. Posting does not un-happen.`,
                );
                pushedIds.push(rec.id);
                continue;
            }

            if (incoming && !Number.isNaN(incoming.getTime())) {
                if (existing?.updatedAt && existing.updatedAt >= incoming) {
                    // A row this machine owns (`localAuthority`: VoucherSeriesCounter,
                    // one row per counter) is never "superseded" — dropping the local
                    // image loses an increment and re-issues a printed invoice number.
                    // It goes up regardless; since the office also numbers a relayed
                    // till's row, `mergeSeriesCounter` below keeps the higher number.
                    if (!entry.localAuthority) {
                        pushedIds.push(rec.id);
                        continue;
                    }
                    console.warn(
                        `[SyncPush] ${rec.table_name} ${JSON.stringify(where)}: cloud row is newer ` +
                        `(${existing.updatedAt.toISOString()} >= ${incoming.toISOString()}) but this ` +
                        `machine owns it — pushing the local row over it.`,
                    );
                }
            }

            if (rec.table_name === "pos_counters") {
                payload = await reconcileCounterBinding(payload, where);
            }

            if (rec.table_name === "VoucherSeriesCounter") {
                const merged = await mergeSeriesCounter(payload, where);
                if (!merged) {
                    console.warn(
                        `[SyncPush] VoucherSeriesCounter ${JSON.stringify(where)}: dropping a replayed ` +
                        `row — the cloud copy has already been reset or rolled into a new year.`,
                    );
                    pushedIds.push(rec.id);
                    continue;
                }
                payload = merged;
            }

            // A closed shift is closed. Dropping counts as success — the counter must
            // stop carrying this row, not retry it forever.
            if (rec.table_name === "pos_shifts" && await shiftIsAlreadyClosed(where)) {
                console.warn(
                    `[SyncPush] pos_shifts ${JSON.stringify(where)}: dropping a replayed write — ` +
                    `the office has already closed this shift.`,
                );
                pushedIds.push(rec.id);
                continue;
            }

            // A voucher line the office has already replaced never comes back. Dropping
            // counts as success — the counter must stop carrying this row, not retry it
            // forever; the office's edit is the later, human-authored truth, and the
            // counter converges on it at the next pull.
            const lineId = Number(rec.row_key.id);
            const parentId = Number(payload.universalVoucherId);
            if (await lineReplayWasSuperseded(delegate, rec.table_name, lineId, parentId, rewrittenParents)) {
                console.warn(
                    `[SyncPush] ${rec.table_name} ${lineId}: dropping a replayed write — ` +
                    `voucher ${parentId} already carries office-written (cloud-range) lines, ` +
                    `so its line set has been rewritten upstream and this line was discarded. ` +
                    `Re-creating it would unbalance the voucher and drift Account.balance.`,
                );
                pushedIds.push(rec.id);
                continue;
            }

            // Always upsert, never a bare update: the payload is a complete row image,
            // and an update whose target is missing in the cloud (a create that failed
            // and was dead-lettered, a row the office deleted) would fail forever.
            //
            // A running total (`entry.cache`) rides the CREATE half only — the column
            // is NOT NULL, so a new row needs a value — and never the UPDATE half: the
            // cloud re-sums its own from the ledger rows this batch carries (below).
            // The trigger already ships no row when only a total changed; this covers
            // a replica provisioned before that rule, and a row that changed both.
            await delegate.upsert({ where, create: payload, update: withoutCache(payload, entry.cache) });
            noteTouches(touches, entry.model, payload);
            pushedIds.push(rec.id);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const permanent = err instanceof PermanentPushError;
            const unreachable = !permanent && isConnectionFailure(err);
            // Offline is the normal case for a till and repeats every pass until the line
            // comes back — one short line, not Prisma's multi-line report each time.
            if (unreachable) console.warn(`[SyncPush] Supabase unreachable — mutation ${rec.id} on ${rec.table_name} waits.`);
            else console.error(`[SyncPush] mutation ${rec.id} on ${rec.table_name} failed:`, message);
            await rebuildTotalsAfterPush(touches);
            return {
                pushedIds,
                failure: { id: rec.id, error: message, permanent, unreachable },
            };
        }
    }

    await rebuildTotalsAfterPush(touches);
    return { pushedIds, failure: null };
}

/** What the till measures on a day — the office never writes these. */
const ATTENDANCE_CLOCK_COLUMNS = ["firstInAt", "lastOutAt", "lastSeenAt", "workedMinutes", "counterId"] as const;

/**
 * Push a till's image of one person's day without losing either side's half.
 *
 * Owner, 2026-10-13: *"keep both separate"* — an office mark decides pay on a
 * Manual day, and the till's own record must still be there underneath. Before
 * this the row went up whole and last-write-wins dropped it: a day marked at the
 * office after the till had counted it (a later `updatedAt`, and often a row of
 * its own with a different id) threw the till's minutes away, and the next pull
 * wrote the office's 0 over the till's copy. Live showed it on every day the
 * office had marked; the spans, a separate table, kept the hours.
 *
 * So the row is found by person + date, never by id, and merged by owner:
 *   • the clock's columns only ever grow — the most minutes, the earliest
 *     arrival, the latest out and last-seen — so a replayed or older image can
 *     never shrink a day, and an office mark can never zero one;
 *   • the office's columns (mark, note, source, corrections) follow
 *     last-write-wins as before, because a till can edit them offline too.
 */
async function mergeAttendanceDay(payload: Record<string, unknown>): Promise<void> {
    const db = prismaLive.attendanceDay;
    const userId = Number(payload.userId);
    const date = new Date(payload.date as string | Date);
    const cloud = await db.findUnique({ where: { userId_date: { userId, date } } });
    if (!cloud) {
        await db.create({ data: payload as Prisma.AttendanceDayUncheckedCreateInput });
        return;
    }

    const at = (v: unknown) => (v == null ? null : new Date(v as string | Date));
    const earliest = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a < b ? a : b);
    const latest = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a > b ? a : b);

    const clock: Record<string, unknown> = {
        firstInAt:     earliest(cloud.firstInAt, at(payload.firstInAt)),
        lastOutAt:     latest(cloud.lastOutAt, at(payload.lastOutAt)),
        lastSeenAt:    latest(cloud.lastSeenAt, at(payload.lastSeenAt)),
        workedMinutes: Math.max(cloud.workedMinutes, Number(payload.workedMinutes) || 0),
        counterId:     cloud.counterId ?? (payload.counterId as number | null) ?? null,
    };

    const incoming = at(payload.updatedAt);
    const officeIsNewer = !incoming || cloud.updatedAt >= incoming;
    const office: Record<string, unknown> = {};
    if (!officeIsNewer) {
        const skip = new Set<string>(["id", "userId", "date", "createdAt", "updatedAt", ...ATTENDANCE_CLOCK_COLUMNS]);
        for (const [k, v] of Object.entries(payload)) if (!skip.has(k)) office[k] = v;
    }

    await db.update({
        where: { id: cloud.id },
        data:  { ...office, ...clock } as Prisma.AttendanceDayUncheckedUpdateInput,
    });
}

/** The payload limited to the model's own columns (see SyncRegistryEntry.columns). */
function onlyColumns(payload: Record<string, unknown>, columns: readonly string[]): Record<string, unknown> {
    const keep = new Set(columns);
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) if (keep.has(key)) out[key] = value;
    return out;
}

/** The payload minus its running-total columns, for the UPDATE half of an upsert. */
function withoutCache(payload: Record<string, unknown>, cache: readonly string[]): Record<string, unknown> {
    if (cache.length === 0) return payload;
    const out = { ...payload };
    for (const col of cache) delete out[col];
    return out;
}
