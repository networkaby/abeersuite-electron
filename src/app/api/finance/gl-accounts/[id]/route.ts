import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/authGuard";
import { z } from "zod";
import { effectiveLedgerBalance } from "@/modules/accountancy/lib/effectiveBalance";

const updateSchema = z.object({
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().optional().nullable(),
    isActive: z.boolean().optional(),
    // Opening-balance fields can be edited inline on the chart-of-accounts row.
    openingBalance:     z.number().nonnegative().nullish(),
    openingBalanceType: z.enum(["DEBIT", "CREDIT"]).nullish(),
    openingBalanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

// GET /api/finance/gl-accounts/[id]
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("accountancy:view:org");
    if (response) return response;

    const { id } = await params;
    const account = await prisma.account.findUnique({
        where: { id: Number(id) },
        include: {
            parent: { select: { id: true, code: true, name: true } },
            children: {
                select: {
                    id: true, code: true, name: true,
                    balance: true, normalBalance: true,
                    openingBalance: true, openingBalanceType: true,
                },
            },
            _count: { select: { lines: true } },
        },
    });
    if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Replace raw balance with effective (running + opening) for both the
    // account itself and any children rendered alongside it.
    return NextResponse.json({
        ...account,
        balance: effectiveLedgerBalance(account),
        children: account.children.map((c) => ({
            id: c.id, code: c.code, name: c.name,
            balance: effectiveLedgerBalance(c),
        })),
    });
}

// PATCH /api/finance/gl-accounts/[id]
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("accountancy:view:org");
    if (response) return response;

    const { id } = await params;
    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }

    try {
        const b = parsed.data;
        const updated = await prisma.account.update({
            where: { id: Number(id) },
            data: {
                ...(b.name        !== undefined ? { name: b.name } : {}),
                ...(b.description !== undefined ? { description: b.description } : {}),
                ...(b.isActive    !== undefined ? { isActive: b.isActive } : {}),
                ...(b.openingBalance     !== undefined ? { openingBalance:     b.openingBalance     } : {}),
                ...(b.openingBalanceType !== undefined ? { openingBalanceType: b.openingBalanceType } : {}),
                ...(b.openingBalanceDate !== undefined ? {
                    openingBalanceDate: b.openingBalanceDate ? new Date(b.openingBalanceDate) : null,
                } : {}),
            },
        });
        return NextResponse.json(updated);
    } catch {
        return NextResponse.json({ error: "Failed to update" }, { status: 500 });
    }
}

// DELETE /api/finance/gl-accounts/[id] — soft delete
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("accountancy:view:org");
    if (response) return response;

    const { id } = await params;
    const lineCount = await prisma.journalLine.count({ where: { accountId: Number(id) } });
    if (lineCount > 0) {
        return NextResponse.json({ error: "Cannot deactivate — account has posted journal lines" }, { status: 409 });
    }

    const updated = await prisma.account.update({
        where: { id: Number(id) },
        data: { isActive: false },
    });
    return NextResponse.json(updated);
}
