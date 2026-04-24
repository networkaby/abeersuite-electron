import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { balanceDelta, toNumber } from "@/lib/finance/balance";

// GET /api/finance/reports/ledger/[accountId]?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(req: Request, { params }: { params: Promise<{ accountId: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const { accountId } = await params;
    const { searchParams } = new URL(req.url);
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    const from = fromParam ? new Date(fromParam) : new Date(new Date().getFullYear(), 0, 1);
    const to = toParam ? new Date(toParam) : new Date();
    to.setHours(23, 59, 59, 999);

    const account = await prisma.glAccount.findUnique({ where: { id: Number(accountId) } });
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    try {
        // Opening balance: all posted lines before the 'from' date
        const openingLines = await prisma.journalLine.findMany({
            where: {
                glAccountId: Number(accountId),
                journalEntry: { status: "POSTED", date: { lt: from } },
            },
            select: { type: true, amount: true },
        });
        const openingBalance = openingLines.reduce((bal, l) => {
            return bal + balanceDelta(account.normalBalance, l.type, toNumber(l.amount));
        }, 0);

        // Lines within the date range
        const lines = await prisma.journalLine.findMany({
            where: {
                glAccountId: Number(accountId),
                journalEntry: { status: "POSTED", date: { gte: from, lte: to } },
            },
            orderBy: [{ journalEntry: { date: "asc" } }, { id: "asc" }],
            include: {
                journalEntry: {
                    select: { id: true, date: true, reference: true, description: true },
                },
            },
        });

        // Compute running balance
        let runningBalance = openingBalance;
        const rows = lines.map((l) => {
            const delta = balanceDelta(account.normalBalance, l.type, toNumber(l.amount));
            runningBalance += delta;
            return {
                id: l.id,
                date: l.journalEntry.date,
                reference: l.journalEntry.reference,
                description: l.journalEntry.description,
                lineDescription: l.description,
                debit: l.type === "DEBIT" ? toNumber(l.amount) : null,
                credit: l.type === "CREDIT" ? toNumber(l.amount) : null,
                balance: runningBalance,
            };
        });

        return NextResponse.json({
            account: { id: account.id, code: account.code, name: account.name, normalBalance: account.normalBalance },
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
