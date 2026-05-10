import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { reconcileOpeningSuspense } from "@/modules/accountancy/lib/openingBalance";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// PUT /api/finance/accounts/[id]/opening
// Sets opening balance + Dr/Cr type + as-of date on a ledger account.
// Pass null amount to clear an opening balance.
const schema = z.object({
    amount:          z.number().nullable(),
    type:            z.enum(["DEBIT", "CREDIT"]).nullable(),
    asOfDate:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.FINANCE_OPENING_BALANCE_MANAGE);
    if (response) return response;

    const { id } = await params;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    try {
        const account = await prisma.account.update({
            where: { id: Number(id) },
            data: {
                openingBalance:     data.amount,
                openingBalanceType: data.type,
                openingBalanceDate: data.asOfDate ? new Date(data.asOfDate) : null,
            },
        });
        await reconcileOpeningSuspense();
        return NextResponse.json(account);
    } catch (e) {
        return handleApiError(e, "Failed to update opening balance");
    }
}
