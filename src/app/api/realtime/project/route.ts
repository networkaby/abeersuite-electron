import { realtimePrimary } from "@/shared/lib/db/dbPrimary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/realtime/project — which Supabase realtime project goes with the primary
 * database right now: { primary: "DB1" | "DB2" }. Read once per page by
 * `supabaseClient.ts`. No sign-in: it says only which of two public project URLs (both
 * already in the page bundle) to use.
 */
export function GET() {
    return Response.json({ primary: realtimePrimary() }, { headers: { "Cache-Control": "no-store" } });
}
