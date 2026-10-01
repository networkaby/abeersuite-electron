import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requireModuleAccess } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import {
    aggregateClosingAsOf, loadNormalBalanceMap,
} from "@/modules/accountancy/lib/aggregateLedger";
import { validateRequest } from "@/shared/lib/api";
import { reconcileOpeningSuspense } from "@/modules/accountancy/lib/openingBalance";
import { resetReconciliationOnOpening } from "@/modules/accountancy/lib/reconciliation";
import { handleApiError } from "@/shared/lib/api";

const updateSchema = z.object({
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().optional().nullable(),
    isActive: z.boolean().optional(),
    // Corrects mis-set ledgers (e.g. a Liability-group account wrongly created
    // DEBIT-normal) — normally fixed at creation, but data mistakes happen.
    normalBalance: z.enum(["DEBIT", "CREDIT"]).optional(),
    // Opening-balance fields can be edited inline on the chart-of-accounts row.
    // Universal opening — no date; always effective from the start of the books.
    openingBalance:     z.number().nonnegative().nullish(),
    openingBalanceType: z.enum(["DEBIT", "CREDIT"]).nullish(),
});

// GET /api/accountancy/gl-accounts/[id]
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const account = await prisma.account.findUnique({
        where: { id: Number(id) },
        include: {
            parent: { select: { id: true, name: true } },
            children: {
                select: { id: true, name: true, normalBalance: true },
            },
        },
    });
    if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // GL activity count from the spine (G5 — JournalLine dropped).
    const lineCount = await prisma.voucherGlLine.count({ where: { accountId: Number(id) } });
    // Truth-path closing from the spine GL for this account + any children.
    const nbMap = await loadNormalBalanceMap();
    const closingMap = await aggregateClosingAsOf(new Date(), nbMap);
    return NextResponse.json({
        ...account,
        _count: { lines: lineCount },
        balance: closingMap.get(account.id) ?? 0,
        children: account.children.map((c) => ({
            id: c.id, name: c.name,
            balance: closingMap.get(c.id) ?? 0,
        })),
    });
}

// PATCH /api/accountancy/gl-accounts/[id]
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireModuleAccess("accountancy");
    if (response) return response;

    const { id } = await params;
    const { data, error } = await validateRequest(req, updateSchema);
    if (error) return error;

    try {
        const b = data;
        const openingTouched = b.openingBalance !== undefined || b.openingBalanceType !== undefined;
        // A new opening reaches every day the ledger has — its lock starts over.
        if (openingTouched) {
            await resetReconciliationOnOpening(prisma, Number(id), { amount: b.openingBalance, type: b.openingBalanceType });
        }
        const updated = await prisma.account.update({
            where: { id: Number(id) },
            data: {
                ...(b.name          !== undefined ? { name: b.name } : {}),
                ...(b.description   !== undefined ? { description: b.description } : {}),
                ...(b.isActive      !== undefined ? { isActive: b.isActive } : {}),
                ...(b.normalBalance !== undefined ? { normalBalance: b.normalBalance } : {}),
                ...(b.openingBalance     !== undefined ? { openingBalance:     b.openingBalance     } : {}),
                ...(b.openingBalanceType !== undefined ? { openingBalanceType: b.openingBalanceType } : {}),
                ...(b.openingBalance !== undefined ? { openingBalanceDate: null } : {}),
            },
        });
        // Every other opening write re-balances the suspense ledger; this one did not.
        if (openingTouched) await reconcileOpeningSuspense();
        return NextResponse.json(updated);
    } catch (e) {
        return handleApiError(e, "Failed to update");
    }
}

// DELETE /api/accountancy/gl-accounts/[id] — soft delete
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireModuleAccess("accountancy");
    if (response) return response;

    const { id } = await params;
    const lineCount = await prisma.voucherGlLine.count({ where: { accountId: Number(id) } }); // Phase 4 G3: spine
    if (lineCount > 0) {
        return NextResponse.json({ error: "Cannot deactivate — account has posted journal lines" }, { status: 409 });
    }

    const updated = await prisma.account.update({
        where: { id: Number(id) },
        data: { isActive: false },
    });
    return NextResponse.json(updated);
}
