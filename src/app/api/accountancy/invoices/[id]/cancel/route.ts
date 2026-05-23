import { NextResponse } from "next/server";

// POST /api/accountancy/invoices/[id]/cancel — retired (2026-05-24)
// Cancel an inventory voucher via its lifecycle endpoint instead.
export async function POST() {
    return NextResponse.json(
        {
            error: "This endpoint is retired. Cancel the InvVoucher via POST /api/inventory/vouchers/[id]/cancel.",
            code:  "INVOICE_LIFECYCLE_ENDPOINT_RETIRED",
        },
        { status: 410 },
    );
}
