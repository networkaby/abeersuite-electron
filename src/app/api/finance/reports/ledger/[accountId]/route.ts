import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/authGuard";
import { balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { resolveSourceBatch } from "@/modules/accountancy/lib/refResolver";
import { defaultNormalBalanceForGroupType } from "@/modules/accountancy/lib/groupNature";

// GET /api/finance/reports/ledger/[accountId]?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(req: Request, { params }: { params: Promise<{ accountId: string }> }) {
    const { response } = await requirePermission("accountancy:view:org");
    if (response) return response;

    const { accountId } = await params;
    const { searchParams } = new URL(req.url);
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    const from = fromParam ? new Date(fromParam) : new Date(new Date().getFullYear(), 0, 1);
    const to = toParam ? new Date(toParam) : new Date();
    to.setHours(23, 59, 59, 999);

    const account = await prisma.account.findUnique({
        where: { id: Number(accountId) },
        include: { group: { select: { id: true, name: true, type: true } } },
    });
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    const nb = account.normalBalance
        ?? (account.group?.type ? defaultNormalBalanceForGroupType(account.group.type) : "DEBIT");

    try {
        // Opening balance: all posted lines before the 'from' date, plus the
        // master-page openingBalance if its as-of date is on/before `from`.
        const openingLines = await prisma.journalLine.findMany({
            where: {
                accountId: Number(accountId),
                journalEntry: { status: "POSTED", deletedAt: null, date: { lt: from } },
            },
            select: { type: true, amount: true },
        });
        let openingBalance = openingLines.reduce((bal, l) => {
            return bal + balanceDelta(nb, l.type, toNumber(l.amount));
        }, 0);
        if (account.openingBalance && account.openingBalanceType
            && (!account.openingBalanceDate || account.openingBalanceDate < from)) {
            openingBalance += balanceDelta(nb, account.openingBalanceType, toNumber(account.openingBalance));
        }

        // Lines within the date range
        const lines = await prisma.journalLine.findMany({
            where: {
                accountId: Number(accountId),
                journalEntry: { status: "POSTED", deletedAt: null, date: { gte: from, lte: to } },
            },
            orderBy: [{ journalEntry: { date: "asc" } }, { id: "asc" }],
            include: {
                journalEntry: {
                    select: { id: true, date: true, reference: true, description: true },
                },
            },
        });

        // Resolve source documents in bulk
        const jeIds = [...new Set(lines.map((l) => l.journalEntry.id))];
        const sourceMap = await resolveSourceBatch(jeIds);

        // Compute running balance and attach source URL
        let runningBalance = openingBalance;
        const rows = lines.map((l) => {
            const delta = balanceDelta(nb, l.type, toNumber(l.amount));
            runningBalance += delta;
            const source = sourceMap.get(l.journalEntry.id) ?? null;
            return {
                id: l.id,
                journalEntryId: l.journalEntry.id,
                date: l.journalEntry.date,
                reference: l.journalEntry.reference,
                description: l.journalEntry.description,
                lineDescription: l.description,
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
            from: from.toISOString(),
            to: to.toISOString(),
            openingBalance,
            closingBalance: runningBalance,
            rows,
        });
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to generate ledger" }, { status: 500 });
    }
}
