/**
 * "Does this device still hold a counter?" — answered once, in the server, for
 * everything that must act on it.
 *
 * ── One answer, three consumers ─────────────────────────────────────────────
 * `resolveBinding` is the query behind `/api/pos/counters/my-binding`: the renderer's
 * reconciler and the login page ask it to decide whether to sign out and wipe. The same
 * answer now also drives two things the renderer cannot enforce:
 *
 *   • the outbox flusher (flusher.ts) — a released counter pushes NOTHING. There is no
 *     server between a counter and Supabase for pushes: the flusher writes from this
 *     process with the database credential, so "rejected on sync" can only happen here.
 *   • `requireAuth` (permissions.ts) — a released machine that is still online cannot
 *     save or create anything while the reconciler is on its way to sign the user out.
 *
 * ── Replica by default, the DB itself only where it must be ────────────────
 * Owner rule: the DB binding is the truth and the replica is the DB's answer one cycle
 * late at most — so the API gate reads the replica (no egress). Two callers ask the DB
 * itself, both for the same reason — the replica has not been told yet:
 *
 *   • the flusher — it is about to write to Supabase anyway, and at the moment a counter
 *     reconnects after hours offline the replica still says "bound" because the worker
 *     has not pulled. One row read before a push keeps a sale billed after the release
 *     out of the books.
 *   • the reconciler, on the `settings` change signal only (`authoritative=1`) — the
 *     signal arrives ahead of the worker's pull, so the replica would answer "still
 *     bound" and the release would wait out a whole sync cycle. One row per real event,
 *     never on a timer.
 *
 * ── Never refuse on silence ─────────────────────────────────────────────────
 * Unreachable — replica not ready, cloud down — is `reachable: false`, never released.
 * Only a POSITIVE "no row carries this PC's id" changes behaviour. And a machine with
 * no `counter-setup.json` (fresh, or just wiped) has nothing to be released from.
 *
 * Identity: `COUNTER_MACHINE_ID` (this installation's id) and `COUNTER_USER_DATA`
 * (where the setup file lives) are forwarded by electron/main.ts when it forks this
 * server. Off Electron both are absent and every guard here is inert.
 */

import * as fs from "fs";
import * as path from "path";
import { prisma, prismaAuthoritative } from "@/shared/lib/prisma/prismaClient";
import { IS_COUNTER_PC, isReplicaReady } from "@/shared/lib/prisma/counterMode";
import { refreshReplicaReadiness } from "@/shared/lib/prisma/replicaReadiness";

export interface BoundCounter { id: number; counterNumber: number; name: string }
export interface OpenShift { id: number; status: "OPEN" | "AWAITING_HANDOVER"; userId: number }

export interface BindingAnswer {
    /** False when the question could not be answered — keep trusting the local file. */
    reachable: boolean;
    counter: BoundCounter | null;
    openShift?: OpenShift | null;
}

const OPEN_STATUSES = ["OPEN", "AWAITING_HANDOVER"] as const;

/**
 * Which counter (if any) these device ids are bound to, and its live shift.
 *
 * `authoritative` reads one row from Supabase and falls through to the replica when
 * the cloud is unreachable — "cannot reach the cloud" is not "released".
 */
export async function resolveBinding(ids: string[], opts: { authoritative?: boolean } = {}): Promise<BindingAnswer> {
    // No identity resolved (Electron id not ready, bridge not running): cannot tell
    // "released" from "cannot check", so say so rather than guess.
    if (ids.length === 0) return { reachable: false, counter: null };

    try {
        if (opts.authoritative) {
            try {
                const counter = await prismaAuthoritative.posCounter.findFirst({
                    where:  { boundDeviceId: { in: ids } },
                    select: { id: true, counterNumber: true, name: true },
                });
                if (!counter) return { reachable: true, counter: null };
                const openShift = await prismaAuthoritative.posShift.findFirst({
                    where:  { counterId: counter.id, status: { in: [...OPEN_STATUSES] } },
                    select: { id: true, status: true, userId: true },
                });
                return { reachable: true, counter, openShift: openShift as OpenShift | null };
            } catch {
                // Offline after all — the replica answers.
            }
        }

        if (IS_COUNTER_PC) {
            // Rate-limited internally; one query per TTL, not per call. Before the
            // worker's first cycle, or during a wipe, the replica cannot answer — and
            // reading through `prisma` then would fall through to Supabase.
            await refreshReplicaReadiness();
            if (!isReplicaReady()) return { reachable: false, counter: null };
        }

        // Every row that carries this device — not just the first. A replica can hold a
        // stale binding beside the real one (a counter this PC held before, whose release
        // has not landed yet); picking one would tell this machine it is the counter it
        // used to be. Two answers means "cannot tell" — the next pull settles it.
        const matches = await prisma.posCounter.findMany({
            where:  { boundDeviceId: { in: ids } },
            select: { id: true, counterNumber: true, name: true },
            take:   2,
        });
        if (matches.length > 1) return { reachable: false, counter: null };
        if (matches.length === 0) return { reachable: true, counter: null };
        const counter = matches[0];
        const openShift = await prisma.posShift.findFirst({
            where:  { counterId: counter.id, status: { in: [...OPEN_STATUSES] } },
            select: { id: true, status: true, userId: true },
        });
        return { reachable: true, counter, openShift: openShift as OpenShift | null };
    } catch {
        // The replica could not be read — silence, not a release.
        return { reachable: false, counter: null };
    }
}

// ── This PC ──────────────────────────────────────────────────────────────────

interface CounterSetupFile { counterId: number; counterNumber: number }

/**
 * What the setup file says, and — the part that matters — whether it said anything.
 *
 *   absent     — there is genuinely no counter here: no file, or a file whose contents
 *                are not a setup (empty, truncated mid-write, wrong shape). A positive
 *                answer, and the one the gates may act on.
 *   unreadable — the file is there but this read failed: locked by the writer, a
 *                permission blip, the disk busy. Silence, not an answer. Acting on it
 *                would send a perfectly good till to the setup wizard, which is exactly
 *                what "never refuse on silence" exists to prevent.
 */
type SetupRead =
    | { state: "present"; setup: CounterSetupFile }
    | { state: "absent" }
    | { state: "unreadable" };

function readCounterSetupState(): SetupRead {
    const dir = process.env.COUNTER_USER_DATA;
    if (!dir) return { state: "absent" };
    const file = path.join(dir, "counter-setup.json");
    let raw: string;
    try {
        if (!fs.existsSync(file)) return { state: "absent" };
        raw = fs.readFileSync(file, "utf-8");
    } catch {
        // The file is there and could not be read — the one case that must stay silent.
        return { state: "unreadable" };
    }
    try {
        const data = JSON.parse(raw) as Partial<CounterSetupFile>;
        if (typeof data.counterId !== "number" || typeof data.counterNumber !== "number") return { state: "absent" };
        return { state: "present", setup: { counterId: data.counterId, counterNumber: data.counterNumber } };
    } catch {
        // Read fine, holds no setup. That IS an answer: this PC has no counter.
        return { state: "absent" };
    }
}

/** The local shortcut electron/main.ts writes at the end of onboarding. Null off Electron,
 *  and null when the file could not be read — every caller here treats null as "nothing to
 *  act on", never as "released". */
export function readCounterSetup(): CounterSetupFile | null {
    const read = readCounterSetupState();
    return read.state === "present" ? read.setup : null;
}

/**
 * Is this a counter PC with NO counter at all — no `counter-setup.json`?
 *
 * A fresh install, or a PC the office released and the reconciler wiped. Distinct from
 * `isThisPcReleased()`, which answers for a file that the DB has positively disowned:
 * that one is deliberately silent when there is no file, because the flusher has
 * nothing to refuse on a PC with no outbox. The API and page gates need the opposite
 * rule — a PC without a counter has no id block, so anything it saved would be numbered
 * in the cloud's range and never synced; it may do nothing but onboard. No cache: one
 * `existsSync`, no DB read.
 *
 * Only a POSITIVE "there is no setup here" counts. A file that exists but could not be
 * read this instant is silence — this gate stops every API write and every protected
 * page, so answering true on a locked file would throw a working till into the setup
 * wizard for the length of one bad read.
 */
export function isThisPcWithoutCounter(): boolean {
    if (!IS_COUNTER_PC) return false;
    // Identity not forwarded (should not happen on Electron) — cannot tell, stay inert.
    if (!process.env.COUNTER_USER_DATA) return false;
    return readCounterSetupState().state === "absent";
}

/** Same TTL as the replica-readiness cache. */
const CACHE_TTL_MS = 30_000;
let cachedReleased: { value: boolean; at: number } | null = null;

/**
 * Has the DB positively said this PC no longer holds the counter its setup file names?
 *
 * `authoritative` asks Supabase (the flusher); otherwise the replica (the API gate).
 * `force` skips the cache. False whenever the question cannot be answered.
 */
export async function isThisPcReleased(opts: { authoritative?: boolean; force?: boolean } = {}): Promise<boolean> {
    if (!IS_COUNTER_PC) return false;
    const machineId = process.env.COUNTER_MACHINE_ID;
    const setup = readCounterSetup();
    // Nothing to be released FROM: a fresh machine, or one the wipe just cleaned.
    if (!machineId || !setup) {
        cachedReleased = null;
        return false;
    }
    if (!opts.force && cachedReleased && Date.now() - cachedReleased.at < CACHE_TTL_MS) return cachedReleased.value;

    const answer = await resolveBinding([machineId], { authoritative: opts.authoritative });
    const released = answer.reachable && (!answer.counter || answer.counter.id !== setup.counterId);
    cachedReleased = { value: released, at: Date.now() };
    return released;
}
