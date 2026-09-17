import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError, parseCursor, deltaSlice, pageSlice } from "@/shared/lib/api";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import { readPartyName } from "@/shared/lib/accountancy/partySnapshot";
import { voucherSourceForType } from "@/modules/accountancy/lib/voucherUrls";
import { loadSettlements, type Settlement, type SettlementState } from "@/modules/accountancy/lib/billLink";
import { kindsForFilter, kindsForCategory, NON_REGULAR_KINDS } from "@/modules/accountancy/lib/voucherKinds";
import { parseSince } from "@/shared/lib/prisma/counterMode";

/**
 * GET /api/accountancy/reports/day-book
 *
 * The Day Book, newest first, in two modes:
 *
 *   • PAGE  (default)  — one cursor page of rows. `?cursor=<id>` walks backwards.
 *   • DELTA (`?since`) — only what changed since that instant, for a client that
 *                        already holds a copy. Includes tombstones for rows that
 *                        were deleted, which a plain "what changed" query cannot
 *                        see because the row is physically gone.
 *
 * This replaces the old three-way client merge (inventory + GL + journal
 * endpoints, stitched together in the browser). Since the Phase 5 spine work all
 * three read the SAME table — UniversalVoucher — so the merge was querying one
 * table three times, and journals came back twice over (the GL route's
 * FINANCIAL_TYPES includes JOURNAL and the journal route returns it again), which
 * showed every journal as two Day Book rows.
 *
 * Reading it as one ordered query also makes paging honest: `(date desc, id desc)`
 * with a cursor gives a stable, gap-free walk backwards through the books, which
 * a merge of three independently-paged sources cannot.
 *
 * FILTERING IS SERVER-SIDE. It has to be — with paging, filtering in the browser
 * would only filter the rows already pulled, so a kind with hundreds of matches
 * would show whatever few happened to land on the current page.
 *
 * The response is NORMALISED: rows carry ids (branchId / createdById /
 * partyAccountId) and the names live once in `refs`. That keeps a renamed branch
 * or customer from having to be chased across thousands of cached rows, and stops
 * the same strings being sent 50 times a page.
 */

/** Names for rows the client may hold but did not ask for on this page. */
const MAX_CHANGED_ACCOUNTS = 200;
/** Party-name search is a pre-resolve against Account; keep it bounded. */
const MAX_SEARCH_ACCOUNTS = 500;
const VALID_STATUSES = ["DRAFT", "POSTED", "CANCELLED"] as const;
type VoucherStatusFilter = (typeof VALID_STATUSES)[number];

// ── Unpaid-only ("due / partial") ───────────────────────────────────────────
// Settlement is NOT a stored column — it is movement-minus-linked, worked out
// per page (see `loadSettlements`). So `?settlement=open` cannot be a `where`
// clause; the walk stays exactly the same and the route simply scans forward in
// chunks, keeping only the rows that still owe something, until it has a page or
// runs out. The chunk cap keeps one request bounded: hitting it returns a short
// page with a cursor, and the client's normal scroll pulls the rest.
const UNPAID_SCAN_CHUNK = 500;
const MAX_UNPAID_SCAN_CHUNKS = 6;
const OPEN_STATES = new Set(["DUE", "PARTIAL"]);

/** AuditLog.entityType → the CombinedRow source prefix its `originalId` keys. */
const TOMBSTONE_SOURCE: Record<string, string> = {
    INV_VOUCHER:   "inv",
    GL_VOUCHER:    "gl",
    JOURNAL_ENTRY: "je",
};

/** Intersect two kind constraints, either of which may be "no constraint". */
function intersectKinds(a: string[] | null, b: string[] | null): string[] | null {
    if (!a) return b;
    if (!b) return a;
    const bs = new Set(b);
    return a.filter((k) => bs.has(k));
}

/**
 * Bill-wise state for a batch of vouchers. The party's own leg is read off the
 * lines already loaded for the GL total, so the only extra cost is `sumLinked` —
 * a fixed couple of queries per batch, never one per row.
 */
async function settlementsFor(
    batch: { id: number; type: string; status: string; partyAccountId: number | null; lines: { type: string; amount: unknown; accountId: number }[] }[],
    opts: { linkability?: boolean } = {},
) {
    const partyMovement = new Map<number, number>();
    for (const v of batch) {
        if (v.partyAccountId == null) continue;
        let movement = 0;
        for (const l of v.lines) {
            if (l.accountId !== v.partyAccountId) continue;
            movement += l.type === "DEBIT" ? Number(l.amount) : -Number(l.amount);
        }
        partyMovement.set(v.id, movement);
    }
    return loadSettlements(
        prisma,
        batch.map((v) => ({
            universalVoucherId: v.id,
            partyAccountId:     v.partyAccountId,
            kind:               v.type,
            status:             v.status,
        })),
        partyMovement,
        opts,
    );
}

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const { cursor, take } = parseCursor(searchParams);

    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const search = searchParams.get("search")?.trim() ?? "";
    // "UV-812" / "uv 812" / "812" → the spine id it names.
    const uvMatch = search ? /^\s*(?:uv[-\s]?)?(\d{1,10})\s*$/i.exec(search) : null;
    const uvSearchId = uvMatch ? Number(uvMatch[1]) : null;
    const branchId = searchParams.get("branchId");
    const refsSince = parseSince(searchParams.get("refsSince"));
    const since = parseSince(searchParams.get("since"));
    /** Only bills that still owe something — "due" or "partial". */
    const unpaidOnly = searchParams.get("settlement") === "open";
    const statuses = (searchParams.get("statuses") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s): s is VoucherStatusFilter => (VALID_STATUSES as readonly string[]).includes(s));

    // Kind dropdown and the Optional/Inventory category tick are independent
    // constraints on the same column, so they intersect. An empty intersection is
    // a legitimate "nothing can match" (e.g. kind=SALE + category=optional).
    const kinds = intersectKinds(
        kindsForFilter(searchParams.get("kind")),
        kindsForCategory(searchParams.get("category")),
    );
    if (kinds?.length === 0) {
        return NextResponse.json({
            mode: since ? "delta" : "page",
            rows: [], deleted: [], nextCursor: null, overflow: false,
            refs: { branches: [], users: [], accounts: [] },
            computedAt: new Date().toISOString(),
        });
    }

    try {
        // Captured BEFORE the read so a row written mid-request is caught by the
        // next delta rather than falling into the gap between the two.
        const computedAt = new Date();

        // Party search can't run as a plain column filter — inventory rows freeze
        // the party into partyJson and the spine holds only a scalar
        // partyAccountId (there is no relation to filter through). Resolving the
        // ids first turns it back into an indexed `in` lookup.
        const searchAccountIds = search
            ? (await prisma.account.findMany({
                where: { name: { contains: search, mode: "insensitive" } },
                select: { id: true },
                take: MAX_SEARCH_ACCOUNTS,
            })).map((a) => a.id)
            : [];

        const where: Prisma.UniversalVoucherWhereInput = {
            // Always-true guard — nothing writes `deletedAt` (soft-delete removed
            // 2026-08-01). Kept as a cheap net for legacy rows.
            deletedAt: null,
            ...(kinds ? { type: { in: kinds } } : {}),
            ...(statuses.length > 0 ? { status: { in: statuses } } : {}),
            ...(branchId && branchId !== "__all__" ? { branchId } : {}),
            ...(from || to ? {
                date: {
                    ...(from ? { gte: new Date(from) } : {}),
                    // `to` is a plain date; take the whole of that day or a voucher
                    // written this afternoon drops out of a window ending today.
                    ...(to ? { lte: new Date(`${to}T23:59:59.999`) } : {}),
                },
            } : {}),
            // A voucher with no party, not posted, or of a documentary kind can
            // never carry a bill — `loadSettlements` skips exactly these. Saying
            // so in SQL keeps the scan below off rows it would only throw away.
            // A voucher with no party, not posted, or of a documentary kind can
            // never carry a bill — `loadSettlements` skips exactly these. Saying
            // so in SQL keeps the scan below off rows it would only throw away.
            // The kind exclusion goes through `NOT` because `type` is already
            // spoken for above by the kind dropdown.
            ...(unpaidOnly ? {
                partyAccountId: { not: null },
                status: "POSTED" as const,
                NOT: { type: { in: [...NON_REGULAR_KINDS] } },
            } : {}),
            ...(search ? {
                OR: [
                    { voucherNo:   { contains: search, mode: "insensitive" } },
                    { description: { contains: search, mode: "insensitive" } },
                    { narration:   { contains: search, mode: "insensitive" } },
                    // A numberless voucher DISPLAYS as UV-<id> (see the row mapper
                    // below), so typing that back must find it — otherwise the one
                    // identifier a draft has is the one thing you cannot search by.
                    ...(uvSearchId != null ? [{ id: uvSearchId }] : []),
                    ...(searchAccountIds.length > 0 ? [{ partyAccountId: { in: searchAccountIds } }] : []),
                ],
            } : {}),
        };

        const select = {
            id: true, type: true, voucherNo: true, date: true,
            description: true, narration: true, status: true,
            cancelledAt: true, createdAt: true, sourceCreatedAt: true, sourceCounterId: true,
            branchId: true, createdById: true, partyAccountId: true,
            // `accountId` is here for the bill-wise chip: the party's own leg on
            // this voucher is what settlement is measured on, and these lines are
            // already loaded for the GL total below — so it costs no extra query.
            lines: { select: { type: true, amount: true, accountId: true } },
            // The trade detail carries its own id — which is what every inventory
            // edit URL and line-expand fetch keys on, NOT the spine id. Getting
            // this wrong would break the link on every inventory row.
            voucherDetail: {
                select: { id: true, partyJson: true, totalAmount: true, refVoucherId: true },
            },
        } satisfies Prisma.UniversalVoucherSelect;

        // Newest first: day, then the faithful wall-clock within the day, then id.
        //
        // `date` is @db.Date — no time — so it can only group days. `id` alone
        // ordered by insert-at-office, which floats a till's late-synced backlog
        // above vouchers raised days later. `sourceCreatedAt` is when the voucher
        // was actually posted, so it does the real work; `id` remains last, which
        // keeps the order a TOTAL one (id is unique) and so keeps the cursor walk
        // below gap-free. Rows predating `sourceCreatedAt` sort null-last within
        // their day and still land on the right day.
        //
        // NOTE: the client re-sorts with the same key in useDayBook's `byAge`.
        // The two must stay in step — a client ordering differently from the
        // server would mis-place its page boundary and drop rows.
        const orderBy: Prisma.UniversalVoucherOrderByWithRelationInput[] = [
            { date: "desc" },
            { sourceCreatedAt: { sort: "desc", nulls: "last" } },
            { id: "desc" },
        ];

        let found: Prisma.UniversalVoucherGetPayload<{ select: typeof select }>[];
        let nextCursor: number | null = null;
        let overflow = false;
        let deleted: string[] = [];
        // Settlements worked out while scanning are kept, so the row mapper below
        // never re-reads what this request already measured.
        const settlements: Record<number, Settlement> = {};

        if (since) {
            // Delta: everything touched since the client last looked. Rows older
            // than the client's own cursor may come back too — it drops those
            // itself, which is cheaper than teaching the server the client's exact
            // scroll position.
            const delta = await deltaSlice((take) => prisma.universalVoucher.findMany({
                where: { ...where, updatedAt: { gt: since } },
                orderBy,
                take,
                select,
            }));
            overflow = delta.overflow;
            found = delta.changed;

            // Deletion is physical here, so a changed-row query can never report
            // it. The recycle-bin audit row is the only surviving trace, and it is
            // written in the same transaction as the delete.
            if (!overflow) {
                const tombstones = await prisma.auditLog.findMany({
                    where: { createdAt: { gt: since }, restoredAt: null },
                    select: { entityType: true, originalId: true },
                });
                deleted = tombstones
                    .filter((t) => TOMBSTONE_SOURCE[t.entityType])
                    .map((t) => `${TOMBSTONE_SOURCE[t.entityType]}-${t.originalId}`);
            }
        } else if (unpaidOnly) {
            // Scan forward in chunks, keeping only what still owes. The cursor is
            // always an id we have actually looked at, so the walk stays gap-free
            // whether we stop because the page filled or because the cap was hit.
            const kept: typeof found = [];
            let scanCursor = cursor ?? null;
            let exhausted = false;

            for (let chunk = 0; chunk < MAX_UNPAID_SCAN_CHUNKS && kept.length <= take; chunk++) {
                const batch = await prisma.universalVoucher.findMany({
                    where,
                    orderBy,
                    take: UNPAID_SCAN_CHUNK,
                    ...(scanCursor ? { cursor: { id: scanCursor }, skip: 1 } : {}),
                    select,
                });
                if (batch.length === 0) { exhausted = true; break; }
                scanCursor = batch[batch.length - 1].id;
                // While sifting, the state is all that matters — whether a row
                // has anything to link against is asked once, below, about the
                // page we actually settle on.
                Object.assign(settlements, await settlementsFor(batch, { linkability: false }));
                for (const v of batch) {
                    if (OPEN_STATES.has(settlements[v.id]?.state ?? "")) kept.push(v);
                }
                if (batch.length < UNPAID_SCAN_CHUNK) { exhausted = true; break; }
            }

            if (kept.length > take) {
                // More matches than a page: resume from the last row we RETURN.
                found = kept.slice(0, take);
                nextCursor = found[found.length - 1].id;
            } else {
                found = kept;
                // Short page but the books are not finished — hand back the last
                // id scanned so the next scroll picks up exactly where we stopped.
                nextCursor = exhausted ? null : scanCursor;
            }
        } else {
            // take + 1 so we learn whether another page exists without a second query.
            const rowsPlusOne = await prisma.universalVoucher.findMany({
                where,
                orderBy,
                take: take + 1,
                ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
                select,
            });
            ({ rows: found, nextCursor } = pageSlice(rowsPlusOne, take));
        }

        // "Converted" is not a stored flag — it is true while some OTHER voucher
        // points back via refVoucherId. Resolve it for this page's inventory rows
        // in one grouped lookup.
        const detailIds = found.map((v) => v.voucherDetail?.id).filter((id): id is number => id != null);
        const liveRefs = detailIds.length === 0 ? [] : await prisma.voucherDetail.findMany({
            where: {
                refVoucherId: { in: detailIds },
                universalVoucher: { deletedAt: null, status: { not: "CANCELLED" } },
            },
            select: { refVoucherId: true },
        });
        const convertedIds = new Set(liveRefs.map((r) => r.refVoucherId));

        // ── Bill-wise settlement ────────────────────────────────────────────
        // The party's own leg is read off the lines already loaded above for the
        // GL total, so the only extra cost here is `sumLinked` — two queries for
        // the whole page, never one per row. Trading vouchers post their party
        // leg on the same spine (`role:"TENDER"`), so a sale and a receipt are
        // measured by exactly the same rule; a bill taken in full at the counter
        // leaves no leg at all, and that reads as Settled.
        // The unpaid scan above already measured its rows; anything not measured
        // yet (the ordinary page, or a delta) is worked out here in one go.
        // The unpaid scan measured state only, so the rows it settled on are
        // re-measured here in full; every other path is measured from scratch.
        const unmeasured = unpaidOnly
            ? found
            : found.filter((v) => settlements[v.id] === undefined);
        if (unmeasured.length > 0) Object.assign(settlements, await settlementsFor(unmeasured));

        let rows = found.map((v) => {
            const source = voucherSourceForType(v.type);
            const detail = v.voucherDetail;
            // An inventory row keys on its detail id, a GL/journal row on the
            // spine id — so rawId alone collides across sources.
            const rawId = source === "inv" && detail ? detail.id : v.id;
            return {
                id: `${source}-${rawId}`,
                rawId,
                // The spine id — the second half of the server's `(date desc, id
                // desc)` sort key. The client needs it to re-order correctly after
                // merging a delta, and cannot use rawId because inventory rows key
                // on their detail id instead.
                sortId: v.id,
                source,
                kind:      v.type,
                reference: v.voucherNo || formatUvNo(v.id),
                date:      v.date,
                // GL vouchers display `narration`; inventory and journal rows
                // display `description`. Preserved exactly as the three old
                // endpoints presented them.
                narration: source === "gl" ? v.narration : v.description,
                // Inventory rows show the FROZEN party snapshot — immutable on a
                // tax invoice, so it is sent inline and never resolved from refs.
                // GL rows show the live account name, joined from refs by the client.
                party:          detail ? readPartyName(detail.partyJson) : null,
                partyAccountId: v.partyAccountId,
                branchId:       v.branchId,
                createdById:    v.createdById,
                totalAmount: detail
                    ? Number(detail.totalAmount)
                    : v.lines.filter((l) => l.type === "DEBIT").reduce((s, l) => s + Number(l.amount), 0),
                status:      v.status,
                cancelledAt: v.cancelledAt,
                createdAt:   v.createdAt,
                // The wall-clock the sort above uses — the client re-sorts by it.
                sourceCreatedAt: v.sourceCreatedAt,
                sourceCounterId: v.sourceCounterId,
                converted:   detail ? convertedIds.has(detail.id) : false,
                // The spine id — what the bill-wise popup settles against. An
                // inventory row's `rawId` is its DETAIL id, so it cannot stand in
                // for this.
                universalVoucherId: v.id,
                // Bill-wise state. Null where there is no bill to settle: no
                // party, not posted, or a documentary voucher that posts no money.
                settlement:     (settlements[v.id]?.state ?? null) as SettlementState | null,
                settlementOpen: settlements[v.id]?.open  ?? 0,
                // Is there anything on the party's other side to match this
                // against? False hides the chip's chain icon — the popup
                // would open empty.
                canLink:        settlements[v.id]?.canLink ?? false,
            };
        });

        // A delta cannot simply omit a row that has just been paid off — the
        // client still holds it. Under "unpaid only" a newly settled voucher is
        // therefore reported as a removal, which is what makes it leave the list.
        if (unpaidOnly && since) {
            deleted = [
                ...deleted,
                ...rows.filter((r) => !OPEN_STATES.has(r.settlement ?? "")).map((r) => r.id),
            ];
            rows = rows.filter((r) => OPEN_STATES.has(r.settlement ?? ""));
        }

        // ── refs ────────────────────────────────────────────────────────────
        // Branch and User are small enough to ship whole every time, which makes a
        // rename in either self-correct on the next sync with no delta bookkeeping.
        // Accounts are not (every customer has one), so we send the ones this page
        // actually references — always fresh — plus any renamed since the client
        // last looked, which is what corrects rows deeper in its cache.
        const pageAccountIds = [...new Set(rows.map((r) => r.partyAccountId).filter((id): id is number => id != null))];
        const accountOr: Prisma.AccountWhereInput[] = [
            ...(pageAccountIds.length > 0 ? [{ id: { in: pageAccountIds } }] : []),
            ...(refsSince ? [{ updatedAt: { gt: refsSince } }] : []),
        ];
        const [branches, users, accounts] = await Promise.all([
            prisma.branch.findMany({ select: { id: true, name: true } }),
            prisma.user.findMany({ select: { id: true, name: true } }),
            // Skip the round trip entirely when there is nothing to ask for — a
            // page of pure GL/journal rows with no parties and no delta.
            accountOr.length === 0 ? Promise.resolve([]) : prisma.account.findMany({
                where: { OR: accountOr },
                select: { id: true, name: true, personId: true, companyId: true },
                take: MAX_CHANGED_ACCOUNTS + pageAccountIds.length,
            }),
        ]);

        return NextResponse.json({
            mode: since ? "delta" : "page",
            rows,
            deleted,
            nextCursor,
            /** Delta was too big to be worth it — drop the copy and re-page. */
            overflow,
            refs: { branches, users, accounts },
            computedAt: computedAt.toISOString(),
        });
    } catch (e) {
        return handleApiError(e, "Failed to load day book");
    }
}
