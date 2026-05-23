import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// /api/accountancy/invoices
//
// The Invoice model is being retired in favour of InvVoucher (consolidation
// plan filed 2026-05-24). Layer 2d of that plan stops new writes here:
//
//   POST → 410 Gone, with a pointer to the canonical create endpoint
//          (POST /api/inventory/vouchers with type=SALE).
//
// The GET stays alive returning whatever Invoice rows still exist in the
// database (zero after the Layer 1 reset), so the few legacy callers
// (TicketInvoicesPanel, ledger-outstandings UI) don't 404 during the
// transition. Layer 3 migrates those readers to InvVoucher; Layer 5
// deletes this directory.

const INVOICE_INCLUDE = {
    createdBy: { select: { id: true, name: true } },
    account: {
        select: {
            id: true,
            name: true,
            person: { select: { id: true, name: true } },
            company: { select: { id: true, name: true } },
        },
    },
    shopOrder: { select: { id: true, orderSource: true } },
    _count: { select: { lines: true, payments: true } },
} as const;

// GET /api/accountancy/invoices
export async function GET(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const accountId = searchParams.get("accountId");
    const orderSource = searchParams.get("orderSource");
    const ticketId = searchParams.get("ticketId");

    try {
        const invoices = await prisma.invoice.findMany({
            where: {
                ...(status ? { status: status as "DRAFT" | "SENT" | "PARTIAL" | "PAID" | "VOID" } : {}),
                ...(accountId ? { accountId: Number(accountId) } : {}),
                ...(ticketId ? { ticketId: Number(ticketId) } : {}),
                ...(orderSource ? { shopOrder: { orderSource: orderSource as never } } : {}),
            },
            orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
            include: INVOICE_INCLUDE,
        });
        return NextResponse.json(invoices);
    } catch (e) {
        return handleApiError(e, "Failed to fetch invoices");
    }
}

// POST /api/accountancy/invoices — deprecated; use /api/inventory/vouchers
export async function POST() {
    return NextResponse.json(
        {
            error: "This endpoint is retired. Create a SALE InvVoucher via POST /api/inventory/vouchers (type=SALE).",
            code:  "INVOICE_ENDPOINT_RETIRED",
        },
        { status: 410 },
    );
}
