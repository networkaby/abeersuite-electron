import { NextResponse } from "next/server";
import { hasPermission, requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { voucherTypeLabel } from "@/shared/lib/format/voucherTypeLabel";
import { GET as dayBook } from "@/app/api/accountancy/reports/day-book/route";
import { booksUnchangedSince } from "@/modules/mobile/lib/booksUnchanged";
import { supplierAccountIds } from "@/modules/mobile/lib/supplierGuard";
import { SUPPLIER_SIDE_TYPES } from "@/modules/accountancy/lib/tradingVoucherKinds";

/** A phone screen holds a day; most days fit in one page. */
const PAGE_SIZE = 100;

type OfficeRow = {
    id: string;
    /** The spine id — what the phone's voucher screen opens. */
    sortId: number;
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
// Without "Show suppliers (creditors)" a day loses its supplier side, as SL Search
// does in the office: purchase-side kinds (SUPPLIER_SIDE_TYPES) and any voucher
// whose party is a Sundry Creditor (a payment to a supplier). The phone's totals
// are summed over the rows it is sent, so they stay consistent.
//
// `?since=` on the first page: `{ unchanged: true }` when nothing in the books
// has moved since (booksUnchangedSince) — the phone keeps the day it holds.
export async function GET(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.MOBILE_DAYBOOK_VIEW);
    if (response) return response;
    const hideSuppliers = !hasPermission(user, PERMISSIONS.CUSTOMERS_VIEW_CREDITORS);

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
    const suppliers = hideSuppliers
        ? await supplierAccountIds([...new Set(page.rows.flatMap((r) => (r.partyAccountId != null ? [r.partyAccountId] : [])))])
        : new Set<number>();
    const rows = hideSuppliers
        ? page.rows.filter((r) => !SUPPLIER_SIDE_TYPES.includes(r.kind) && !(r.partyAccountId != null && suppliers.has(r.partyAccountId)))
        : page.rows;

    return NextResponse.json({
        computedAt: now.toISOString(),
        items: rows.map((r) => ({
            id: r.id,
            uvId: r.sortId,
            kind: voucherTypeLabel(r.kind) ?? r.kind,
            ref: r.reference,
            party: r.party ?? (r.partyAccountId != null ? accountName.get(r.partyAccountId) ?? null : null),
            narration: r.narration,
            amount: r.totalAmount,
            status: r.status,
        })),
        hasMore: page.nextCursor != null,
        more: page.nextCursor != null ? { cursor: String(page.nextCursor) } : null,
    });
}
