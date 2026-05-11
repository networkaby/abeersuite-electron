import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { invNextRef, calcLineTotals, calcVoucherTotals } from "@/modules/inventory/lib/stock";
import { InvVoucherType } from "@/generated/prisma/client";

// GET /api/inventory/vouchers?type=PURCHASE|SALE&status=DRAFT|POSTED|CANCELLED
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const type   = searchParams.get("type")   as InvVoucherType | null;
    const status = searchParams.get("status") as "DRAFT" | "POSTED" | "CANCELLED" | null;

    const vouchers = await prisma.invVoucher.findMany({
        where: {
            ...(type   ? { type }   : {}),
            ...(status ? { status } : {}),
        },
        orderBy: [{ date: "desc" }, { id: "desc" }],
        include: {
            createdBy: { select: { name: true } },
            _count:    { select: { lines: true } },
        },
    });

    return NextResponse.json(vouchers);
}

// POST /api/inventory/vouchers
export async function POST(req: Request) {
    const { response, user } = await requireAuth();
    if (response) return response;

    const body = await req.json();
    const {
        type,
        date,
        description,
        partyName,
        partyType,
        partyId,
        partyPhone,
        partyAddress,
        paymentMode,
        paymentAccountId,
        paymentTerms,
        dueDate,
        shippingAmt    = 0,
        roundOff       = 0,
        amountReceived = 0,
        discountPct,
        discountAmt,
        showPrices,
        lines = [],
    } = body as {
        type:         InvVoucherType;
        date:         string;
        description:  string;
        partyName?:   string;
        partyType?:   string;
        partyId?:     number;
        partyPhone?:  string;
        partyAddress?: string;
        paymentMode?:    string;
        /// Cash / bank Account that received the money — drives postInvVoucher's
        /// cash-leg ledger selection. Null falls back to the name-based lookup.
        paymentAccountId?: number;
        /// Credit-sale payment terms label (e.g. "Net 30")
        paymentTerms?:   string;
        /// Computed due date for the credit voucher (ISO yyyy-mm-dd)
        dueDate?:        string;
        shippingAmt?:    number;
        roundOff?:       number;
        amountReceived?: number;
        /// Voucher-level discount (mutually-convertible with discountAmt)
        discountPct?:    number;
        discountAmt?:    number;
        // Challan-only: when false the printed challan hides rate/amount columns.
        showPrices?:     boolean;
        lines: {
            productId:   number;
            description?: string;
            quantity:    number;
            /// Free / complimentary qty — flows out of stock, ₹0 revenue
            freeQty?:    number;
            rate:        number;
            discountPct?: number;
            discountAmt?: number;
            taxRate?:    number;
        }[];
    };

    if (!type || !date || !description?.trim()) {
        return NextResponse.json({ error: "type, date, description required" }, { status: 400 });
    }
    if (!lines.length) {
        return NextResponse.json({ error: "At least one line item required" }, { status: 400 });
    }
    for (const l of lines) {
        if (!l.productId || l.quantity <= 0) {
            return NextResponse.json({ error: "Each line needs a product and quantity > 0" }, { status: 400 });
        }
    }

    // Compute line totals
    const computedLines = lines.map((l) => {
        const { discountAmt, taxAmount, amount } = calcLineTotals({
            quantity:    l.quantity,
            rate:        l.rate,
            discountPct: l.discountPct ?? 0,
            discountAmt: l.discountAmt ?? 0,
            taxRate:     l.taxRate    ?? 0,
        });
        return { ...l, discountAmt, taxAmount, amount };
    });

    // Resolve voucher-level discount. Either pct or amt may be supplied; the
    // amount wins when both are present (UI keeps them in sync).
    const lineSubtotal = computedLines.reduce((s, l) => s + l.amount, 0);
    const overallDiscount =
        discountAmt != null && Number(discountAmt) > 0
            ? Number(discountAmt)
            : discountPct != null && Number(discountPct) > 0
                ? (lineSubtotal * Number(discountPct)) / 100
                : 0;

    const { subtotal, taxAmount, totalAmount } = calcVoucherTotals(
        computedLines,
        Number(shippingAmt),
        overallDiscount,
        Number(roundOff),
    );

    const userId = user!.id;

    const voucher = await prisma.$transaction(async (tx) => {
        const reference = await invNextRef(tx, type);
        return tx.invVoucher.create({
            data: {
                type,
                reference,
                date:         new Date(date),
                description:  description.trim(),
                partyName:    partyName  || null,
                partyType:    partyType  || null,
                partyId:      partyId    || null,
                partyPhone:   partyPhone || null,
                partyAddress: partyAddress || null,
                paymentMode:     paymentMode || null,
                paymentAccountId: paymentAccountId ?? null,
                paymentTerms:    paymentTerms || null,
                dueDate:         dueDate ? new Date(dueDate) : null,
                shippingAmt,
                roundOff,
                amountReceived,
                discountPct: discountPct != null ? Number(discountPct) : null,
                discountAmt: overallDiscount > 0 ? overallDiscount : null,
                ...(typeof showPrices === "boolean" ? { showPrices } : {}),
                subtotal,
                taxAmount,
                totalAmount,
                createdById: userId,
                lines: {
                    create: computedLines.map((l) => ({
                        productId:   l.productId,
                        description: l.description || null,
                        quantity:    l.quantity,
                        freeQty:     l.freeQty != null && l.freeQty > 0 ? l.freeQty : null,
                        rate:        l.rate,
                        discountPct: l.discountPct ?? 0,
                        discountAmt: l.discountAmt,
                        taxRate:     l.taxRate    ?? 0,
                        taxAmount:   l.taxAmount,
                        amount:      l.amount,
                    })),
                },
            },
            include: {
                lines: { include: { product: { select: { id: true, sku: true, name: true } } } },
                createdBy: { select: { name: true } },
            },
        });
    });

    return NextResponse.json(voucher, { status: 201 });
}
