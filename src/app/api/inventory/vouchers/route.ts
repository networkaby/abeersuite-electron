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
        shippingAmt    = 0,
        roundOff       = 0,
        amountReceived = 0,
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
        shippingAmt?:    number;
        roundOff?:       number;
        amountReceived?: number;
        // Challan-only: when false the printed challan hides rate/amount columns.
        showPrices?:     boolean;
        lines: {
            productId:   number;
            description?: string;
            quantity:    number;
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

    const { subtotal, taxAmount, totalAmount } = calcVoucherTotals(
        computedLines,
        Number(shippingAmt),
        0,
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
                shippingAmt,
                roundOff,
                amountReceived,
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
