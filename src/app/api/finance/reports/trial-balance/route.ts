import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";

// GET /api/finance/reports/trial-balance?asOf=YYYY-MM-DD
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const asOfParam = searchParams.get("asOf");
    const asOf = asOfParam ? new Date(asOfParam) : new Date();
    // Set time to end of day
    asOf.setHours(23, 59, 59, 999);

    try {
        const accounts = await prisma.account.findMany({
            where: {
                isActive: true,
                type: { not: null },        // only accounts with a GL type
                normalBalance: { not: null },
            },
            orderBy: { code: "asc" },
            include: {
                lines: {
                    where: {
                        journalEntry: {
                            status: "POSTED",
                            date: { lte: asOf },
                        },
                    },
                    select: { type: true, amount: true },
                },
            },
        });

        const rows = accounts.map((acct) => {
            const debits = acct.lines
                .filter((l) => l.type === "DEBIT")
                .reduce((s, l) => s + Number(l.amount), 0);
            const credits = acct.lines
                .filter((l) => l.type === "CREDIT")
                .reduce((s, l) => s + Number(l.amount), 0);

            const balance =
                acct.normalBalance === "DEBIT" ? debits - credits : credits - debits;

            return {
                id: acct.id,
                code: acct.code,
                name: acct.name,
                type: acct.type,
                normalBalance: acct.normalBalance,
                totalDebits: debits,
                totalCredits: credits,
                balance,
            };
        });

        const totalDebits = rows.reduce((s, r) => s + r.totalDebits, 0);
        const totalCredits = rows.reduce((s, r) => s + r.totalCredits, 0);

        return NextResponse.json({ asOf: asOf.toISOString(), rows, totalDebits, totalCredits });
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to generate trial balance" }, { status: 500 });
    }
}
