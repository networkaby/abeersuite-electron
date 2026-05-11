import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { assembleReference } from "@/modules/accountancy/lib/voucherRef";
import { InvVoucherType } from "@/generated/prisma/client";

// GET /api/inventory/vouchers/next-ref?type=SALE|PURCHASE|ESTIMATE
//
// Preview-only — reads the configured VoucherSeries row (managed at
// /office/admin/year-ending) and assembles the *next* reference WITHOUT
// incrementing the counter. The actual reference is generated atomically
// at save time via invNextRef() inside the transaction; if two users save
// concurrently the live reference may differ by ±1 from this preview.
//
// SALE / PURCHASE / ESTIMATE are configured in VoucherSeries; other inv
// voucher kinds still fall back to the legacy calendar-year scheme — for
// those the dialog doesn't show a preview (returns "").
const SERIES_KIND: Partial<Record<InvVoucherType, string>> = {
    SALE:     "SALE",
    PURCHASE: "PURCHASE",
    ESTIMATE: "ESTIMATE",
};

export async function GET(req: Request) {
    const { response, user } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const type = (searchParams.get("type") ?? "SALE") as InvVoucherType;
    const kind = SERIES_KIND[type];
    if (!kind) return NextResponse.json({ reference: "" });

    const series = await prisma.voucherSeries.findUnique({ where: { kind } });
    if (!series) return NextResponse.json({ reference: "" });

    const reference = assembleReference(
        { ...series, nextSeq: series.nextSeq + 1 },
        user?.id,
    );
    return NextResponse.json({ reference });
}
