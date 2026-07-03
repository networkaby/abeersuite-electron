import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { aggregateClosingAsOf, loadNormalBalanceMap } from "@/modules/accountancy/lib/aggregateLedger";
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

export async function GET() {
    const { response } = await requireModuleAccess("accountancy", PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    try {
        const asOf = new Date();
        asOf.setHours(23, 59, 59, 999);

        const nbMap = await loadNormalBalanceMap();
        const closingMap = await aggregateClosingAsOf(asOf, nbMap);

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
