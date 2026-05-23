// GET /api/pos/return/search
//
// Two lookup modes, both return the same `FoundInvoice[]` shape so the
// PosReturnDialog UI is uniform:
//
//   ?q=POS-…/SV-…  — voucher-reference substring search (cashier types it)
//   ?customerId=N  — every POS/SALE InvVoucher for that customer account
//                    (used when the customer has lost the original receipt)
//
// Returns POS + SALE InvVouchers only — never SALE_RETURN (no return of a
// return) and never DRAFT/CANCELLED/deleted rows. The `id` and per-line
// `id` in the response point to InvVoucher / InvVoucherLine since the
// 2026-05-24 Invoice→InvVoucher consolidation; the field names are kept
// for client-side API back-compat — the dialog treats them as opaque IDs.

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
        const vouchers = await prisma.invVoucher.findMany({
            where: {
                deletedAt: null,
                status:    "POSTED",
                type:      { in: ["POS", "SALE"] },
                ...(customerId
                    ? { accountId: Number(customerId) }
                    : { reference: { contains: q, mode: "insensitive" } }),
            },
            orderBy: { date: "desc" },
            take:    10,
            include: {
                account: { select: { id: true, name: true } },
                lines: {
                    select: {
                        id: true,
                        productId: true,
                        description: true,
                        quantity: true,
                        rate: true,
                        taxRate: true,
                        taxAmount: true,
                        amount: true,
                        product: { select: { id: true, name: true, sku: true } },
                    },
                },
                // SALE_RETURN children of this voucher — for the dialog's "already returned" guard
                refReturns: { select: { id: true, reference: true, totalAmount: true } },
            },
        });

        return NextResponse.json(vouchers.map((v) => ({
            id:          v.id,
            number:      v.reference,
            issueDate:   v.date,
            status:      "PAID", // legacy field — POS sales are always settled at counter; UI uses it as a "OK to return" sentinel
            totalAmount: v.totalAmount.toString(),
            account:     v.account ? { id: v.account.id, name: v.account.name } : null,
            lines:       v.lines.map((l) => ({
                id:          l.id,
                productId:   l.productId,
                description: l.description ?? "",
                quantity:    l.quantity.toString(),
                unitPrice:   l.rate.toString(),
                taxRate:     l.taxRate?.toString() ?? "0",
                taxAmount:   l.taxAmount?.toString() ?? "0",
                amount:      l.amount.toString(),
                product:     l.product,
            })),
            returns: v.refReturns.map((r) => ({
                id:          r.id,
                number:      r.reference,
                totalAmount: r.totalAmount.toString(),
            })),
        })));
    } catch (e) {
        return handleApiError(e, "Failed to search invoices");
    }
}
