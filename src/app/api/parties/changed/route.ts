import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";

/**
 * GET /api/parties/changed?since=<iso>
 *
 * Which parties moved since `since` — IDS ONLY, no rows.
 *
 * This is the server half of the browser's party cache (`partyCatalog.ts`), and
 * it is deliberately the *smaller* half. The cache is not a replica: it holds
 * only the parties someone at this counter actually looked up — the regulars,
 * which is a fraction of the customer list. So the question this endpoint
 * answers is not "give me everything new" but "did anything move at all", and
 * the client intersects the answer with what it happens to be holding.
 *
 * WHY IDS AND NOT ROWS. Sending the changed rows would push every customer
 * created anywhere — other tills, other branches, the website — into every
 * counter's cache, whether or not that counter will ever bill them. That is the
 * full-replica cost again, just paid in instalments. An id list is a few bytes
 * per change, the client drops the ones it holds, and a party it has never seen
 * stays unfetched until someone actually types the name — at which point the
 * ordinary live lookup fetches it and the cache keeps it.
 *
 * WHY DROP RATHER THAN REFRESH. A changed party is simply forgotten. Re-fetching
 * it would spend a query on a customer who may not walk in again today; the next
 * person who searches for them pays the same single lookup they would have paid
 * anyway, and gets the fresh row. Cheaper, and one less way for the cache to
 * disagree with the database.
 *
 * `mode: "reset"` tells the client to forget everything and start collecting
 * again. It is the answer whenever a precise one would cost more than it saves:
 * no usable `since`, a gap longer than a cached row is allowed to live, or so
 * many changes that listing them is worse than rebuilding on demand.
 */

/** Past this gap every row the client could still be holding has expired on its
 *  own (`CACHE_MAX_AGE_MS` in `partyCatalog.ts`), so listing changes is pointless. */
const MAX_GAP_MS = 7 * 24 * 60 * 60 * 1000;

/** Beyond this many changed parties, naming them costs more than a rebuild. */
const MAX_IDS = 500;

export async function GET(req: NextRequest) {
    const { response } = await requireAuth();
    if (response) return response;

    try {
        // Captured BEFORE reading, so a party written mid-request still sits past
        // this clock and is reported by the next call rather than being skipped.
        const now = new Date();
        const sinceParam = req.nextUrl.searchParams.get("since");
        const since = sinceParam ? new Date(sinceParam) : null;

        const usable =
            since != null
            && !Number.isNaN(since.getTime())
            && now.getTime() - since.getTime() < MAX_GAP_MS;

        if (!usable) {
            return NextResponse.json({ mode: "reset", checkedAt: now.toISOString() });
        }

        // Deactivation is an ordinary `updatedAt` bump, so it arrives here as a
        // change like any other and the client drops the row — which is exactly
        // right, since every consumer only ever offers active parties.
        const where = { updatedAt: { gt: since! } };
        const select = { id: true } as const;
        const [persons, companies] = await Promise.all([
            prisma.person.findMany({ where, select, take: MAX_IDS + 1 }),
            prisma.company.findMany({ where, select, take: MAX_IDS + 1 }),
        ]);

        if (persons.length > MAX_IDS || companies.length > MAX_IDS) {
            return NextResponse.json({ mode: "reset", checkedAt: now.toISOString() });
        }

        return NextResponse.json({
            mode: "ids",
            checkedAt: now.toISOString(),
            customers: persons.map((p) => p.id),
            companies: companies.map((c) => c.id),
        });
    } catch (e) {
        return handleApiError(e, "Failed to check party changes");
    }
}
