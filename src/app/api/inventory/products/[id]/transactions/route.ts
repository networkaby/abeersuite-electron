import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { toNumber } from "@/modules/accountancy/lib/balance";

function paymentStatus(totalAmount: { toString(): string }, amountReceived: { toString(): string }) {
    const total = toNumber(totalAmount);
    const recv = toNumber(amountReceived);
    if (total <= 0) return "N/A";
    if (recv >= total) return "PAID";
    if (recv > 0) return "PARTIAL";
    return "UNPAID";
}

// GET /api/inventory/products/[id]/transactions?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const { searchParams } = new URL(req.url);
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    const from = fromParam ? new Date(fromParam) : undefined;
    const to = toParam ? (() => { const d = new Date(toParam); d.setHours(23, 59, 59, 999); return d; })() : undefined;

    try {
        const product = await prisma.invProduct.findUnique({
            where: { id },
            select: {
                id: true,
                sku: true,
                name: true,
                stock: true,
                costPaise: true,
                pricePaise: true,
                lowStockThreshold: true,
                unit: { select: { code: true, label: true } },
                category: { select: { name: true } },
                brand: { select: { name: true } },
                branchStocks: {
                    orderBy: { stock: "desc" },
                    select: { stock: true, branch: { select: { id: true, name: true } } },
                },
            },
        });
        if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

        const lines = await prisma.invVoucherLine.findMany({
            where: {
                productId: id,
                voucher: {
                    status: "POSTED",
                    deletedAt: null,
                    ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
                },
            },
            select: {
                id: true,
                quantity: true,
                rate: true,
                amount: true,
                voucher: {
                    select: {
                        id: true,
                        reference: true,
                        type: true,
                        date: true,
                        partyName: true,
                        totalAmount: true,
                        amountReceived: true,
                    },
                },
            },
            orderBy: { voucher: { date: "desc" } },
        });

        const transactions = lines.map((line) => ({
            lineId: line.id,
            voucherId: line.voucher.id,
            type: line.voucher.type,
            reference: line.voucher.reference,
            date: line.voucher.date,
            partyName: line.voucher.partyName,
            quantity: toNumber(line.quantity),
            rate: toNumber(line.rate),
            amount: toNumber(line.amount),
            unitCode: product.unit.code,
            paymentStatus: paymentStatus(line.voucher.totalAmount, line.voucher.amountReceived),
        }));

        return NextResponse.json({ product, transactions });
    } catch (e) {
        return handleApiError(e, "Failed to fetch product transactions");
    }
}
