/**
 * Which counter a row was RAISED at — the value behind `sourceCounterId` on
 * UniversalVoucher (every voucher kind) and Ticket.
 *
 * Both tables carry the SAME column with the SAME meaning and are filled by the
 * SAME resolver here, so one formatter renders both and one filter queries both.
 *
 * ── Why a resolver and not just "read the local setup file" ──────────────────
 * A till does not always execute its own writes. Under `WRITE_MODE=v_live` the
 * counter RELAYS every non-GET `/api/*` call to the office deployment, so the
 * route code runs on the OFFICE machine, where `counter-setup.json` belongs to
 * nobody. Reading the local file there would stamp every relayed sale as
 * "office" — exactly the rows we most want attributed.
 *
 * The relay already solves this and always has: writeRelay.ts stamps
 * `x-abeer-counter-number` on every forwarded request. Until now the office
 * discarded it (see the note on RELAY_HEADER in relayPolicy.ts). This module is
 * the office finally reading it.
 *
 * ── Order of resolution ─────────────────────────────────────────────────────
 *   1. the relayed header  — a till billing through the office (`W: Office`)
 *   2. this PC's own setup — a till writing locally / offline
 *   3. null                — the office itself; a real and correct answer
 *
 * ── On trusting the header ──────────────────────────────────────────────────
 * It is client-supplied, so a signed-in user could forge it. That is acceptable
 * here and only here: this is PROVENANCE, never permission — nothing reads it to
 * decide what someone may do. The number is still checked against a real counter
 * and anything unrecognised resolves to null rather than being stored, so a bad
 * value can leave a row unattributed but can never attribute it to a counter that
 * does not exist.
 */

import "server-only";

import { headers } from "next/headers";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { readCounterSetup } from "@/shared/lib/counter/releaseGuard";

/**
 * Either the global client or an open transaction's.
 *
 * Callers inside a transaction MUST pass their `tx`. Reading through the global
 * client while a transaction is open takes a SECOND connection from the pool and
 * holds it until the first one commits — under load that is how a pool starves
 * and every request blocks. Every voucher is written inside a transaction, so
 * this is the common case here, not the rare one.
 */
type DbClient = Prisma.TransactionClient | typeof prisma;

/** Set by writeRelay.ts on every relayed request. */
export const COUNTER_NUMBER_HEADER = "x-abeer-counter-number";

/**
 * counterNumber → counterId.
 *
 * We store the ID, not the number: a counter can be RENUMBERED (see
 * /api/pos/counters), and a stored number would silently re-point every historic
 * row at whoever holds that number next. The id never moves.
 *
 * Cached because this runs on the write path of every voucher and every ticket,
 * and the table it reads is tiny and near-static — at most 99 counters
 * (MAX_COUNTER_NUMBER), changing only when the office adds or renumbers one.
 * Without the cache this would be one extra round trip per save, forever.
 */
let cache: { at: number; byNumber: Map<number, number> } | null = null;
const CACHE_MS = 5 * 60_000;

/** Drop the cache — call after a counter is created, renumbered or removed. */
export function forgetCounterCache(): void {
    cache = null;
}

async function counterIdForNumber(db: DbClient, counterNumber: number): Promise<number | null> {
    if (!cache || Date.now() - cache.at > CACHE_MS) {
        const rows = await db.posCounter.findMany({ select: { id: true, counterNumber: true } });
        cache = { at: Date.now(), byNumber: new Map(rows.map((c) => [c.counterNumber, c.id])) };
    }
    return cache.byNumber.get(counterNumber) ?? null;
}

/**
 * The counter this write is being raised at, or null for the office.
 *
 * It reads the incoming request's headers itself, so a call site is one uniform
 * line in every voucher path and the ticket path alike. Threading a `Headers`
 * down through the whole engine would have put the same plumbing in dozens of
 * signatures for a value only this function ever looks at.
 *
 * Pass `tx` whenever there is one open — see DbClient above.
 *
 * Never throws: provenance must not be able to fail a sale. Outside a request
 * (a seed, a background job) `headers()` throws and we fall through to the local
 * setup; anything else unexpected resolves to null, which reads as
 * "office / unknown" everywhere downstream.
 */
export async function sourceCounterId(db: DbClient = prisma): Promise<number | null> {
    return (await resolveSource(db))?.counterId ?? null;
}

/**
 * The same answer as `sourceCounterId`, as the counter's NUMBER — what voucher
 * numbering runs on (`nextRefFromSeries`). null means the office, which numbers
 * as counter 1. Same order, same never-throws promise.
 */
export async function sourceCounterNumber(db: DbClient = prisma): Promise<number | null> {
    return (await resolveSource(db))?.counterNumber ?? null;
}

async function resolveSource(db: DbClient): Promise<{ counterId: number; counterNumber: number } | null> {
    // 1. Relayed from a till — the office's only way to know who is billing.
    try {
        const raw = (await headers()).get(COUNTER_NUMBER_HEADER)?.trim();
        if (raw) {
            const n = Number(raw);
            if (!Number.isInteger(n) || n <= 0) return null;
            // A number matching no counter is attributed to nothing, never guessed.
            const counterId = await counterIdForNumber(db, n);
            return counterId == null ? null : { counterId, counterNumber: n };
        }
    } catch {
        // No request in scope (seed / job), or headers unavailable. Not an error:
        // fall through and let this machine answer for itself.
    }

    // 2. This machine is the till, writing its own rows. The setup file holds the
    //    id directly, so no lookup is needed.
    try {
        const setup = readCounterSetup();
        return setup ? { counterId: setup.counterId, counterNumber: setup.counterNumber } : null;
    } catch {
        // 3. The office, or a read that failed. Either way: unattributed.
        return null;
    }
}
