import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, userCanVoucher } from "@/shared/lib/auth/permissions";
import { postFinancialTransaction } from "@/modules/accountancy/lib/transactionEngine";
import { handleApiError } from "@/shared/lib/api";

// POST /api/accountancy/vouchers/[id]/post
// DRAFT → POSTED: applies GL impact, creates a mirror JournalEntry for the audit
// trail, and updates Account.balance per line.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const voucher = await prisma.voucher.findUnique({
        where: { id: Number(id) },
        include: {
            lines: { include: { account: { select: { id: true, normalBalance: true, group: { select: { type: true } } } } } },
        },
    });
    if (!voucher) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Per-kind post gate (falls back to generic finance:voucher:post).
    if (!userCanVoucher(user, voucher.type, "post")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (voucher.deletedAt) return NextResponse.json({ error: "Voucher is deleted — restore first" }, { status: 409 });
    if (voucher.status !== "DRAFT") return NextResponse.json({ error: "Only DRAFT vouchers can be posted" }, { status: 409 });

    try {
        // DRAFT → POSTED via the Transaction Engine (mirror JE + balance deltas).
        // Per-line account.update + mirror-JE over the Supabase pooler can exceed
        // the default 5s interactive-tx ceiling (P2028) — match the 30s headroom.
        const posted = await prisma.$transaction(async (tx) => {
            await postFinancialTransaction(tx, voucher, user!.id);
            return tx.voucher.findUnique({ where: { id: voucher.id } });
        }, { timeout: 30_000, maxWait: 10_000 });

        return NextResponse.json(posted);
    } catch (e) {
        return handleApiError(e, "Failed to post voucher");
    }
}
