import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { calcLineTotals, calcVoucherTotals } from "@/modules/inventory/lib/stock";

type Params = { params: Promise<{ id: string }> };

// GET /api/inventory/vouchers/[id]
export async function GET(_req: Request, { params }: Params) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const voucher = await prisma.invVoucher.findUnique({
        where: { id: Number(id) },
        include: {
            lines: {
                include: {
                    product: {
                        select: { id: true, sku: true, name: true, unit: { select: { code: true, label: true } } },
                    },
                },
            },
            stockEntries: { include: { product: { select: { id: true, sku: true, name: true } } } },
            createdBy: { select: { name: true } },
        },
    });
    if (!voucher) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(voucher);
}

// PATCH /api/inventory/vouchers/[id]  — only allowed on DRAFT
export async function PATCH(req: Request, { params }: Params) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const existing = await prisma.invVoucher.findUnique({ where: { id: Number(id) } });
    if (!existing)              return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.status !== "DRAFT") return NextResponse.json({ error: "Only DRAFT vouchers can be edited" }, { status: 409 });

    const body = await req.json();
    const {
        date,
        description,
        partyName,
        partyType,
        partyId,
        partyPhone,
        partyAddress,
        paymentMode,
        shippingAmt,
        roundOff,
        lines,
    } = body as {
        date?:         string;
        description?:  string;
        partyName?:    string;
        partyType?:    string;
        partyId?:      number;
        partyPhone?:   string;
        partyAddress?: string;
        paymentMode?:  string;
        shippingAmt?:  number;
        roundOff?:     number;
        lines?: {
            productId:   number;
            description?: string;
            quantity:    number;
            rate:        number;
            discountPct?: number;
            discountAmt?: number;
            taxRate?:    number;
        }[];
    };

    // Recompute totals if lines provided
    let totals: { subtotal: number; taxAmount: number; totalAmount: number } | undefined;
    let computedLines: ({
        productId: number; description?: string; quantity: number; rate: number;
        discountPct?: number; discountAmt: number; taxRate?: number; taxAmount: number; amount: number;
    })[] | undefined;

    if (lines?.length) {
        computedLines = lines.map((l) => {
            const { discountAmt, taxAmount, amount } = calcLineTotals({
                quantity:    l.quantity,
                rate:        l.rate,
                discountPct: l.discountPct ?? 0,
                discountAmt: l.discountAmt ?? 0,
                taxRate:     l.taxRate    ?? 0,
            });
            return { ...l, discountAmt, taxAmount, amount };
        });
        totals = calcVoucherTotals(
            computedLines,
            shippingAmt ?? Number(existing.shippingAmt),
            0,
            roundOff    ?? Number(existing.roundOff),
        );
    }

    const updated = await prisma.$transaction(async (tx) => {
        if (computedLines) {
            await tx.invVoucherLine.deleteMany({ where: { voucherId: Number(id) } });
        }
        return tx.invVoucher.update({
            where: { id: Number(id) },
            data: {
                ...(date        ? { date: new Date(date) } : {}),
                ...(description ? { description: description.trim() } : {}),
                ...(partyName   !== undefined ? { partyName:    partyName    || null } : {}),
                ...(partyType   !== undefined ? { partyType:    partyType    || null } : {}),
                ...(partyId     !== undefined ? { partyId:      partyId      || null } : {}),
                ...(partyPhone  !== undefined ? { partyPhone:   partyPhone   || null } : {}),
                ...(partyAddress !== undefined ? { partyAddress: partyAddress || null } : {}),
                ...(paymentMode !== undefined ? { paymentMode:  paymentMode  || null } : {}),
                ...(shippingAmt !== undefined ? { shippingAmt } : {}),
                ...(roundOff    !== undefined ? { roundOff }    : {}),
                ...(totals ? totals : {}),
                ...(computedLines ? {
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
                } : {}),
            },
            include: {
                lines: { include: { product: { select: { id: true, sku: true, name: true } } } },
                createdBy: { select: { name: true } },
            },
        });
    });

    return NextResponse.json(updated);
}

// DELETE /api/inventory/vouchers/[id]  — only allowed on DRAFT
export async function DELETE(_req: Request, { params }: Params) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const existing = await prisma.invVoucher.findUnique({ where: { id: Number(id) } });
    if (!existing)              return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.status !== "DRAFT") return NextResponse.json({ error: "Only DRAFT vouchers can be deleted" }, { status: 409 });

    await prisma.invVoucher.delete({ where: { id: Number(id) } });
    return NextResponse.json({ ok: true });
}
