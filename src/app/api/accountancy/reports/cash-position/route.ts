import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { businessToday } from "@/shared/lib/format/formatDate";
import { closingFromCache, isUnchangedSince, loadNormalBalanceMap } from "@/modules/accountancy/lib/aggregateLedger";
import { buildGroupTree, type GroupNode } from "@/modules/accountancy/lib/groupTree";

// GET /api/accountancy/reports/cash-position
// Returns current-day totals for Cash-in-Hand, Bank Accounts, Receivables, Payables.
// Used by the FinanceTopBar component. Lightweight: closing-only (no range aggregation).

function findGroup(nodes: GroupNode[], name: string): GroupNode | undefined {
    for (const n of nodes) {
        if (n.name === name) return n;
        const found = findGroup(n.children, name);
        if (found) return found;
    }
    return undefined;
}

function flattenLedgers(node: GroupNode): { name: string; balance: number }[] {
    const out = node.ledgers.map((l) => ({ name: l.name, balance: l.closing }));
    for (const c of node.children) out.push(...flattenLedgers(c));
    return out;
}

function sumGroup(node: GroupNode | undefined): number {
    if (!node) return 0;
    return node.rolledUpClosing;
}

// The client sends back the server time it received on its last successful
// fetch (`?since=`) so this route can stay stateless — no server-side memory
// or storage, just "has anything changed since the timestamp you're holding".
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    try {
        const now = new Date();
        const sinceParam = new URL(req.url).searchParams.get("since");
        if (await isUnchangedSince(sinceParam, now)) {
            return NextResponse.json({ unchanged: true, computedAt: now.toISOString() });
        }

        const asOf = businessToday();
        asOf.setHours(23, 59, 59, 999);

        // Cache-path read: the running Account.balance, not a whole-ledger
        // re-sum. See closingFromCache() for why that is sound and what it
        // corrects for.
        const nbMap = await loadNormalBalanceMap();
        const closingMap = await closingFromCache(asOf, nbMap);

        // Wrap into AccountAggregate shape for buildGroupTree
        const aggMap = new Map(
            Array.from(closingMap.entries()).map(([id, c]) => [
                id,
                { accountId: id, opening: 0, debits: 0, credits: 0, closing: c },
            ]),
        );

        const tree = await buildGroupTree(aggMap);

        const cashGroup    = findGroup(tree, "Cash-in-Hand");
        const bankGroup    = findGroup(tree, "Bank Accounts");
        const debtorsGroup = findGroup(tree, "Sundry Debtors");
        const creditorsGroup = findGroup(tree, "Sundry Creditors");

        return NextResponse.json({
            asOf: asOf.toISOString(),
            computedAt: now.toISOString(),
            cash:        sumGroup(cashGroup),
            bank:        sumGroup(bankGroup),
            receivables: sumGroup(debtorsGroup),
            payables:    sumGroup(creditorsGroup),
            cashAccounts: cashGroup    ? flattenLedgers(cashGroup)    : [],
            bankAccounts: bankGroup    ? flattenLedgers(bankGroup)    : [],
        });
    } catch (err) {
        return handleApiError(err);
    }
}
