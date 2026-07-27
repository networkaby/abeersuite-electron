import type { GroupNode } from "./groupTree";

/**
 * Rewrite a group tree's balances to the PERIOD's activity only.
 *
 * `buildGroupTree` hands back `closing = opening + period` — right for the
 * Balance Sheet, which is an as-at report, and right for the Trial Balance,
 * which shows opening and closing as separate columns. A P&L is a PERIOD
 * report, so every displayed row must drop the opening. Without this, a window
 * with no vouchers still printed last year's Sales, and the rows never added up
 * to the totals (which are computed period-only).
 *
 * Signed by the ROOT GROUP's type, not by each account's `normalBalance`:
 * "Sales Returns" is DEBIT-normal but sits inside the CREDIT-natured "Sales
 * Accounts" group, so signing per account would make a return ADD to Sales
 * instead of reducing it.
 */
export function toPeriodOnlyTree(node: GroupNode, type: string): GroupNode {
    const net = (d: number, c: number) => (type === "INCOME" ? c - d : d - c);
    return {
        ...node,
        rolledUpOpening: 0,
        rolledUpClosing: net(node.rolledUpDebits, node.rolledUpCredits),
        children: node.children.map((c) => toPeriodOnlyTree(c, type)),
        ledgers:  node.ledgers.map((l) => ({
            ...l,
            opening: 0,
            closing: net(l.debits, l.credits),
        })),
    };
}
