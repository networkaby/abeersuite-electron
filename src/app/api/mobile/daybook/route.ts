import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { voucherTypeLabel } from "@/shared/lib/format/voucherTypeLabel";
import { GET as dayBook } from "@/app/api/accountancy/reports/day-book/route";
import { booksUnchangedSince } from "@/modules/mobile/booksUnchanged";

/** A phone screen holds a day; most days fit in one page. */
const PAGE_SIZE = 100;

type OfficeRow = {
    id: string;
    kind: string;
    reference: string;
    narration: string | null;
    party: string | null;
    partyAccountId: number | null;
    totalAmount: number;
    status: string;
};
type OfficePage = { rows: OfficeRow[]; nextCursor: number | null; refs: { accounts: { id: number; name: string }[] } };

// GET /api/mobile/daybook?date=YYYY-MM-DD[&q=<search>&cursor=<id>]
//
// One day of the office Day Book, behind the phone's own tick. The request is
// handed to the office handler itself rather than copied, so the two can never
// disagree about what a day holds; only the reply is trimmed to what a phone
// shows, with party names already resolved.
//
// `?since=` on the first page: `{ unchanged: true }` when nothing in the books
// has moved since (booksUnchangedSince) — the phone keeps the day it holds.
export async function GET(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.MOBILE_DAYBOOK_VIEW);
    if (response) return response;

    const params = new URL(req.url).searchParams;
    const date = params.get("date") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Pick a date" }, { status: 400 });

    const now = new Date();
    const cursor = params.get("cursor");
    if (!cursor && (await booksUnchangedSince(params.get("since"), now))) {
        return NextResponse.json({ unchanged: true, computedAt: now.toISOString() });
    }

    const office = new URL("/api/accountancy/reports/day-book", req.url);
    office.searchParams.set("from", date);
    office.searchParams.set("to", date);
    office.searchParams.set("take", String(PAGE_SIZE));
    if (cursor) office.searchParams.set("cursor", cursor);
    // Party name, voucher number or narration — the office Day Book's own search.
    const q = params.get("q")?.trim();
    if (q) office.searchParams.set("search", q);

    const res = await dayBook(new Request(office, { headers: req.headers }));
    if (!res.ok) return res;
    const page = (await res.json()) as OfficePage;
    const accountName = new Map(page.refs.accounts.map((a) => [a.id, a.name]));

    return NextResponse.json({
        computedAt: now.toISOString(),
        items: page.rows.map((r) => ({
            id: r.id,
            kind: voucherTypeLabel(r.kind) ?? r.kind,
            ref: r.reference,
            party: r.party ?? (r.partyAccountId != null ? accountName.get(r.partyAccountId) ?? null : null),
            narration: r.narration,
            amount: r.totalAmount,
            status: r.status,
        })),
        hasMore: page.nextCursor != null,
        next: page.nextCursor,
    });
}
