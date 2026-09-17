import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import {
    aggregateClosingAsOf, loadNormalBalanceMap,
} from "@/modules/accountancy/lib/aggregateLedger";
import { groupSign } from "@/modules/accountancy/lib/groupNature";

// GET /api/accountancy/groups/[id]/detail
// Returns the group, its child sub-groups (with rolled-up balances), and direct ledger accounts.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
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
            select: { id: true, parentId: true, type: true },
        });
        // A roll-up needs each group's nature to re-sign contra ledgers — see
        // `groupSign`. Without it this page printed Sales and Purchases higher
        // than the Trial Balance by twice their returns.
        const typeOfGroup = new Map(allGroups.map((g) => [g.id, g.type]));
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

        // Truth-path closing per account from JournalLine, folding in master openings.
        // Shared with the Balance Sheet — guaranteed to agree with the BS / Trial Balance.
        const nbMap = await loadNormalBalanceMap();
        const closingMap = await aggregateClosingAsOf(new Date(), nbMap);

        // Index accounts by groupId for descendant rollups (one query, used twice below).
        const allAccounts = await prisma.account.findMany({
            select: { id: true, groupId: true, isActive: true, normalBalance: true },
        });
        const byGroup = new Map<number, typeof allAccounts>();
        for (const a of allAccounts) {
            if (a.groupId == null) continue;
            const arr = byGroup.get(a.groupId) ?? [];
            arr.push(a);
            byGroup.set(a.groupId, arr);
        }

        const subGroups = subGroupsRaw.map((sg) => {
            let rolledUpBalance = 0;
            for (const id of descendantIds(sg.id)) {
                const accs = byGroup.get(id);
                if (!accs) continue;
                const gt = typeOfGroup.get(id);
                for (const a of accs) {
                    const sign = gt ? groupSign(gt, a.normalBalance) : 1;
                    rolledUpBalance += sign * (closingMap.get(a.id) ?? 0);
                }
            }
            return {
                id: sg.id,
                name: sg.name,
                type: sg.type,
                accountCount: sg._count.accounts,
                childGroupCount: sg._count.children,
                rolledUpBalance,
            };
        });

        // Direct ledger accounts in this group
        const ledgers = await prisma.account.findMany({
            where: { groupId, isActive: true },
            orderBy: [{ name: "asc" }],
            select: {
                id: true, name: true,
                personId: true, companyId: true,
                normalBalance: true,
            },
        });
        const ledgersWithEffective = ledgers.map((l) => ({
            ...l,
            // Signed against the GROUP, so these add up to `totalBalance` and
            // agree with the same group's row on the Trial Balance.
            balance: groupSign(group.type, l.normalBalance) * (closingMap.get(l.id) ?? 0),
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
                id: l.id, name: l.name,
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
