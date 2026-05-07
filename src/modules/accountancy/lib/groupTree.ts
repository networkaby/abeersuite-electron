// Builds a hydrated AccountGroup tree with attached ledger accounts and rolled-up balances.
// Used by Trial Balance, Balance Sheet and P&L APIs.

import { prisma } from "@/lib/prisma";
import type { AccountAggregate } from "./aggregateLedger";
import type { GroupTypeStr } from "./groupNature";

export type LedgerNode = {
    id: number;
    name: string;
    code: string | null;
    type: string | null;
    normalBalance: "DEBIT" | "CREDIT" | null;
    personId: number | null;
    companyId:  number | null;
    opening: number;
    debits:  number;
    credits: number;
    closing: number;
};

export type GroupNode = {
    id: number;
    name: string;
    type: GroupTypeStr;
    parentId: number | null;
    sortOrder: number;
    children: GroupNode[];
    ledgers:  LedgerNode[];
    rolledUpOpening: number;
    rolledUpDebits:  number;
    rolledUpCredits: number;
    rolledUpClosing: number;
};

export type BuildOpts = {
    types?: GroupTypeStr[];   // restrict to these (e.g. only ASSET/LIABILITY for BS)
};

export async function buildGroupTree(
    aggregates: Map<number, AccountAggregate>,
    opts: BuildOpts = {},
): Promise<GroupNode[]> {
    const where = {
        isActive: true,
        ...(opts.types ? { type: { in: opts.types } } : {}),
    };

    const [groups, accounts] = await Promise.all([
        prisma.accountGroup.findMany({
            where,
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        }),
        prisma.account.findMany({
            where: { isActive: true, groupId: { not: null } },
            select: {
                id: true, name: true, code: true, type: true,
                normalBalance: true, groupId: true,
                personId: true, companyId: true,
            },
            orderBy: [{ name: "asc" }],
        }),
    ]);

    const nodeMap = new Map<number, GroupNode>();
    for (const g of groups) {
        nodeMap.set(g.id, {
            id: g.id,
            name: g.name,
            type: g.type,
            parentId: g.parentId,
            sortOrder: g.sortOrder,
            children: [],
            ledgers:  [],
            rolledUpOpening: 0,
            rolledUpDebits:  0,
            rolledUpCredits: 0,
            rolledUpClosing: 0,
        });
    }

    // Attach ledgers to their groups
    for (const a of accounts) {
        if (a.groupId === null) continue;
        const parent = nodeMap.get(a.groupId);
        if (!parent) continue; // group filtered out
        const agg = aggregates.get(a.id);
        parent.ledgers.push({
            id: a.id,
            name: a.name,
            code: a.code,
            type: a.type,
            normalBalance: a.normalBalance,
            personId: a.personId,
            companyId:  a.companyId,
            opening: agg?.opening ?? 0,
            debits:  agg?.debits  ?? 0,
            credits: agg?.credits ?? 0,
            closing: agg?.closing ?? 0,
        });
    }

    // Build tree (orphans whose parent was filtered out become roots)
    const roots: GroupNode[] = [];
    for (const node of nodeMap.values()) {
        if (node.parentId === null || !nodeMap.has(node.parentId)) {
            roots.push(node);
        } else {
            nodeMap.get(node.parentId)!.children.push(node);
        }
    }

    // Roll up balances bottom-up
    function rollup(n: GroupNode): void {
        n.children.forEach(rollup);
        let o = 0, d = 0, c = 0, cl = 0;
        for (const l of n.ledgers) { o += l.opening; d += l.debits; c += l.credits; cl += l.closing; }
        for (const ch of n.children) {
            o += ch.rolledUpOpening; d += ch.rolledUpDebits;
            c += ch.rolledUpCredits; cl += ch.rolledUpClosing;
        }
        n.rolledUpOpening = o; n.rolledUpDebits = d;
        n.rolledUpCredits = c; n.rolledUpClosing = cl;
    }
    roots.forEach(rollup);

    // Sort children by sortOrder, then name
    function sortKids(n: GroupNode): void {
        n.children.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
        n.ledgers.sort((a, b) => a.name.localeCompare(b.name));
        n.children.forEach(sortKids);
    }
    roots.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    roots.forEach(sortKids);

    return roots;
}

/** Filter a tree, keeping only branches that contain a non-zero leaf, plus all groups. */
export function pruneEmpty(nodes: GroupNode[]): GroupNode[] {
    const result: GroupNode[] = [];
    for (const n of nodes) {
        const childKept = pruneEmpty(n.children);
        const ledgersKept = n.ledgers.filter((l) =>
            l.opening !== 0 || l.debits !== 0 || l.credits !== 0 || l.closing !== 0,
        );
        if (childKept.length === 0 && ledgersKept.length === 0 && n.rolledUpClosing === 0
            && n.rolledUpDebits === 0 && n.rolledUpCredits === 0) {
            continue;
        }
        result.push({ ...n, children: childKept, ledgers: ledgersKept });
    }
    return result;
}
