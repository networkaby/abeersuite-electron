// Builds a hydrated AccountGroup tree with attached ledger accounts and rolled-up balances.
// Used by Trial Balance, Balance Sheet and P&L APIs.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { AccountAggregate } from "./aggregateLedger";
import { groupSign, type GroupTypeStr } from "./groupNature";
import { parseBank } from "./bankParticulars";

export type LedgerNode = {
    id: number;
    name: string;
    normalBalance: "DEBIT" | "CREDIT" | null;
    personId: number | null;
    companyId:  number | null;
    opening: number;
    debits:  number;
    credits: number;
    closing: number;
    limit?: number | null;
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
                id: true, name: true,
                normalBalance: true, groupId: true,
                personId: true, companyId: true,
                bankJson: true,
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

        // `aggregates` signs every balance against the ACCOUNT's own nature. A
        // contra ledger carries the OPPOSITE nature to the group it sits in —
        // Sales Returns (DEBIT) inside Sales Accounts (CREDIT), Purchase
        // Returns inside Purchase Accounts, Drawings inside Capital Account,
        // Cash Over inside Suspense A/c. Rolling those up raw adds a number
        // that means "credit" to a running total that means "debit", so a
        // return ADDED to sales and a ₹17 till overage put ₹34 on the asset
        // side — the Balance Sheet's mystery "Difference in opening balances".
        //
        // Re-sign against the GROUP's nature once, here, and every roll-up
        // below is a plain sum of numbers that mean the same thing. The row
        // still PRINTS the same: a contra comes through negative and SidedCell
        // flips it back to the opposite label on its own.
        //
        // `debits` / `credits` are raw movement, never signed — they are what
        // `toPeriodOnlyTree` rebuilds the P&L from, which is why the P&L was
        // already correct and is untouched by this.
        const sign = groupSign(parent.type, a.normalBalance);
        const rawLimit = a.bankJson ? parseBank(a.bankJson).limit : "";
        const limitNum = Number(rawLimit);
        const limit = rawLimit !== "" && Number.isFinite(limitNum) ? limitNum : null;

        parent.ledgers.push({
            id: a.id,
            name: a.name,
            normalBalance: a.normalBalance,
            personId: a.personId,
            companyId:  a.companyId,
            opening: sign * (agg?.opening ?? 0),
            debits:  agg?.debits  ?? 0,
            credits: agg?.credits ?? 0,
            closing: sign * (agg?.closing ?? 0),
            limit,
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

// ── Synthetic "Closing Stock" ledger ────────────────────────────────────
// Stock is never posted per voucher to a GL account (Tally convention — see
// postInvVoucher.ts); it is valued live at report time. So the Stock-in-Hand
// group is real but empty, and any report that renders the asset side has to
// put the valuation in itself or it is short by the whole value of the godown.
//
// That is exactly what went wrong: the Balance Sheet injected it and the Trial
// Balance did not, so the TB buried the entire stock value in its
// "Difference in opening balances" plug. Both reports now share these helpers.

/** The group every stock valuation is surfaced under. */
export const STOCK_GROUP = "Stock-in-Hand";

/** Ledger id of the synthetic stock row — no Account row exists behind it. */
export const SYNTHETIC_STOCK_ID = -1;

/** Depth-first search for a group by name. */
function findGroup(nodes: GroupNode[], name: string): GroupNode | null {
    for (const n of nodes) {
        if (n.name === name) return n;
        const hit = findGroup(n.children, name);
        if (hit) return hit;
    }
    return null;
}

/**
 * Sum the REAL GL balances already sitting directly in a named group.
 *
 * Callers net their computed valuation against this so that the day someone
 * does post a stock journal to a real ledger, the synthetic row shrinks by the
 * same amount instead of double-counting it.
 */
export function sumGroupLedgers(
    roots: GroupNode[],
    groupName: string,
): { opening: number; debits: number; credits: number; closing: number } {
    const g = findGroup(roots, groupName);
    const out = { opening: 0, debits: 0, credits: 0, closing: 0 };
    if (!g) return out;
    for (const l of g.ledgers) {
        out.opening += l.opening; out.debits  += l.debits;
        out.credits += l.credits; out.closing += l.closing;
    }
    return out;
}

/**
 * Push a synthetic ledger into a named group and bubble its amounts up every
 * ancestor's rolled-up totals, so the existing tree renderer shows it under the
 * group the reader expects with no special-casing.
 *
 * Returns false when the group is absent (e.g. a tree filtered to LIABILITY
 * only), so the caller can tell "injected" from "nowhere to put it".
 */
export function injectLedger(
    roots: GroupNode[],
    groupName: string,
    ledger: LedgerNode,
): boolean {
    const walk = (nodes: GroupNode[]): boolean => {
        for (const n of nodes) {
            const hit = n.name === groupName ? (n.ledgers.push(ledger), true) : walk(n.children);
            if (!hit) continue;
            n.rolledUpOpening += ledger.opening;
            n.rolledUpDebits  += ledger.debits;
            n.rolledUpCredits += ledger.credits;
            n.rolledUpClosing += ledger.closing;
            return true;
        }
        return false;
    };
    return walk(roots);
}
