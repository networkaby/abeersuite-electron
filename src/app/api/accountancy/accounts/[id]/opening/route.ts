import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { reconcileOpeningSuspense } from "@/modules/accountancy/lib/openingBalance";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// PUT /api/accountancy/accounts/[id]/opening
// Sets opening balance + Dr/Cr type on a ledger account. Universal opening —
// no per-account date; always effective from the start of the books, whether
// imported or created fresh. Pass null amount to clear an opening balance.
const schema = z.object({
    amount:          z.number().nullable(),
    type:            z.enum(["DEBIT", "CREDIT"]).nullable(),
});

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_MASTERS_EDIT);
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
                openingBalanceDate: null,
            },
        });
        await reconcileOpeningSuspense();
        return NextResponse.json(account);
    } catch (e) {
        return handleApiError(e, "Failed to update opening balance");
    }
}
