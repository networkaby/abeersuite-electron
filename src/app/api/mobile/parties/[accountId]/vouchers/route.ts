import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAnyPermission } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import { voucherTypeLabel } from "@/shared/lib/format/voucherTypeLabel";
import { round2 } from "@/shared/lib/format/moneyInr";
import { PARTY_DETAIL_PERMISSIONS } from "@/modules/mobile/lib/mobileAccess";
import { partyBalances } from "@/modules/mobile/lib/partyBalances";
import { booksUnchangedSince } from "@/modules/mobile/lib/booksUnchanged";

const PAGE_SIZE = 30;

// GET /api/mobile/parties/[accountId]/vouchers[?cursor=<id>&balance=<n>][&since=<computedAt>]
//
// One party's vouchers, newest first, with the running balance — the phone's
// "was the last voucher posted?" list. EVERY status is listed (a draft is
// exactly what that question is looking for), but only POSTED vouchers move the
// balance, the same rule as the ledger (`ledgerStatusFilterUv`).
//
// A voucher is this party's when its spine names the party, when it has a leg on
// the party's ledger (a journal), or when it is a bill made out to the person /
// company without touching their ledger (a cash bill) — the office customer
// Transactions tab's own rule.
//
// Running balance: page one starts from the party's balance now (`partyBalances`,
// + they owe us) and walks back, taking each posted voucher's own legs off. The
// next page is asked for with `cursor` + `balance` from `more`, so it continues
// where this one ended without re-summing.
//
// `?since=` on page one: `{ unchanged: true }` when nothing in the books moved.
export async function GET(req: NextRequest, { params }: { params: Promise<{ accountId: string }> }) {
    const { response } = await requireAnyPermission(...PARTY_DETAIL_PERMISSIONS);
    if (response) return response;

    const accountId = Number((await params).accountId);
    if (!Number.isInteger(accountId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const search = req.nextUrl.searchParams;
    const cursor = Number(search.get("cursor")) || null;
    const carried = Number(search.get("balance"));

    try {
        const now = new Date();
        if (!cursor && (await booksUnchangedSince(search.get("since"), now))) {
            return NextResponse.json({ unchanged: true, computedAt: now.toISOString() });
        }

        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: { personId: true, companyId: true },
        });
        if (!account) return NextResponse.json({ error: "Party not found" }, { status: 404 });

        const billParty: Prisma.VoucherDetailWhereInput | null = account.personId != null
            ? { partyType: "customer", partyId: account.personId }
            : account.companyId != null
                ? { partyType: "company", partyId: account.companyId }
                : null;

        const rows = await prisma.universalVoucher.findMany({
            where: {
                OR: [
                    { partyAccountId: accountId },
                    { lines: { some: { accountId } } },
                    ...(billParty ? [{ voucherDetail: { is: billParty } }] : []),
                ],
            },
            // The Day Book's order: day, then the real time it was saved, then id
            // — a total order, so the cursor walk is gap-free.
            orderBy: [{ date: "desc" }, { sourceCreatedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
            take: PAGE_SIZE + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            select: {
                id: true, type: true, voucherNo: true, date: true, status: true,
                sourceCreatedAt: true, createdAt: true, createdById: true,
                lines: { select: { accountId: true, type: true, amount: true } },
                voucherDetail: { select: { totalAmount: true } },
            },
        });
        const page = rows.slice(0, PAGE_SIZE);

        const [startBalance, users] = await Promise.all([
            cursor && Number.isFinite(carried)
                ? Promise.resolve(carried)
                : partyBalances([accountId]).then((m) => m.get(accountId) ?? 0),
            prisma.user.findMany({
                where: { id: { in: [...new Set(page.map((v) => v.createdById).filter((id): id is number => id != null))] } },
                select: { id: true, name: true },
            }),
        ]);
        const userName = new Map(users.map((u) => [u.id, u.name]));

        let running = startBalance;
        const items = page.map((v) => {
            // This voucher's effect on the party: its own legs, + = they owe us more.
            const movement = round2(v.lines
                .filter((l) => l.accountId === accountId)
                .reduce((s, l) => s + (l.type === "DEBIT" ? 1 : -1) * Number(l.amount), 0));
            const posted = v.status === "POSTED";
            const balanceAfter = posted ? round2(running) : null;
            if (posted) running -= movement;
            return {
                id: v.id,
                kind: voucherTypeLabel(v.type) ?? v.type,
                ref: v.voucherNo || formatUvNo(v.id),
                date: v.date,
                savedAt: v.sourceCreatedAt ?? v.createdAt,
                by: v.createdById != null ? userName.get(v.createdById) ?? null : null,
                status: v.status,
                amount: v.voucherDetail
                    ? Number(v.voucherDetail.totalAmount)
                    : round2(v.lines.filter((l) => l.type === "DEBIT").reduce((s, l) => s + Number(l.amount), 0)),
                movement,
                balanceAfter,
            };
        });

        const hasMore = rows.length > PAGE_SIZE;
        return NextResponse.json({
            computedAt: now.toISOString(),
            items,
            hasMore,
            more: hasMore ? { cursor: String(page[page.length - 1].id), balance: String(round2(running)) } : null,
        });
    } catch (e) {
        return handleApiError(e, "Could not load this party's vouchers");
    }
}
