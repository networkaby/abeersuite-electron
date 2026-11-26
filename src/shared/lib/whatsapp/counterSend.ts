/**
 * The once-only claim and the "no internet yet" retries for a customer message —
 * the parts of `notifyBill.ts` that decide when a message may go, kept pure (no
 * server-only, no Prisma) so the tests can fake the database and Meta.
 *
 * Who sends: a counter under `WRITE_MODE=live` saves straight into Supabase and
 * holds the Meta token (handed over by /api/counter/config), so it sends WhatsApp
 * itself. `v_live` (the save runs at the office) and an outage (the save is on the
 * replica, the office has not got it) still ask the office.
 */
import type { WritePreference } from "@/shared/lib/prisma/counterMode";

/** Waits before each try. Staff waiting on a button get the short list. */
export const AUTO_WAITS_MS = [0, 3_000, 15_000, 40_000];
export const MANUAL_WAITS_MS = [0, 2_000];

/** Does this counter send WhatsApp itself? False on the office server. */
export function sendsFromCounter(m: { isCounter: boolean; write: WritePreference; writeLocal: boolean }): boolean {
    return m.isCounter && m.write === "live" && !m.writeLocal;
}

/** Nothing was claimed, so nothing was sent — safe to try again. */
export class NotClaimed extends Error {
    override name = "NotClaimed";
}

/** Marks our own claim row in `waError` until the send overwrites it. */
export const claimToken = (): string => `claim:${crypto.randomUUID()}`;

export type ClaimDb = {
    /** Insert the (kind, refId) row with `waError = token`. */
    create(token: string): Promise<unknown>;
    find(): Promise<{ waStatus: string; waError: string | null } | null>;
};

export type Claim = { mine: true } | { mine: false; wa?: string };

/**
 * Take the (kind, refId) row. Only a unique-key clash means someone else has it.
 * Any other failure leaves us unsure whether the insert landed, so the row is read
 * back: our token → ours; another → already taken; no row → `NotClaimed`.
 */
export async function claimOnce(db: ClaimDb, token: string): Promise<Claim> {
    try {
        await db.create(token);
        return { mine: true };
    } catch (e) {
        const clash = (e as { code?: unknown } | null)?.code === "P2002";
        const row = await db.find().catch(() => undefined);
        if (row === undefined) {
            if (clash) return { mine: false };
            throw new NotClaimed(e instanceof Error ? e.message : String(e));
        }
        if (row && !clash && row.waError === token) return { mine: true };
        if (row) return { mine: false, wa: row.waStatus };
        if (clash) return { mine: false };
        throw new NotClaimed(e instanceof Error ? e.message : String(e));
    }
}

/**
 * Run `attempt` after each wait until it returns. `attempt` must throw only
 * before anything was claimed (a failure after the claim is its own answer).
 * Null when every try failed.
 */
export async function retryBeforeClaim<T>(
    attempt: () => Promise<T>,
    waits: number[],
    sleep: (ms: number) => Promise<unknown> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<T | null> {
    for (const wait of waits) {
        if (wait) await sleep(wait);
        try {
            return await attempt();
        } catch (e) {
            console.warn("[counter-send] not sent yet:", e instanceof Error ? e.message : e);
        }
    }
    return null;
}
