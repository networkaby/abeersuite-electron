import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import {
    aggregateClosingAsOf, loadNormalBalanceMap,
} from "@/modules/accountancy/lib/aggregateLedger";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const updateSchema = z.object({
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().optional().nullable(),
    isActive: z.boolean().optional(),
    // Opening-balance fields can be edited inline on the chart-of-accounts row.
    openingBalance:     z.number().nonnegative().nullish(),
    openingBalanceType: z.enum(["DEBIT", "CREDIT"]).nullish(),
    openingBalanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

// GET /api/accountancy/gl-accounts/[id]
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { id } = await params;
    const account = await prisma.account.findUnique({
        where: { id: Number(id) },
        include: {
            parent: { select: { id: true, code: true, name: true } },
            children: {
                select: { id: true, code: true, name: true, normalBalance: true },
            },
            _count: { select: { lines: true } },
        },
    });
    if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Truth-path closing from JournalLine for this account + any children.
    const nbMap = await loadNormalBalanceMap();
    const closingMap = await aggregateClosingAsOf(new Date(), nbMap);
    return NextResponse.json({
        ...account,
        balance: closingMap.get(account.id) ?? 0,
        children: account.children.map((c) => ({
            id: c.id, code: c.code, name: c.name,
            balance: closingMap.get(c.id) ?? 0,
        })),
    });
}

// PATCH /api/accountancy/gl-accounts/[id]
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { id } = await params;
    const { data, error } = await validateRequest(req, updateSchema);
    if (error) return error;

    try {
        const b = data;
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
    } catch (e) {
        return handleApiError(e, "Failed to update");
    }
}

// DELETE /api/accountancy/gl-accounts/[id] — soft delete
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
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
