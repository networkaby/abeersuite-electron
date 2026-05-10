import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { nextRefFromSeries } from "@/modules/accountancy/lib/balance";
import { postInvoiceJe } from "@/shared/lib/format/postInvoiceJe";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const lineSchema = z.object({
    description: z.string().trim().min(1),
    quantity: z.number().positive(),
    unitPrice: z.number().min(0),
    taxRate: z.number().min(0).max(100).default(0),
});

const createSchema = z.object({
    // Primary GL link — account from PartyPicker
    accountId: z.number().int().positive(),
    issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    notes: z.string().trim().optional(),
    lines: z.array(lineSchema).min(1, "At least one line item required"),
    // If status is SENT, auto-post the AR/Revenue journal entry
    status: z.enum(["DRAFT", "SENT"]).default("DRAFT"),
});

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

// GET /api/finance/invoices
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

// POST /api/finance/invoices
export async function POST(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { data, error } = await validateRequest(req, createSchema);

    if (error) return error;
    const body = data;

    // Compute totals
    const computedLines = body.lines.map((l) => {
        const lineSubtotal = l.quantity * l.unitPrice;
        const taxAmount = Math.round(lineSubtotal * (l.taxRate / 100) * 100) / 100;
        return { ...l, taxAmount, amount: lineSubtotal + taxAmount };
    });
    const subtotal = computedLines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    const taxAmount = computedLines.reduce((s, l) => s + l.taxAmount, 0);
    const totalAmount = subtotal + taxAmount;

    try {
        const invoice = await prisma.$transaction(async (tx) => {
            const number = await nextRefFromSeries(tx, "INVOICE", user!.id);

            const inv = await tx.invoice.create({
                data: {
                    number,
                    status: body.status,
                    issueDate: new Date(body.issueDate),
                    dueDate: new Date(body.dueDate),
                    notes: body.notes ?? null,
                    accountId: body.accountId,
                    subtotal,
                    taxAmount,
                    totalAmount,
                    amountPaid: 0,
                    createdById: user!.id,
                    lines: {
                        create: computedLines.map((l) => ({
                            description: l.description,
                            quantity: l.quantity,
                            unitPrice: l.unitPrice,
                            taxRate: l.taxRate,
                            taxAmount: l.taxAmount,
                            amount: l.amount,
                        })),
                    },
                },
                include: { lines: true },
            });

            // Auto-post AR/Revenue JE if status is SENT
            if (body.status === "SENT") {
                await postInvoiceJe(tx, inv.id, number, subtotal, taxAmount, totalAmount, user!.id);
            }

            return inv;
        });

        return NextResponse.json(invoice, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create invoice");
    }
}
