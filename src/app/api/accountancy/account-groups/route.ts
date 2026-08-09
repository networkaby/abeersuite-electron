import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { aggregateClosingAsOf, loadNormalBalanceMap } from "@/modules/accountancy/lib/aggregateLedger";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { toNumber } from "@/modules/accountancy/lib/balance";

const createSchema = z.object({
    name: z.string().trim().min(1).max(200),
    type: z.enum(["ASSET", "LIABILITY", "INCOME", "EXPENSE"]).optional(), // ignored for sub-groups
    parentId: z.number().int().positive().nullish(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
});

// A ledger account attached directly to a group, with its truth-path closing
// balance. Inactive accounts are included (UI badges them) so the masters tree
// is a complete picture of the chart of accounts.
type LedgerRow = {
    id: number;
    name: string;
    code: string | null;
    normalBalance: "DEBIT" | "CREDIT" | null;
    /** Alternate names — carried through so the Edit dialog opens pre-filled. */
    aliases: string[];
    isActive: boolean;
    personId: number | null;
    companyId: number | null;
    groupId: number | null;
    balance: number;
    /** Bank-ledger particulars (Bank-group ledgers only) — edited on the
     *  masters Ledgers page, printed on the Contra deposit slip. */
    bankJson: unknown;
    /** Loan-ledger particulars (Loans (Liability) / Secured / Unsecured Loans). */
    loanJson: unknown;
    /** Credit-card-ledger particulars (Credit Card group). */
    creditCardJson: unknown;
    /** BNPL-ledger particulars (BNPL A/c group). */
    bnplJson: unknown;
    /** Wallet-ledger particulars (Wallets group). */
    walletJson: unknown;
    /** Payment-gateway-ledger particulars (Payment Gateway group). */
    gatewayJson: unknown;
    openingBalance: number | null;
    openingBalanceType: "DEBIT" | "CREDIT" | null;
    openingBalanceDate: string | null;
};

type FlatGroup = {
    id: number;
    name: string;
    type: "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE";
    parentId: number | null;
    sortOrder: number;
    isActive: boolean;
    totalBalance: number;
    _count: { children: number; accounts: number };
};

// `ledgers` is capped to this many per group for the inline tree. Identity-heavy
// groups (Sundry Debtors/Creditors) can hold thousands of customer/company
// ledgers — shipping & rendering all of them inline would bloat the payload and
// jank the DOM. `ledgerTotal` carries the true count so the UI can offer a
// "View all" link into the paginated, searchable drill-down page.
const LEDGER_CAP = 50;

type GroupNode = FlatGroup & {
    children: GroupNode[];
    ledgers: LedgerRow[];
    ledgerTotal: number;
};

function buildTree(flat: FlatGroup[], ledgersByGroup: Map<number, LedgerRow[]>): GroupNode[] {
    const map = new Map<number, GroupNode>();
    flat.forEach((g) => map.set(g.id, {
        ...g,
        children: [],
        ledgers: ledgersByGroup.get(g.id) ?? [],
        ledgerTotal: ledgersByGroup.get(g.id)?.length ?? 0,
    }));
    const roots: GroupNode[] = [];
    flat.forEach((g) => {
        const node = map.get(g.id)!;
        if (g.parentId === null) {
            roots.push(node);
        } else {
            map.get(g.parentId)?.children.push(node);
        }
    });

    // Roll up totalBalance bottom-up: own ledgers + every descendant group.
    // Runs on the FULL ledger arrays (before the display cap) so totals stay
    // exact. Equivalent to aggregateRolledUpByGroup since both sum the same
    // per-account closings from aggregateClosingAsOf.
    const rollup = (n: GroupNode): number => {
        let sum = n.ledgers.reduce((s, l) => s + l.balance, 0);
        for (const ch of n.children) sum += rollup(ch);
        n.totalBalance = sum;
        return sum;
    };
    roots.forEach(rollup);

    // Cap the displayed ledger list per group (after rollup).
    const cap = (n: GroupNode): void => {
        if (n.ledgers.length > LEDGER_CAP) n.ledgers = n.ledgers.slice(0, LEDGER_CAP);
        n.children.forEach(cap);
    };
    roots.forEach(cap);
    return roots;
}

// GET /api/accountancy/account-groups
//
// Default (lightweight): the group tree with `_count` only — used by group
// management, opening balance, chart of accounts, and the ledger drill-down's
// group picker. Cheap: two queries, no balance walk.
//
// ?withLedgers=1 (heavy): additionally attaches each group's rolled-up
// `totalBalance` and its directly-attached ledger accounts (`ledgers`, capped
// per group) so the masters Ledgers tree can render parent group › sub-group ›
// ledger in one hierarchy. This runs a full per-account closing aggregation, so
// it's gated to the one page that needs it — keeping the hot path off it avoids
// starving the connection pool.
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const withLedgers = new URL(req.url).searchParams.get("withLedgers") === "1";

    try {
        const flat = await prisma.accountGroup.findMany({
            orderBy: [{ parentId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
            include: { _count: { select: { children: true, accounts: true } } },
        });
        const flatGroups = (flat as Omit<FlatGroup, "totalBalance">[]).map(
            (g) => ({ ...g, totalBalance: 0 }),
        );

        if (!withLedgers) {
            return NextResponse.json(buildTree(flatGroups, new Map()));
        }

        const [accounts, nbMap] = await Promise.all([
            prisma.account.findMany({
                where: { groupId: { not: null } },
                orderBy: { name: "asc" },
                select: {
                    id: true, name: true, code: true, normalBalance: true,
                    isActive: true, personId: true, companyId: true, groupId: true,
                    bankJson: true, loanJson: true, creditCardJson: true,
                    bnplJson: true, walletJson: true, gatewayJson: true,
                    openingBalance: true, openingBalanceType: true,
                    openingBalanceDate: true,
                    aliases: { select: { alias: true }, orderBy: { id: "asc" } },
                },
            }),
            loadNormalBalanceMap(),
        ]);

        // Per-account closing, derived from JournalLine (same path as the
        // Balance Sheet) so group rollups agree with the reports.
        const closingMap = await aggregateClosingAsOf(new Date(), nbMap);

        const ledgersByGroup = new Map<number, LedgerRow[]>();
        for (const a of accounts) {
            if (a.groupId === null) continue;
            const arr = ledgersByGroup.get(a.groupId) ?? [];
            arr.push({
                ...a,
                aliases: a.aliases.map((x) => x.alias),
                openingBalance: a.openingBalance !== null ? toNumber(a.openingBalance) : null,
                openingBalanceDate: a.openingBalanceDate
                    ? a.openingBalanceDate.toISOString().slice(0, 10)
                    : null,
                balance: closingMap.get(a.id) ?? 0,
            });
            ledgersByGroup.set(a.groupId, arr);
        }

        return NextResponse.json(buildTree(flatGroups, ledgersByGroup));
    } catch (e) {
        return handleApiError(e, "Failed to fetch account groups");
    }
}

// POST /api/accountancy/account-groups — create a group
export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_MASTERS_CREATE);
    if (response) return response;

    const { data, error } = await validateRequest(req, createSchema);

    if (error) return error;
    const body = data;

    // Sub-groups inherit type from parent; primary groups require an explicit type
    let resolvedType = body.type;
    if (body.parentId) {
        const parent = await prisma.accountGroup.findUnique({
            where: { id: body.parentId },
            select: { type: true },
        });
        if (!parent) return NextResponse.json({ error: "Parent group not found" }, { status: 400 });
        resolvedType = parent.type as typeof resolvedType;
    } else if (!resolvedType) {
        return NextResponse.json({ error: "Type is required for primary groups" }, { status: 400 });
    }

    try {
        const group = await prisma.accountGroup.create({
            data: {
                name: body.name,
                type: resolvedType!,
                parentId: body.parentId ?? null,
                sortOrder: body.sortOrder ?? 0,
            },
        });
        return NextResponse.json(group, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create group");
    }
}
