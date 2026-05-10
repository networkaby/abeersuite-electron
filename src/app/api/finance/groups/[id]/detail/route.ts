import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import {
    effectiveLedgerBalance, EFFECTIVE_BALANCE_SELECT,
} from "@/modules/accountancy/lib/effectiveBalance";

// GET /api/finance/groups/[id]/detail
// Returns the group, its child sub-groups (with rolled-up balances), and direct ledger accounts.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { id } = await params;
    const groupId = Number(id);
    if (isNaN(groupId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    try {
        const group = await prisma.accountGroup.findUnique({
            where: { id: groupId },
            include: { parent: { select: { id: true, name: true } } },
        });
        if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });

        // Direct sub-groups
        const subGroupsRaw = await prisma.accountGroup.findMany({
            where: { parentId: groupId, isActive: true },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            include: { _count: { select: { children: true, accounts: true } } },
        });

        // Rolled-up balance per sub-group (recursive)
        // Approach: collect all descendant ids per sub-group, sum Account.balance.
        const allGroups = await prisma.accountGroup.findMany({
            select: { id: true, parentId: true },
        });
        const childMap = new Map<number, number[]>();
        for (const g of allGroups) {
            if (g.parentId === null) continue;
            const arr = childMap.get(g.parentId) ?? [];
            arr.push(g.id);
            childMap.set(g.parentId, arr);
        }
        function descendantIds(rootId: number): number[] {
            const out = [rootId];
            const stack = [rootId];
            while (stack.length) {
                const top = stack.pop()!;
                const kids = childMap.get(top) ?? [];
                out.push(...kids);
                stack.push(...kids);
            }
            return out;
        }

        const subGroups = await Promise.all(
            subGroupsRaw.map(async (sg) => {
                const ids = descendantIds(sg.id);
                // Walk descendant accounts so we can fold in opening balances —
                // a single _sum aggregate can't combine balance + opening.
                const accs = await prisma.account.findMany({
                    where: { groupId: { in: ids } },
                    select: EFFECTIVE_BALANCE_SELECT,
                });
                const rolledUpBalance = accs.reduce((s, a) => s + effectiveLedgerBalance(a), 0);
                return {
                    id: sg.id,
                    name: sg.name,
                    type: sg.type,
                    accountCount: sg._count.accounts,
                    childGroupCount: sg._count.children,
                    rolledUpBalance,
                };
            }),
        );

        // Direct ledger accounts in this group
        const ledgers = await prisma.account.findMany({
            where: { groupId, isActive: true },
            orderBy: [{ name: "asc" }],
            select: {
                id: true, name: true, code: true,
                personId: true, companyId: true, balance: true,
                normalBalance: true,
                openingBalance: true, openingBalanceType: true,
            },
        });
        const ledgersWithEffective = ledgers.map((l) => ({
            ...l,
            balance: effectiveLedgerBalance(l),
        }));

        // Total = own ledgers + sub-group rolled-up balances
        const totalBalance = ledgersWithEffective.reduce((s, l) => s + l.balance, 0)
            + subGroups.reduce((s, g) => s + g.rolledUpBalance, 0);

        return NextResponse.json({
            group: {
                id: group.id, name: group.name, type: group.type,
                parentId: group.parentId, sortOrder: group.sortOrder,
                parent: group.parent,
            },
            subGroups,
            ledgers: ledgersWithEffective.map((l) => ({
                id: l.id, name: l.name, code: l.code,
                personId: l.personId, companyId: l.companyId,
                normalBalance: l.normalBalance,
                balance: l.balance,
            })),
            totalBalance,
        });
    } catch (e) {
        return handleApiError(e, "Failed to load group detail");
    }
}
