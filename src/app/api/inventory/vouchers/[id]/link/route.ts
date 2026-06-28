// POST /api/inventory/vouchers/[id]/link
// Body: { refVoucherId: number }
//
// Lightweight settlement link — sets the SETTLING voucher's refVoucherId to
// the SOURCE voucher's id. Does NOT touch stock ledger or GL.
//
// [id]          = the settling voucher (e.g. the SALE or REJECTION_IN)
// refVoucherId  = the source voucher being settled (e.g. the CHALLAN or GRN)
//
// After this call the source's refReturns will contain the settling voucher,
// which causes the Pending Vouchers report to mark the source as settled.
//
// Party validation: the two vouchers must share the same customer/supplier.
//   - If the source has a partyId, the settling voucher's partyId must match.
//   - Otherwise both partyNames are compared case-insensitively.
//   - A source with neither partyId nor partyName (rare CASH voucher) skips the check.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { readPartyName } from "@/shared/lib/accountancy/partySnapshot";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const body = await req.json() as { refVoucherId?: unknown };
    const refVoucherId = typeof body.refVoucherId === "number" ? body.refVoucherId : null;

    if (!refVoucherId)
        return NextResponse.json({ error: "refVoucherId (number) required" }, { status: 400 });

    const settlingId = Number(id);
    if (isNaN(settlingId))
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const [settling, source] = await Promise.all([
        prisma.invVoucher.findUnique({
            where:  { id: settlingId },
            select: { id: true, universalVoucher: { select: { status: true } }, refVoucherId: true, partyId: true, partyJson: true },   // 5D-8
        }),
        prisma.invVoucher.findUnique({
            where:  { id: refVoucherId },
            select: { id: true, universalVoucher: { select: { status: true } }, partyId: true, partyJson: true },   // 5D-8
        }),
    ]);

    if (!settling) return NextResponse.json({ error: "Settling voucher not found" }, { status: 404 });
    if (!source)   return NextResponse.json({ error: "Source voucher not found"   }, { status: 404 });
    if (settling.universalVoucher?.status !== "POSTED")
        return NextResponse.json({ error: "Settling voucher must be POSTED" }, { status: 409 });
    if (settling.refVoucherId !== null)
        return NextResponse.json({ error: "Settling voucher is already linked to another source" }, { status: 409 });

    // Party must match — a Challan for Customer A cannot be settled by a Sale for Customer B.
    if (source.partyId !== null) {
        // Source has a known ledger account — settling must have the same partyId.
        if (settling.partyId !== source.partyId)
            return NextResponse.json(
                { error: "Party mismatch — settling voucher belongs to a different customer/supplier" },
                { status: 409 },
            );
    } else if (readPartyName(source.partyJson)) {
        // Fallback: compare frozen snapshot names (case-insensitive).
        const srcName  = (readPartyName(source.partyJson) ?? "").trim().toLowerCase();
        const settName = (readPartyName(settling.partyJson) ?? "").trim().toLowerCase();
        if (srcName && settName && srcName !== settName)
            return NextResponse.json(
                { error: "Party mismatch — settling voucher belongs to a different customer/supplier" },
                { status: 409 },
            );
    }
    // If source has neither partyId nor partyName (CASH no-name), skip the party check.

    await prisma.invVoucher.update({
        where: { id: settlingId },
        data:  { refVoucherId },
    });

    return NextResponse.json({ ok: true });
}
