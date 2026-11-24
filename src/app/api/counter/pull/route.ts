import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { isTopic, modelsForTopics, type Topic } from "@/shared/lib/realtime/topics";
import { pullAndWait } from "@/shared/lib/counter/replicaPull";
import { getMode } from "@/shared/lib/prisma/counterMode";

/**
 * POST /api/counter/pull — "my save just landed in Supabase; bring it into this
 * replica before I re-read". Body: `{ topics: Topic[] }`.
 *
 * The `WRITE_MODE=live` + replica-read half of read-your-write. Under `v_live` the
 * relay holds its own response for the same targeted pull (writeRelay.ts); under
 * `live` the route runs HERE and the proxy runs before it, so nothing server-side can
 * wait after the save. The browser's change publisher (appChannel.ts
 * `attachChangePublisher`) calls this instead and only then hands the save's response
 * to the screen. Without it the till learnt of its own save by a round trip through
 * Supabase Realtime plus the worker's settle window — seconds of stale screen.
 *
 * Never relayed (`/api/counter` is local-only in relayPolicy.ts) and never announced
 * (no topic rule matches it). Bounded and never fails: `pullAndWait` resolves within
 * 3 s, and is a no-op without a replica (the office).
 */
export async function POST(req: NextRequest) {
    const { response } = await requireAuth({ allowReleased: true });
    if (response) return response;
    // Supabase is down: the save fell back to this replica and its outbox, so it is
    // already here — and a pull could only wait out its 3 s for nothing.
    if (getMode() === "LOCAL") return NextResponse.json({ ok: true });

    let topics: Topic[] = [];
    try {
        const body = (await req.json()) as { topics?: unknown };
        if (Array.isArray(body.topics)) {
            topics = body.topics.filter(isTopic);
        }
    } catch { /* bad body → nothing to pull */ }

    await pullAndWait(modelsForTopics(topics));
    return NextResponse.json({ ok: true });
}
