import { primaryRealtimePair, realtimePrimary } from "@/shared/lib/db/dbPrimary";
import { parseCounterPc } from "@/shared/lib/appModeCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/realtime/project — which Supabase realtime project goes with the primary
 * database right now: { primary: "DB1" | "DB2" }. Read once per page by
 * `supabaseClient.ts`. No sign-in: it says only which of two public project URLs (both
 * already in the page bundle) to use. On a counter PC it also gives the pair the office
 * handed over (`url`, `key` — publishable, public by design), the only one a counter
 * uses: its screens open Supabase for chat only.
 */
export function GET() {
    const pair = parseCounterPc(process.env.COUNTER_PC) === true ? primaryRealtimePair() : null;
    return Response.json(
        { primary: realtimePrimary(), ...(pair ? { url: pair.url, key: pair.key } : {}) },
        { headers: { "Cache-Control": "no-store" } },
    );
}
