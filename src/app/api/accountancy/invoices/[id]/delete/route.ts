import { NextResponse } from "next/server";

// POST /api/accountancy/invoices/[id]/delete — retired (2026-05-24)
export async function POST() {
    return NextResponse.json(
        {
            error: "This endpoint is retired. Soft-delete the InvVoucher via POST /api/inventory/vouchers/[id]/delete.",
            code:  "INVOICE_LIFECYCLE_ENDPOINT_RETIRED",
        },
        { status: 410 },
    );
}
