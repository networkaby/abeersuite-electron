// GET /api/pos/return/search
//
// Two lookup modes, both return the same FoundInvoice[] shape so the
// PosReturnDialog UI is uniform:
//
//   ?q=INV-…           — invoice-number substring search (cashier types it in)
//   ?customerId=N      — every PAID invoice for that customer (used when the
//                        customer has lost the invoice but is in the system)
//
// Only PAID invoices, not already returns themselves, not deleted.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

export async function GET(req: NextRequest) {
    const { response } = await requirePermission(PERMISSIONS.POS_SHIFT_OPEN);
    if (response) return response;

    const url        = new URL(req.url);
    const q          = url.searchParams.get("q")?.trim() ?? "";
    const customerId = url.searchParams.get("customerId");

    if (!q && !customerId) {
        return NextResponse.json({ error: "Pass either q=<invoice#> or customerId=<accountId>" }, { status: 400 });
    }
    if (q && q.length < 2) {
        return NextResponse.json({ error: "Enter at least 2 characters" }, { status: 400 });
    }

    try {
        const where = customerId
            ? {
                deletedAt:  null,
                status:     "PAID" as const,
                returnOfId: null,
                accountId:  Number(customerId),
            }
            : {
                deletedAt:  null,
                status:     "PAID" as const,
                returnOfId: null,
                number:     { contains: q, mode: "insensitive" as const },
            };

        const invoices = await prisma.invoice.findMany({
            where,
            orderBy: { issueDate: "desc" },
            take:    10,
            include: {
                account: { select: { id: true, name: true } },
                lines: {
                    select: {
                        id: true,
                        productId: true,
                        description: true,
                        quantity: true,
                        unitPrice: true,
                        taxRate: true,
                        taxAmount: true,
                        amount: true,
                        product: { select: { id: true, name: true, sku: true } },
                    },
                },
                returns: { select: { id: true, number: true, totalAmount: true } },
            },
        });

        return NextResponse.json(invoices.map((inv) => ({
            id:          inv.id,
            number:      inv.number,
            issueDate:   inv.issueDate,
            status:      inv.status,
            totalAmount: inv.totalAmount.toString(),
            account:     inv.account,
            lines:       inv.lines.map((l) => ({
                id:          l.id,
                productId:   l.productId,
                description: l.description,
                quantity:    l.quantity.toString(),
                unitPrice:   l.unitPrice.toString(),
                taxRate:     l.taxRate.toString(),
                taxAmount:   l.taxAmount.toString(),
                amount:      l.amount.toString(),
                product:     l.product,
            })),
            returns: inv.returns.map((r) => ({
                id:          r.id,
                number:      r.number,
                totalAmount: r.totalAmount.toString(),
            })),
        })));
    } catch (e) {
        return handleApiError(e, "Failed to search invoices");
    }
}
