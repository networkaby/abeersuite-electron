import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { assembleReference } from "@/modules/accountancy/lib/voucherRef";
import { InvVoucherType } from "@/generated/prisma/client";

// GET /api/inventory/vouchers/next-ref?type=SALE|PURCHASE|ESTIMATE
//
// Preview-only — reads the configured VoucherSeries row (managed at
// /office/settings/year-ending) and assembles the *next* reference WITHOUT
// incrementing the counter. The actual reference is generated atomically
// at save time via invNextRef() inside the transaction; if two users save
// concurrently the live reference may differ by ±1 from this preview.
//
// SALE / PURCHASE / ESTIMATE are configured in VoucherSeries; other inv
// voucher kinds still fall back to the legacy calendar-year scheme — for
// those the dialog doesn't show a preview (returns "").
const SERIES_KIND: Partial<Record<InvVoucherType, string>> = {
    SALE:                  "SALE",
    POS:                   "POS",
    ONLINE_INVOICE:        "ONLINE_INVOICE",
    ONLINE_ORDER:          "ONLINE_ORDER",
    PURCHASE:              "PURCHASE",
    ESTIMATE:              "ESTIMATE",
    SALE_RETURN:           "SALE_RETURN",
    PURCHASE_RETURN:       "PURCHASE_RETURN",
    SALES_ORDER:           "SALES_ORDER",
    PURCHASE_ORDER:        "PURCHASE_ORDER",
    GRN:                   "GRN",
    CHALLAN:               "CHALLAN",
    MANUFACTURING_JOURNAL: "MANUFACTURING_JOURNAL",
    PHYSICAL_STOCK:        "PHYSICAL_STOCK",
    BRANCH_TRANSFER:       "BRANCH_TRANSFER",
    REJECTION_IN:          "REJECTION_IN",
    REJECTION_OUT:         "REJECTION_OUT",
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

    const counterParam = searchParams.get("counterNumber") ?? searchParams.get("counter");
    const counterNumber = counterParam ? Number(counterParam) : 1;

    const reference = assembleReference(
        { ...series, nextSeq: series.nextSeq + 1 },
        { counterNumber },
    );
    return NextResponse.json({ reference });
}
