import { prisma, prismaWhereSaved } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, userCanVoucher } from "@/shared/lib/auth/permissions";
import { enginePostSpine } from "@/modules/accountancy/lib/transactionEngine";
import { handleApiError } from "@/shared/lib/api";

// POST /api/accountancy/vouchers/[id]/post
// DRAFT → POSTED: flips the spine, which puts its GL lines into every summed
// balance. Phase 5 5E: the UniversalVoucher spine IS the financial voucher (the
// Voucher table is dropped), so `id` is the spine id.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const voucher = await prismaWhereSaved().universalVoucher.findUnique({ where: { id: Number(id) } });
    if (!voucher) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Per-kind post gate (falls back to generic finance:voucher:post).
    if (!userCanVoucher(user, voucher.type, "post")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (voucher.status !== "DRAFT") return NextResponse.json({ error: "Only DRAFT vouchers can be posted" }, { status: 409 });

    try {
        // Per-line account.update over the Supabase pooler can exceed the default
        // 5s interactive-tx ceiling (P2028) — match the 30s headroom.
        await prisma.$transaction(async (tx) => {
            await enginePostSpine(tx, voucher.id, { postedAt: new Date() });
        }, { timeout: 30_000, maxWait: 10_000 });

        const posted = await prismaWhereSaved().universalVoucher.findUnique({ where: { id: Number(id) } });
        return NextResponse.json(posted);
    } catch (e) {
        return handleApiError(e, "Failed to post voucher");
    }
}
