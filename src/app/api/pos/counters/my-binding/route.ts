// GET /api/pos/counters/my-binding?deviceId=…[&authoritative=1]
//
// "Does this PC still hold a counter, and is its shift still open?" — answered from the
// replica, except on two events while online (`authoritative=1`), where one row is read
// from Supabase: at login, so a release is caught at sign-in; and when the `settings`
// change signal announces a counter setting moved, so a release lands in seconds rather
// than waiting for the sync worker to pull it (see CounterReconciler.tsx).
//
// The query itself lives in shared/lib/counter/releaseGuard.ts, because the same answer
// also decides whether this machine's outbox may push and whether its API writes are
// accepted — see that file for the replica-vs-DB rules and why "unreachable" is never
// "released". This route is the renderer's window onto it.
//
// Off a counter PC (a browser, Vercel) there is no replica and `prisma` is live; the
// route still works, it just is not what Electron calls in practice.

import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { resolveBinding } from "@/shared/lib/counter/releaseGuard";

export async function GET(req: NextRequest) {
    // A released PC must still be able to ask — this is how it finds out.
    const { response } = await requireAuth({ allowReleased: true });
    if (response) return response;

    const { searchParams } = new URL(req.url);
    // One id per app version (Electron installation id, or the web bridge's id), never
    // cross-matched — see shared/lib/counter/identity.ts.
    const ids = [searchParams.get("deviceId")?.trim()].filter((v): v is string => !!v);

    const answer = await resolveBinding(ids, { authoritative: searchParams.get("authoritative") === "1" });
    return NextResponse.json(answer);
}
