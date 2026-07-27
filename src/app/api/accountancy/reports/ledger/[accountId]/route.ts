import { prisma } from "@/shared/lib/prisma/prismaClient";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { resolveSourceBatch } from "@/modules/accountancy/lib/journalEntrySource";
import { ledgerStatusFilterUv } from "@/modules/accountancy/lib/aggregateLedger";
import { defaultNormalBalanceForGroupType } from "@/modules/accountancy/lib/groupNature";
import { handleApiError } from "@/shared/lib/api";
import {
    dateOnOrBefore, toDateOnly, startOfDayUtc, endOfDayUtc,
} from "@/shared/lib/format/formatDate";

// GET /api/accountancy/reports/ledger/[accountId]?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(req: Request, { params }: { params: Promise<{ accountId: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const { accountId } = await params;
    const { searchParams } = new URL(req.url);
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    // UTC-pinned bounds — `UniversalVoucher.date` is a DATE column, so a
    // local-midnight `from` truncates to the PREVIOUS day in IST and the
    // ledger silently opens with the day before its start date.
    const from = fromParam
        ? startOfDayUtc(fromParam)
        : new Date(Date.UTC(new Date().getFullYear(), 0, 1));
    const to = endOfDayUtc(toParam ?? new Date());

    const account = await prisma.account.findUnique({
        where: { id: Number(accountId) },
        include: { group: { select: { id: true, name: true, type: true } } },
    });
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    const nb = account.normalBalance
        ?? (account.group?.type ? defaultNormalBalanceForGroupType(account.group.type) : "DEBIT");

    try {
        // Opening balance: all posted lines before the 'from' date, plus the
        // master-page openingBalance if its as-of date is on/before `to`
        // (matches the aggregateRange policy used by Trial Balance / Balance Sheet
        // — every master opening dated within or before the report period folds
        // into the opening bucket so period debits/credits stay balanced and
        // the list/detail surfaces agree).
        const openingLines = await prisma.voucherGlLine.findMany({
            where: {
                accountId: Number(accountId),
                universalVoucher: { ...ledgerStatusFilterUv(), date: { lt: from } },
            },
            select: { type: true, amount: true },
        });
        let openingBalance = openingLines.reduce((bal, l) => {
            return bal + balanceDelta(nb, l.type, toNumber(l.amount));
        }, 0);
        if (account.openingBalance != null && account.openingBalanceType
            && (!account.openingBalanceDate || dateOnOrBefore(account.openingBalanceDate, to))) {
            openingBalance += balanceDelta(nb, account.openingBalanceType, toNumber(account.openingBalance));
        }

        // Lines within the date range (read from the universal-voucher spine).
        const lines = await prisma.voucherGlLine.findMany({
            where: {
                accountId: Number(accountId),
                universalVoucher: { ...ledgerStatusFilterUv(), date: { gte: from, lte: to } },
            },
            orderBy: [{ universalVoucher: { date: "asc" } }, { id: "asc" }],
            include: {
                universalVoucher: {
                    select: { id: true, date: true, voucherNo: true, description: true },   // 5D-7: UVNo = id
                },
            },
        });

        // Branch names by id — VoucherGlLine carries a scalar branchId (no relation).
        const branchIds = [...new Set(lines.map((l) => l.branchId).filter((x): x is string => x != null))];
        const branchRows = branchIds.length
            ? await prisma.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } })
            : [];
        const branchNameById = new Map(branchRows.map((b) => [b.id, b.name]));

        // Hide edit-reversal noise: when a voucher is edited, the original JE
        // stays POSTED and a counter-entry JE is posted ("EDIT (reverse): X").
        // Together they net to zero on the account, so we collapse the pair
        // away and only surface the new posting. Match by identical
        // description, earliest unmatched original wins (handles repeated
        // edits where each pair nets independently).
        const excludeIds = new Set<number>();
        const REV_PREFIX = "EDIT (reverse): ";
        for (const l of lines) {
            const desc = l.universalVoucher.description ?? "";
            if (!desc.startsWith(REV_PREFIX)) continue;
            if (excludeIds.has(l.universalVoucher.id)) continue;
            const origDesc = desc.slice(REV_PREFIX.length);
            const orig = lines.find((o) =>
                o.universalVoucher.id !== l.universalVoucher.id
                && !excludeIds.has(o.universalVoucher.id)
                && (o.universalVoucher.description ?? "") === origDesc,
            );
            if (orig) {
                excludeIds.add(orig.universalVoucher.id);
                excludeIds.add(l.universalVoucher.id);
            }
        }
        const visibleLines = lines.filter((l) => !excludeIds.has(l.universalVoucher.id));

        // Resolve source documents in bulk — keyed by the spine voucher id (G5).
        const uvIds = [...new Set(visibleLines.map((l) => l.universalVoucher.id))];
        const sourceMap = await resolveSourceBatch(uvIds);

        // Compute running balance and attach source URL
        let runningBalance = openingBalance;
        const rows = visibleLines.map((l) => {
            const delta = balanceDelta(nb, l.type, toNumber(l.amount));
            runningBalance += delta;
            const srcUvId = l.universalVoucher.id;
            const source = sourceMap.get(srcUvId) ?? null;
            return {
                id: l.id,
                journalEntryId: srcUvId,
                date: toDateOnly(l.universalVoucher.date),
                reference: l.universalVoucher.voucherNo ?? formatUvNo(l.universalVoucher.id),
                description: l.universalVoucher.description ?? "",
                lineDescription: l.description,
                branchId: l.branchId ?? null,
                branchName: l.branchId ? (branchNameById.get(l.branchId) ?? null) : null,
                debit: l.type === "DEBIT" ? toNumber(l.amount) : null,
                credit: l.type === "CREDIT" ? toNumber(l.amount) : null,
                balance: runningBalance,
                source,
            };
        });

        return NextResponse.json({
            account: {
                id: account.id, code: account.code, name: account.name,
                normalBalance: nb,
                groupId: account.groupId, groupName: account.group?.name ?? null,
            },
            from: toDateOnly(from),
            to: toDateOnly(to),
            openingBalance,
            closingBalance: runningBalance,
            rows,
        });
    } catch (e) {
        return handleApiError(e, "Failed to generate ledger");
    }
}
