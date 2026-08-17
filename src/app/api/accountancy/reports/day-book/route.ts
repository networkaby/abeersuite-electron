import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError, parseCursor } from "@/shared/lib/api";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import { readPartyName } from "@/shared/lib/accountancy/partySnapshot";
import { voucherSourceForType } from "@/modules/accountancy/lib/voucherUrls";
import { kindsForFilter, kindsForCategory } from "@/modules/accountancy/lib/voucherKinds";

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
/**
 * Past this a delta has stopped being cheaper than starting over, so we say so
 * and let the client drop its copy and re-page from the top.
 */
const MAX_DELTA_ROWS = 500;

const VALID_STATUSES = ["DRAFT", "POSTED", "CANCELLED"] as const;
type VoucherStatusFilter = (typeof VALID_STATUSES)[number];

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

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const { cursor, take } = parseCursor(searchParams);

    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const search = searchParams.get("search")?.trim() ?? "";
    const branchId = searchParams.get("branchId");
    const refsSince = searchParams.get("refsSince");
    const sinceRaw = searchParams.get("since");
    const since = sinceRaw ? new Date(sinceRaw) : null;
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
            ...(search ? {
                OR: [
                    { voucherNo:   { contains: search, mode: "insensitive" } },
                    { description: { contains: search, mode: "insensitive" } },
                    { narration:   { contains: search, mode: "insensitive" } },
                    ...(searchAccountIds.length > 0 ? [{ partyAccountId: { in: searchAccountIds } }] : []),
                ],
            } : {}),
        };

        const select = {
            id: true, type: true, voucherNo: true, date: true,
            description: true, narration: true, status: true,
            cancelledAt: true, createdAt: true,
            branchId: true, createdById: true, partyAccountId: true,
            lines: { select: { type: true, amount: true } },
            // The trade detail carries its own id — which is what every inventory
            // edit URL and line-expand fetch keys on, NOT the spine id. Getting
            // this wrong would break the link on every inventory row.
            voucherDetail: {
                select: { id: true, partyJson: true, totalAmount: true, refVoucherId: true },
            },
        } satisfies Prisma.UniversalVoucherSelect;

        const orderBy: Prisma.UniversalVoucherOrderByWithRelationInput[] = [{ date: "desc" }, { id: "desc" }];

        let found: Prisma.UniversalVoucherGetPayload<{ select: typeof select }>[];
        let nextCursor: number | null = null;
        let overflow = false;
        let deleted: string[] = [];

        if (since) {
            // Delta: everything touched since the client last looked. Rows older
            // than the client's own cursor may come back too — it drops those
            // itself, which is cheaper than teaching the server the client's exact
            // scroll position.
            const changed = await prisma.universalVoucher.findMany({
                where: { ...where, updatedAt: { gt: since } },
                orderBy,
                take: MAX_DELTA_ROWS + 1,
                select,
            });
            overflow = changed.length > MAX_DELTA_ROWS;
            found = overflow ? [] : changed;

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
        } else {
            // take + 1 so we learn whether another page exists without a second query.
            const rowsPlusOne = await prisma.universalVoucher.findMany({
                where,
                orderBy,
                take: take + 1,
                ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
                select,
            });
            const hasMore = rowsPlusOne.length > take;
            found = hasMore ? rowsPlusOne.slice(0, take) : rowsPlusOne;
            nextCursor = hasMore && found.length > 0 ? found[found.length - 1].id : null;
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

        const rows = found.map((v) => {
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
                converted:   detail ? convertedIds.has(detail.id) : false,
            };
        });

        // ── refs ────────────────────────────────────────────────────────────
        // Branch and User are small enough to ship whole every time, which makes a
        // rename in either self-correct on the next sync with no delta bookkeeping.
        // Accounts are not (every customer has one), so we send the ones this page
        // actually references — always fresh — plus any renamed since the client
        // last looked, which is what corrects rows deeper in its cache.
        const pageAccountIds = [...new Set(rows.map((r) => r.partyAccountId).filter((id): id is number => id != null))];
        const accountOr: Prisma.AccountWhereInput[] = [
            ...(pageAccountIds.length > 0 ? [{ id: { in: pageAccountIds } }] : []),
            ...(refsSince ? [{ updatedAt: { gt: new Date(refsSince) } }] : []),
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
