import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { parseRange } from "@/modules/accountancy/lib/period";
import { aggregateRange, loadNormalBalanceMap } from "@/modules/accountancy/lib/aggregateLedger";
import { handleApiError } from "@/shared/lib/api";

// GET /api/finance/reports/cash-flow?from=YYYY-MM-DD&to=YYYY-MM-DD
// Aggregates cash inflows / outflows by the counter-side ledger of every
// journal entry that touches a Cash-in-Hand or Bank Accounts ledger.
export async function GET(req: Request) {
    const { response } = await requirePermission("accountancy:view:org");
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const { from, to } = parseRange(searchParams);

    try {
        const groups = await prisma.accountGroup.findMany({
            where: { isActive: true, name: { in: ["Cash-in-Hand", "Bank Accounts"] } },
            select: { id: true },
        });
        const groupIds = groups.map((g) => g.id);

        const cashAccounts = await prisma.account.findMany({
            where: { isActive: true, groupId: { in: groupIds } },
            select: { id: true, name: true },
        });
        const cashIdSet = new Set(cashAccounts.map((a) => a.id));

        if (cashIdSet.size === 0) {
            return NextResponse.json({
                from: from.toISOString(), to: to.toISOString(),
                inflows: [], outflows: [],
                totalIn: 0, totalOut: 0, netChange: 0,
                openingCash: 0, closingCash: 0,
            });
        }

        // Pull every JE in the period that has at least one cash line, with all
        // its lines so we can identify counterparties.
        const entries = await prisma.journalEntry.findMany({
            where: {
                date:      { gte: from, lte: to },
                deletedAt: null,
                lines:     { some: { accountId: { in: Array.from(cashIdSet) } } },
            },
            select: {
                lines: { select: { accountId: true, amount: true, type: true } },
            },
        });

        const otherIds = new Set<number>();
        for (const je of entries) {
            for (const l of je.lines) if (!cashIdSet.has(l.accountId)) otherIds.add(l.accountId);
        }
        const otherLedgers = otherIds.size === 0 ? [] : await prisma.account.findMany({
            where:  { id: { in: Array.from(otherIds) } },
            select: { id: true, name: true },
        });
        const nameById = new Map(otherLedgers.map((l) => [l.id, l.name]));

        // Aggregate inflow/outflow by counterparty ledger.
        // Cash debit  = inflow  (cash increased)
        // Cash credit = outflow (cash decreased)
        // Counter-side = sibling lines of the opposite type, excluding other cash lines.
        const inflowMap:  Record<number, number> = {};
        const outflowMap: Record<number, number> = {};

        for (const je of entries) {
            const cashLines = je.lines.filter((l) => cashIdSet.has(l.accountId));
            for (const cl of cashLines) {
                const cashAmount = Number(cl.amount);
                const opposingSide: "DEBIT" | "CREDIT" = cl.type === "DEBIT" ? "CREDIT" : "DEBIT";
                const target = cl.type === "DEBIT" ? inflowMap : outflowMap;

                const counters = je.lines.filter(
                    (l) => !cashIdSet.has(l.accountId) && l.type === opposingSide,
                );
                const counterTotal = counters.reduce((s, l) => s + Number(l.amount), 0);
                if (counterTotal <= 0.005) continue;

                for (const sib of counters) {
                    const share = (Number(sib.amount) / counterTotal) * cashAmount;
                    target[sib.accountId] = (target[sib.accountId] ?? 0) + share;
                }
            }
        }

        const inflows = Object.entries(inflowMap)
            .map(([id, amount]) => ({ id: Number(id), name: nameById.get(Number(id)) ?? "(unknown)", amount }))
            .sort((a, b) => b.amount - a.amount);
        const outflows = Object.entries(outflowMap)
            .map(([id, amount]) => ({ id: Number(id), name: nameById.get(Number(id)) ?? "(unknown)", amount }))
            .sort((a, b) => b.amount - a.amount);
        const totalIn  = inflows.reduce((s, r) => s + r.amount, 0);
        const totalOut = outflows.reduce((s, r) => s + r.amount, 0);

        // Closing cash = sum of all-time movements on cash accounts up to "to".
        const nbMap = await loadNormalBalanceMap();
        const aggClosing = await aggregateRange(new Date("1970-01-01"), to, nbMap);
        let closingCash = 0;
        for (const id of cashIdSet) {
            const agg = aggClosing.get(id);
            if (agg) closingCash += agg.closing;
        }
        const openingCash = closingCash - (totalIn - totalOut);

        return NextResponse.json({
            from: from.toISOString(),
            to:   to.toISOString(),
            inflows, outflows,
            totalIn, totalOut,
            netChange: totalIn - totalOut,
            openingCash, closingCash,
        });
    } catch (e) {
        return handleApiError(e, "Failed to compute cash flow");
    }
}
