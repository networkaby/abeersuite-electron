// GET /api/pos/counters/my-binding?deviceId=…&legacyDeviceId=…
//
// "Does this PC still hold a counter, and is its shift still open?" — answered from
// the replica, never from Supabase.
//
// ── Why the replica is enough ───────────────────────────────────────────────
// The replica is kept honest by the sync worker: an admin's release on live reaches it
// through the Realtime signal, and the worker's interval cycle is the safety net for a
// signal that was missed. So the row here IS the DB's answer, a cycle late at most. The
// reconciler (CounterReconciler.tsx) re-asks exactly when a pull touched PosCounter, so
// nothing polls the cloud and nothing costs egress. This used to read authoritatively
// on a five-minute timer — the timer is gone, and so is the authoritative read.
//
// ── Not ready is not released ───────────────────────────────────────────────
// Before the worker's first cycle, or while the replica is being wiped, the replica
// cannot answer. Reading through `prisma` then would fall through to Supabase — the
// egress this exists to avoid — so this says `reachable: false` instead, and the caller
// keeps trusting its local file. Only a POSITIVE "no row carries this PC's id" from a
// ready replica means released.
//
// Off a counter PC (a browser, Vercel) there is no replica and `prisma` is live; the
// route still works, it just is not what Electron calls in practice.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { IS_COUNTER_PC, isReplicaReady } from "@/shared/lib/prisma/counterMode";
import { refreshReplicaReadiness } from "@/shared/lib/prisma/replicaReadiness";
import { requireAuth } from "@/shared/lib/auth/permissions";

export async function GET(req: NextRequest) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const ids = [searchParams.get("deviceId"), searchParams.get("legacyDeviceId")]
        .map((v) => v?.trim())
        .filter((v): v is string => !!v);

    // No identity resolved yet (Electron id not ready, bridge not running). We cannot
    // tell "released" from "cannot check", so say so rather than guess.
    if (ids.length === 0) return NextResponse.json({ reachable: false, counter: null });

    try {
        if (IS_COUNTER_PC) {
            // Rate-limited internally; one query per TTL, not per call.
            await refreshReplicaReadiness();
            if (!isReplicaReady()) return NextResponse.json({ reachable: false, counter: null });
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
        if (matches.length > 1) return NextResponse.json({ reachable: false, counter: null });
        if (matches.length === 0) return NextResponse.json({ reachable: true, counter: null });
        const counter = matches[0];

        // The counter's currently live shift, if any. A recovering PC needs this to know
        // whether to resume (still OPEN — the ordinary device swap) or to start a fresh
        // shift (the office force-closed it while this machine was down).
        const openShift = await prisma.posShift.findFirst({
            where:  { counterId: counter.id, status: { in: ["OPEN", "AWAITING_HANDOVER"] } },
            select: { id: true, status: true, userId: true },
        });

        return NextResponse.json({ reachable: true, counter, openShift });
    } catch {
        // The replica could not be read — silence, not a release.
        return NextResponse.json({ reachable: false, counter: null });
    }
}
