import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { businessToday } from "@/shared/lib/format/formatDate";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { aggregateClosingAsOf, isUnchangedSince, loadNormalBalanceMap } from "@/modules/accountancy/lib/aggregateLedger";
import { buildGroupTree, type GroupNode } from "@/modules/accountancy/lib/groupTree";
import { parseBank } from "@/modules/accountancy/lib/bankParticulars";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";

// GET /api/accountancy/reports/cash-position
// Returns current-day totals for Cash-in-Hand, Bank Accounts (including Bank OD with OD Limit - balance), Receivables, Payables.
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

type LedgerNodeWithId = { id: number; name: string; closing: number };

function flattenLedgerNodes(node: GroupNode): LedgerNodeWithId[] {
    const out: LedgerNodeWithId[] = node.ledgers.map((l) => ({ id: l.id, name: l.name, closing: l.closing }));
    for (const c of node.children) out.push(...flattenLedgerNodes(c));
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

        // Summed from the GL lines, not the Account.balance cache — on a
        // counter this is a local replica read, and it cannot drift.
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

        const cashGroup      = findGroup(tree, ACCOUNT_GROUPS.CASH_IN_HAND);
        const bankGroup      = findGroup(tree, ACCOUNT_GROUPS.BANK_ACCOUNTS);
        const bankOdGroup    = findGroup(tree, ACCOUNT_GROUPS.BANK_OD);
        const debtorsGroup   = findGroup(tree, ACCOUNT_GROUPS.SUNDRY_DEBTORS);
        const creditorsGroup = findGroup(tree, ACCOUNT_GROUPS.SUNDRY_CREDITORS);

        const regularBankAccounts = bankGroup ? flattenLedgers(bankGroup) : [];

        // For Bank OD accounts: header card considers (OD Limit - balance)
        let odBankAccounts: { name: string; balance: number }[] = [];
        if (bankOdGroup) {
            const odNodes = flattenLedgerNodes(bankOdGroup);
            if (odNodes.length > 0) {
                const odAccounts = await prisma.account.findMany({
                    where: { id: { in: odNodes.map((n) => n.id) } },
                    select: { id: true, bankJson: true },
                });
                const bankJsonMap = new Map(odAccounts.map((a) => [a.id, a.bankJson]));
                odBankAccounts = odNodes.map((n) => {
                    const rawLimit = parseBank(bankJsonMap.get(n.id)).limit;
                    const limitNum = Number(rawLimit);
                    const limit = rawLimit !== "" && Number.isFinite(limitNum) ? limitNum : 0;
                    return {
                        name: n.name,
                        balance: Number((limit - n.closing).toFixed(2)),
                    };
                });
            }
        }

        const allBankAccounts = [...regularBankAccounts, ...odBankAccounts];
        const totalBank = Number(allBankAccounts.reduce((sum, a) => sum + a.balance, 0).toFixed(2));

        return NextResponse.json({
            asOf: asOf.toISOString(),
            computedAt: now.toISOString(),
            cash:        sumGroup(cashGroup),
            bank:        totalBank,
            receivables: sumGroup(debtorsGroup),
            payables:    sumGroup(creditorsGroup),
            cashAccounts: cashGroup ? flattenLedgers(cashGroup) : [],
            bankAccounts: allBankAccounts,
        });
    } catch (err) {
        return handleApiError(err);
    }
}
