import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, userCanActOnVoucher } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { calcLineTotals, calcVoucherTotals } from "@/modules/inventory/lib/stock";
import { ORDER_STAGE } from "@/modules/order/lib/orderPipeline";
import { readPartyName } from "@/shared/lib/accountancy/partySnapshot";
import { readSettlement, buildSettlementJson } from "@/shared/lib/accountancy/settlement";
import { resolveServiceCharges, chargesNetTotal, type ServiceLineInput } from "@/shared/lib/accountancy/serviceCharges";
import { Prisma } from "@/generated/prisma/client";
import { cleanLineNote } from "@/shared/lib/print/lineDescription";

// GET  /api/orders/[source]/[id]      → order detail (lines) for the detail/edit view
// PATCH/api/orders/[source]/[id]      → edit the order's lines (G2): drop a damaged
//   line / change a quantity at Review, recompute totals (same math as creation).
//   Allowed only on order-type InvVouchers that are still PRE-CONFIRM (New / Under
//   Review) — once Confirmed the stock is reserved and the order is locked harder.
//   Gated by the kind's Cancel / edit tick: the POS table's row for a POS Order /
//   Estimate, the office Sales Order row for a Sales Order (userCanActOnVoucher).

const EDITABLE_STAGES: string[] = [ORDER_STAGE.NEW, ORDER_STAGE.UNDER_REVIEW];

export async function GET(_req: Request, { params }: { params: Promise<{ source: string; id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;
    const { source, id: idStr } = await params;
    const id = Number(idStr);
    if (source !== "inv" || !Number.isInteger(id)) return NextResponse.json({ error: "Unsupported order ref" }, { status: 400 });
    try {
        const v = await prisma.voucherDetail.findUnique({
            where: { id },
            select: {
                id: true, partyJson: true,
                universalVoucher: { select: { partyAccountId: true, voucherNo: true, type: true, links: { where: { kind: "ORDER_STATUS" }, select: { targetId: true } } } },   // 5D-4 party + 5D-6 ref + 5D-11 type
                subtotal: true, taxAmount: true, discountAmt: true, discountPct: true, totalAmount: true,
                universalVoucherId: true, settlementJson: true,
            },
        });
        if (!v || (v.universalVoucher?.type !== "POS_ORDER" && v.universalVoucher?.type !== "SALES_ORDER" && v.universalVoucher?.type !== "POS_ESTIMATE")) return NextResponse.json({ error: "Order not found" }, { status: 404 });
        // Phase 5 5C: goods lines hang off the spine.
        const lines = await prisma.voucherInventoryLine.findMany({
            where:   { universalVoucherId: v.universalVoucherId ?? -1 },
            select:  { id: true, productId: true, description: true, note: true, quantity: true, rate: true, taxRate: true, mrpPaise: true, savedSalePricePaise: true, amount: true, product: { select: { sku: true, name: true, stock: true, reserved: true } } },
        });

        // Customer delivery address for the Review popup's "address deliverable?" flag.
        // Resolve from the order's ledger account → Person / Company.
        const partyAccountId = v.universalVoucher?.partyAccountId ?? null;
        let address: string | null = null;
        if (partyAccountId) {
            const acct = await prisma.account.findUnique({
                where: { id: partyAccountId },
                select: { person: { select: { address: true } }, company: { select: { address: true } } },
            });
            address = acct?.person?.address ?? acct?.company?.address ?? null;
        }

        const orderStatusId = v.universalVoucher?.links[0]?.targetId ?? null;
        return NextResponse.json({
            id: v.id, ref: v.universalVoucher?.voucherNo ?? "", customer: readPartyName(v.partyJson), statusId: orderStatusId, accountId: partyAccountId,
            address,
            // Estimates are GL-silent quotes → always editable; orders only at New / Under-Review.
            editable: v.universalVoucher?.type === "POS_ESTIMATE" ? true : (orderStatusId != null && EDITABLE_STAGES.includes(orderStatusId)),
            subtotal: toNumber(v.subtotal), taxAmount: toNumber(v.taxAmount), discountAmt: v.discountAmt != null ? toNumber(v.discountAmt) : 0, discountPct: v.discountPct != null ? toNumber(v.discountPct) : null, totalAmount: toNumber(v.totalAmount),
            // Service rows, re-shaped as the cart carries them. Stored as charges
            // (a quote posts no GL), so they come out of settlementJson.
            services: readSettlement(v.settlementJson).charges
                .filter((c) => c.serviceId != null)
                .map((c) => ({
                    serviceId: c.serviceId as number,
                    name:      c.serviceName ?? "Service",
                    quantity:  Number(c.quantity ?? 1),
                    rate:      Number(c.rate ?? c.amount),
                    taxRate:   Number(c.taxRate ?? 0),
                    description: c.note ?? null,
                })),
            lines: lines.map((l) => {
                const qty = toNumber(l.quantity);
                // Untracked products (stock = null) are always deliverable; tracked ones
                // are deliverable when available-to-sell (stock − reserved) covers the line.
                const available = l.product.stock == null ? null : toNumber(l.product.stock) - l.product.reserved;
                return {
                    id: l.id, productId: l.productId, sku: l.product.sku, name: l.product.name, description: l.description, note: l.note,
                    quantity: qty, rate: toNumber(l.rate), taxRate: toNumber(l.taxRate),
                    mrpPaise: l.mrpPaise, savedSalePricePaise: l.savedSalePricePaise, amount: toNumber(l.amount),
                    available, deliverable: available == null ? true : available >= qty,
                };
            }),
        });
    } catch (e) {
        return handleApiError(e, "Failed to load order");
    }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ source: string; id: string }> }) {
    const { response, user } = await requireAuth();
    if (response) return response;
    const { source, id: idStr } = await params;
    const id = Number(idStr);
    if (source !== "inv" || !Number.isInteger(id)) return NextResponse.json({ error: "Unsupported order ref" }, { status: 400 });

    try {
        const body = (await req.json()) as {
            lines: { productId: number; description?: string | null; note?: string | null; quantity: number; rate: number; taxRate?: number; mrpPaise?: number | null; savedSalePricePaise?: number | null }[];
            services?: ServiceLineInput[];
            discountAmt?: number | null; discountPct?: number | null; shippingAmt?: number | null; roundOff?: number | null;
        };
        const lines = Array.isArray(body.lines) ? body.lines : [];
        const services = Array.isArray(body.services) ? body.services : [];
        if (lines.length === 0 && services.length === 0) return NextResponse.json({ error: "An order needs at least one line." }, { status: 400 });
        for (const l of lines) {
            if (!l.productId || !(l.quantity > 0)) return NextResponse.json({ error: "Each line needs a product and quantity > 0." }, { status: 400 });
        }
        for (const s of services) {
            if (!s.serviceId || !(s.quantity > 0)) return NextResponse.json({ error: "Each service line needs a service and quantity > 0." }, { status: 400 });
        }
        // Ledger + GST re-resolved from the catalogue on every save.
        const resolvedServices = await resolveServiceCharges(prisma, services);
        if (!resolvedServices.ok) return NextResponse.json({ error: resolvedServices.error, code: resolvedServices.code }, { status: 422 });
        const serviceCharges = resolvedServices.charges;

        const order = await prisma.voucherDetail.findUnique({ where: { id }, select: { universalVoucher: { select: { type: true, links: { where: { kind: "ORDER_STATUS" }, select: { targetId: true } } } } } });   // 5D-11
        if (!order || (order.universalVoucher?.type !== "POS_ORDER" && order.universalVoucher?.type !== "SALES_ORDER" && order.universalVoucher?.type !== "POS_ESTIMATE")) return NextResponse.json({ error: "Order not found" }, { status: 404 });
        if (!userCanActOnVoucher(user, order.universalVoucher?.type ?? "", "cancel")) {
            return NextResponse.json({ error: "You do not have permission to edit this voucher kind." }, { status: 403 });
        }
        const patchOrderStatusId = order.universalVoucher?.links[0]?.targetId ?? null;
        // Estimates are GL-silent quotes → always editable. Orders only at New / Under-Review.
        if (order.universalVoucher?.type !== "POS_ESTIMATE" && (!patchOrderStatusId || !EDITABLE_STAGES.includes(patchOrderStatusId))) {
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
        // Services count at GROSS, the same as on creation, so an edited quote
        // still totals what the customer was quoted.
        const { subtotal, taxAmount, totalAmount } = calcVoucherTotals(computed, shippingAmt, overallDiscount, roundOff, chargesNetTotal(serviceCharges));

        await prisma.$transaction(async (tx) => {
            // Phase 5 5C: goods lines hang off the spine.
            const inv = await tx.voucherDetail.findUnique({ where: { id }, select: { universalVoucherId: true, settlementJson: true } });
            // Keep whatever tenders the row already carries — this edit is about
            // the lines, and rewriting the column must not drop money rows.
            const keptTenders = readSettlement(inv?.settlementJson).tenders;
            const spineId = inv?.universalVoucherId ?? -1;
            await tx.voucherInventoryLine.deleteMany({ where: { universalVoucherId: spineId } });
            await tx.voucherDetail.update({
                where: { id },
                data: {
                    subtotal, taxAmount, totalAmount,
                    discountAmt: overallDiscount > 0 ? overallDiscount : null,
                    discountPct: body.discountPct != null ? Number(body.discountPct) : null,
                    shippingAmt, roundOff,
                    // The service rows are rewritten wholesale — the screen sends
                    // every one it is showing, so an emptied list must clear the
                    // stored rows too — while the tenders above are carried over.
                    settlementJson: serviceCharges.length > 0 || keptTenders.length > 0
                        ? (buildSettlementJson(keptTenders, serviceCharges) as Prisma.InputJsonValue)
                        : Prisma.DbNull,
                },
            });
            if (computed.length > 0) await tx.voucherInventoryLine.createMany({
                data: computed.map((l) => ({
                    universalVoucherId: spineId,
                    productId: l.productId, description: l.description || null, note: cleanLineNote(l.note),
                    quantity: l.quantity, rate: l.rate, mrpPaise: l.mrpPaise ?? null, savedSalePricePaise: l.savedSalePricePaise ?? null,
                    discountPct: 0, discountAmt: l.discountAmt, taxRate: l.taxRate ?? 0, taxAmount: l.taxAmount, amount: l.amount,
                })),
            });
        }, { timeout: 30_000, maxWait: 10_000 });

        return NextResponse.json({ id, subtotal, taxAmount, totalAmount });
    } catch (e) {
        return handleApiError(e, "Failed to edit order");
    }
}
