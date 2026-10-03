import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";
import { partyBalances } from "@/modules/mobile/lib/partyBalances";
import { booksUnchangedSince } from "@/modules/mobile/lib/booksUnchanged";

/** Rows a phone shows at once, with headroom; anything past it is refused. */
const MAX_IDS = 60;

const parseIds = (raw: string | null): number[] =>
    [...new Set((raw ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0))];

// GET /api/mobile/parties?ids=<accountIds on screen>[&known=<ids the phone holds>&since=<computedAt>]
//
// Balances for the party rows the phone is showing. The phone searches the party
// list it already holds (parties/partyCatalog, the same list and the same search
// as every office party box) — there is no party search here, by the rule that
// party search reads the whole list from memory.
//
// Summed from the ledger for just these accounts (`partyBalances`), signed the
// party's way round (+ to receive, − to pay).
//
// `known` + `since`: when nothing in the books has moved since the phone's
// figures, only the ids it does NOT hold yet are summed and the answer says
// `unchanged: true` — the ones it holds stand. Otherwise every id is summed and
// the phone replaces what it held.
export async function GET(req: NextRequest) {
    const { response } = await requirePermission(PERMISSIONS.MOBILE_PARTIES_VIEW);
    if (response) return response;

    const params = req.nextUrl.searchParams;
    const ids = parseIds(params.get("ids"));
    if (ids.length === 0) return NextResponse.json({ error: "ids required" }, { status: 400 });
    if (ids.length > MAX_IDS) return NextResponse.json({ error: `At most ${MAX_IDS} ids` }, { status: 400 });

    try {
        const now = new Date();
        const known = new Set(parseIds(params.get("known")));
        const unchanged = known.size > 0 && (await booksUnchangedSince(params.get("since"), now));
        const toSum = unchanged ? ids.filter((id) => !known.has(id)) : ids;
        const balances = toSum.length > 0 ? await partyBalances(toSum) : new Map<number, number>();

        return NextResponse.json({
            unchanged,
            computedAt: now.toISOString(),
            balances: Object.fromEntries(balances),
        });
    } catch (e) {
        return handleApiError(e, "Could not load balances");
    }
}
