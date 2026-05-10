import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { reconcileOpeningSuspense } from "@/modules/accountancy/lib/openingBalance";

// PUT /api/finance/accounts/[id]/opening
// Sets opening balance + Dr/Cr type + as-of date on a ledger account.
// Pass null amount to clear an opening balance.
const schema = z.object({
    amount:          z.number().nullable(),
    type:            z.enum(["DEBIT", "CREDIT"]).nullable(),
    asOfDate:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("finance:opening-balance:manage");
    if (response) return response;

    const { id } = await params;
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });

    try {
        const account = await prisma.account.update({
            where: { id: Number(id) },
            data: {
                openingBalance:     parsed.data.amount,
                openingBalanceType: parsed.data.type,
                openingBalanceDate: parsed.data.asOfDate ? new Date(parsed.data.asOfDate) : null,
            },
        });
        await reconcileOpeningSuspense();
        return NextResponse.json(account);
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to update opening balance" }, { status: 500 });
    }
}
