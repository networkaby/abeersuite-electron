import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// /api/accountancy/invoices/[id]/payments
//
// Retired as part of the Invoice → InvVoucher consolidation (2026-05-24).
// Customer receipts are now Voucher rows (type=RECEIPT) created via
// POST /api/accountancy/vouchers, with a VoucherAllocation tying them to
// the originating InvVoucher's JournalEntry. See `postReceiptVoucher`.
//
// The GET stays alive returning whatever Payment rows still exist (zero
// after the Layer 1 reset) so legacy readers don't 404 during the
// transition. Layer 5 deletes this directory along with Payment itself.

// POST — deprecated; use POST /api/accountancy/vouchers (type=RECEIPT) + VoucherAllocation.
export async function POST() {
    return NextResponse.json(
        {
            error: "This endpoint is retired. Create a Voucher (type=RECEIPT) via POST /api/accountancy/vouchers and tie it to the InvVoucher's journalEntryId with a VoucherAllocation (sourceType=VOUCHER, targetType=JOURNAL_ENTRY, method=AGAINST_REF).",
            code:  "INVOICE_PAYMENT_ENDPOINT_RETIRED",
        },
        { status: 410 },
    );
}

// GET /api/accountancy/invoices/[id]/payments
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { id } = await params;
    const payments = await prisma.payment.findMany({
        where: { invoiceId: Number(id) },
        orderBy: { date: "desc" },
        include: { createdBy: { select: { id: true, name: true } } },
    });
    return NextResponse.json(payments);
}
