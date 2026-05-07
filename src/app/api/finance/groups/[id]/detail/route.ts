import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";

// GET /api/finance/groups/[id]/detail
// Returns the group, its child sub-groups (with rolled-up balances), and direct ledger accounts.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("accountancy:view:org");
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
                const sum = await prisma.account.aggregate({
                    _sum: { balance: true },
                    where: { groupId: { in: ids } },
                });
                return {
                    id: sg.id,
                    name: sg.name,
                    type: sg.type,
                    accountCount: sg._count.accounts,
                    childGroupCount: sg._count.children,
                    rolledUpBalance: Number(sum._sum.balance ?? 0),
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
            },
        });

        // Total = own ledgers + sub-group rolled-up balances
        const totalBalance = ledgers.reduce((s, l) => s + Number(l.balance), 0)
            + subGroups.reduce((s, g) => s + g.rolledUpBalance, 0);

        return NextResponse.json({
            group: {
                id: group.id, name: group.name, type: group.type,
                parentId: group.parentId, sortOrder: group.sortOrder,
                parent: group.parent,
            },
            subGroups,
            ledgers: ledgers.map((l) => ({ ...l, balance: Number(l.balance) })),
            totalBalance,
        });
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to load group detail" }, { status: 500 });
    }
}
