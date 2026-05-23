import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { selectPrimaryPhone } from "@/shared/lib/prisma/fragments";

// /api/accountancy/invoices/[id]
//
// GET stays alive returning whatever Invoice row still exists (zero after
// the Layer 1 reset). PATCH (and the sibling cancel/delete/restore/
// hard-delete routes) returns 410 Gone — operate on the InvVoucher
// equivalent at /api/inventory/vouchers/[id] instead.

// GET /api/accountancy/invoices/[id]
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { id } = await params;
    const invoice = await prisma.invoice.findUnique({
        where: { id: Number(id) },
        include: {
            createdBy: { select: { id: true, name: true } },
            account: {
                select: {
                    id: true,
                    name: true,
                    person: {
                        select: {
                            id: true,
                            name: true,
                            phones: selectPrimaryPhone,
                        },
                    },
                    company: { select: { id: true, name: true } },
                },
            },
            shopOrder: { select: { id: true, orderSource: true, totalPaise: true } },
            lines: { orderBy: { id: "asc" } },
            payments: {
                orderBy: { date: "desc" },
                include: { createdBy: { select: { id: true, name: true } } },
            },
        },
    });
    if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(invoice);
}

// PATCH — retired (2026-05-24)
export async function PATCH() {
    return NextResponse.json(
        {
            error: "This endpoint is retired. Edit the InvVoucher via PATCH /api/inventory/vouchers/[id].",
            code:  "INVOICE_ENDPOINT_RETIRED",
        },
        { status: 410 },
    );
}
