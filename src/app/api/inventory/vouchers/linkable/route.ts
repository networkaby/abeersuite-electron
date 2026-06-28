// GET /api/inventory/vouchers/linkable?types=SALE,REJECTION_IN&partyId=42
// Returns POSTED vouchers with refVoucherId = null (not yet linked to any source voucher),
// filtered to the given types. Used by the Settle dialog on the Pending Vouchers report.
//
// Party filtering (required — a settling voucher must share the same party):
//   ?partyId=<number>  → filter by exact partyId match (CREDIT-mode vouchers with a known ledger)
//   ?partyName=<str>   → fallback for CASH-mode vouchers; case-insensitive contains match
// If neither param is supplied the route still works but returns vouchers for any party.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { InvVoucherType, VoucherStatus } from "@/generated/prisma/client";
import { resolveActiveBranchId, BranchAccessError } from "@/shared/lib/auth/activeBranch";
import { auth } from "@/auth";
import { readPartyName } from "@/shared/lib/accountancy/partySnapshot";

const VALID_TYPES = new Set(Object.values(InvVoucherType));

export async function GET(req: NextRequest) {
    const { response } = await requireAuth();
    if (response) return response;

    const session = await auth();
    const { searchParams } = new URL(req.url);

    const typesParam = searchParams.get("types") ?? "";
    const types = typesParam
        .split(",")
        .map((t) => t.trim())
        .filter((t) => VALID_TYPES.has(t as InvVoucherType)) as InvVoucherType[];

    if (types.length === 0) return NextResponse.json({ rows: [] });

    let branchFilter: { branchId?: string } = {};
    try {
        branchFilter = { branchId: resolveActiveBranchId(req, session) };
    } catch (e) {
        if (e instanceof BranchAccessError)
            return NextResponse.json({ error: e.message }, { status: 400 });
        throw e;
    }

    // Party filter — settling voucher must match the source's party.
    const partyIdParam  = searchParams.get("partyId");
    const partyNameParam = searchParams.get("partyName");
    type PartyFilter = {
        partyId?: number;
        partyJson?: { path: string[]; string_contains: string };
    };
    let partyFilter: PartyFilter = {};
    if (partyIdParam) {
        const partyId = Number(partyIdParam);
        if (!isNaN(partyId)) partyFilter = { partyId };
    } else if (partyNameParam) {
        // CASH vouchers (no partyId): match the frozen snapshot name.
        partyFilter = { partyJson: { path: ["name"], string_contains: partyNameParam } };
    }

    const rows = await prisma.invVoucher.findMany({
        where: {
            // 5D-8 lifecycle + 5D-11 type on spine
            universalVoucher: { status: VoucherStatus.POSTED, deletedAt: null, type: { in: types } },
            refVoucherId: null,   // not already linked to a source voucher
            ...branchFilter,
            ...partyFilter,
        },
        orderBy: [{ universalVoucher: { date: "desc" } }, { id: "desc" }],   // 5D-10
        take: 100,
        select: {
            id:          true,
            universalVoucher: { select: { voucherNo: true, date: true, type: true } },   // 5D-6: ref + 5D-10 date + 5D-11 type on spine
            partyId:     true,
            partyJson:   true,
            totalAmount: true,
        },
    });

    return NextResponse.json({
        rows: rows.map(({ universalVoucher, ...r }) => ({ ...r, type: universalVoucher?.type, date: universalVoucher?.date, reference: universalVoucher?.voucherNo ?? "", partyName: readPartyName(r.partyJson), totalAmount: Number(r.totalAmount) })),
    });
}
