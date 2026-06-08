import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { calcLineTotals, calcVoucherTotals } from "@/modules/inventory/lib/stock";
import { ORDER_STAGE } from "@/modules/order/lib/orderPipeline";

// GET  /api/orders/[source]/[id]      → order detail (lines) for the detail/edit view
// PATCH/api/orders/[source]/[id]      → edit the order's lines (G2): drop a damaged
//   line / change a quantity at Review, recompute totals (same math as creation).
//   Allowed only on order-type InvVouchers that are still PRE-CONFIRM (New / Under
//   Review) — once Confirmed the stock is reserved and the order is locked harder.
//   "With permission" — gated; a dedicated orders:edit key can replace the gate.

const EDITABLE_STAGES: string[] = [ORDER_STAGE.NEW, ORDER_STAGE.UNDER_REVIEW];

export async function GET(_req: Request, { params }: { params: Promise<{ source: string; id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;
    const { source, id: idStr } = await params;
    const id = Number(idStr);
    if (source !== "inv" || !Number.isInteger(id)) return NextResponse.json({ error: "Unsupported order ref" }, { status: 400 });
    try {
        const v = await prisma.invVoucher.findUnique({
            where: { id },
            select: {
                id: true, reference: true, type: true, orderStatusId: true, partyName: true,
                subtotal: true, taxAmount: true, discountAmt: true, discountPct: true, totalAmount: true,
                lines: { select: { id: true, productId: true, description: true, quantity: true, rate: true, taxRate: true, mrpPaise: true, savedSalePricePaise: true, amount: true } },
            },
        });
        if (!v || (v.type !== "POS_ORDER" && v.type !== "SALES_ORDER")) return NextResponse.json({ error: "Order not found" }, { status: 404 });
        return NextResponse.json({
            id: v.id, ref: v.reference, customer: v.partyName, statusId: v.orderStatusId,
            editable: v.orderStatusId != null && EDITABLE_STAGES.includes(v.orderStatusId),
            subtotal: toNumber(v.subtotal), taxAmount: toNumber(v.taxAmount), discountAmt: v.discountAmt != null ? toNumber(v.discountAmt) : 0, discountPct: v.discountPct != null ? toNumber(v.discountPct) : null, totalAmount: toNumber(v.totalAmount),
            lines: v.lines.map((l) => ({
                id: l.id, productId: l.productId, description: l.description,
                quantity: toNumber(l.quantity), rate: toNumber(l.rate), taxRate: toNumber(l.taxRate),
                mrpPaise: l.mrpPaise, savedSalePricePaise: l.savedSalePricePaise, amount: toNumber(l.amount),
            })),
        });
    } catch (e) {
        return handleApiError(e, "Failed to load order");
    }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ source: string; id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;
    const { source, id: idStr } = await params;
    const id = Number(idStr);
    if (source !== "inv" || !Number.isInteger(id)) return NextResponse.json({ error: "Unsupported order ref" }, { status: 400 });

    try {
        const body = (await req.json()) as {
            lines: { productId: number; description?: string | null; quantity: number; rate: number; taxRate?: number; mrpPaise?: number | null; savedSalePricePaise?: number | null }[];
            discountAmt?: number | null; discountPct?: number | null; shippingAmt?: number | null; roundOff?: number | null;
        };
        const lines = Array.isArray(body.lines) ? body.lines : [];
        if (lines.length === 0) return NextResponse.json({ error: "An order needs at least one line." }, { status: 400 });
        for (const l of lines) {
            if (!l.productId || !(l.quantity > 0)) return NextResponse.json({ error: "Each line needs a product and quantity > 0." }, { status: 400 });
        }

        const order = await prisma.invVoucher.findUnique({ where: { id }, select: { type: true, orderStatusId: true } });
        if (!order || (order.type !== "POS_ORDER" && order.type !== "SALES_ORDER")) return NextResponse.json({ error: "Order not found" }, { status: 404 });
        if (!order.orderStatusId || !EDITABLE_STAGES.includes(order.orderStatusId)) {
            return NextResponse.json({ error: "Only orders at New / Under Review can be edited. Move it back to Review first.", code: "NOT_EDITABLE" }, { status: 409 });
        }

        // Recompute exactly like creation (calcLineTotals + calcVoucherTotals).
        const computed = lines.map((l) => {
            const rate = Number(l.rate) || 0;
            const { discountAmt, taxAmount, amount } = calcLineTotals({ quantity: l.quantity, rate, discountPct: 0, discountAmt: 0, taxRate: l.taxRate ?? 0 });
            return { ...l, rate, discountAmt, taxAmount, amount };
        });
        const lineSubtotal = computed.reduce((s, l) => s + l.amount, 0);
        const overallDiscount = body.discountAmt != null && Number(body.discountAmt) > 0
            ? Number(body.discountAmt)
            : body.discountPct != null && Number(body.discountPct) > 0 ? (lineSubtotal * Number(body.discountPct)) / 100 : 0;
        const shippingAmt = Number(body.shippingAmt) || 0;
        const roundOff = Number(body.roundOff) || 0;
        const { subtotal, taxAmount, totalAmount } = calcVoucherTotals(computed, shippingAmt, overallDiscount, roundOff, 0);

        await prisma.$transaction(async (tx) => {
            await tx.invVoucherLine.deleteMany({ where: { voucherId: id } });
            await tx.invVoucher.update({
                where: { id },
                data: {
                    subtotal, taxAmount, totalAmount,
                    discountAmt: overallDiscount > 0 ? overallDiscount : null,
                    discountPct: body.discountPct != null ? Number(body.discountPct) : null,
                    shippingAmt, roundOff,
                    lines: {
                        create: computed.map((l) => ({
                            productId: l.productId, description: l.description || null,
                            quantity: l.quantity, rate: l.rate, mrpPaise: l.mrpPaise ?? null, savedSalePricePaise: l.savedSalePricePaise ?? null,
                            discountPct: 0, discountAmt: l.discountAmt, taxRate: l.taxRate ?? 0, taxAmount: l.taxAmount, amount: l.amount,
                        })),
                    },
                },
            });
        }, { timeout: 30_000, maxWait: 10_000 });

        return NextResponse.json({ id, subtotal, taxAmount, totalAmount });
    } catch (e) {
        return handleApiError(e, "Failed to edit order");
    }
}
