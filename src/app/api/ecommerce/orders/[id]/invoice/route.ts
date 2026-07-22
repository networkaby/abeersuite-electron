import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { resolveProductTax } from "@/modules/inventory/lib/gstResolver";
import { stateCodeForName } from "@/shared/lib/gst/indianStates";
import { syncVoucherLinks } from "@/modules/accountancy/lib/voucherLinks";
import { toNumber } from "@/modules/accountancy/lib/balance";

// POST /api/ecommerce/orders/[id]/invoice
//
// ONE-CLICK convert: shop order → posted ONLINE_INVOICE. The order already holds
// the party + lines, so no voucher form opens — this route builds the voucher the
// same way the office form would and reuses the EXISTING create + post routes
// (same pattern as /api/orders/[source]/[id]/fulfil, which does this for
// POS_ORDER/SALES_ORDER and left shop orders as "a follow-up" — this is it).
//
//   1. Per-line GST: shop prices are tax-INCLUSIVE — resolve each product's rate
//      (product → group → org default) and back out the pre-tax rate, floats
//      unrounded (the engine rounds at its boundary).
//   2. Create a DRAFT ONLINE_INVOICE under HQ (the online channel's branch) as a
//      CREDIT sale — the single tender row is the customer's AR.
//   3. Post it — GL (Sales + GST + AR) and the real stock OUT.
//   4. Flip the order's reservation hold to EXECUTED (the stock-out supersedes it),
//      link invoice ↔ order (VoucherLink SHOP_ORDER), and allocate the order's
//      advance RECEIPT (auto-posted at payment) so the customer's AR nets out.
//
// Idempotent: an existing non-cancelled linked invoice is returned as-is. The
// posted voucher is a NORMAL voucher afterwards — editable via the accountancy
// module like any other (no special lock).

const HQ_BRANCH_ID = "BR-HQ";

/** Live (non-cancelled) invoice already linked to this order, if any. */
async function findLinkedInvoice(orderId: number) {
    const links = await prisma.voucherLink.findMany({
        where: { kind: "SHOP_ORDER", targetId: String(orderId) },
        select: { universalVoucherId: true },
    });
    if (links.length === 0) return null;
    return prisma.universalVoucher.findFirst({
        where: {
            id: { in: links.map((l) => l.universalVoucherId) },
            status: { not: "CANCELLED" },
            deletedAt: null,
        },
        select: {
            id: true,
            voucherNo: true,
            status: true,
            type: true,
            voucherDetail: { select: { id: true, totalAmount: true } },
        },
    });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireModuleAccess("e-commerce");
    if (response) return response;
    const { id } = await ctx.params;
    const oid = parseInt(id, 10);
    if (!Number.isFinite(oid)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    try {
        // Idempotent: one live invoice per order.
        const existing = await findLinkedInvoice(oid);
        if (existing?.voucherDetail) {
            return NextResponse.json({
                already: true,
                invoiceId: existing.voucherDetail.id,
                reference: existing.voucherNo,
            });
        }

        const t = await prisma.ticket.findUnique({
            where: { id: oid },
            select: {
                accountId: true,
                account: { select: { personId: true, companyId: true, name: true } },
                order: {
                    select: {
                        totalPaise: true,
                        shippingChargePaise: true,
                        shippingName: true,
                        shippingAddress: true,
                        lines: { select: { productId: true, quantity: true, unitPricePaise: true } },
                    },
                },
            },
        });
        if (!t?.order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
        if (t.order.lines.length === 0) {
            return NextResponse.json({ error: "Order has no lines to invoice." }, { status: 400 });
        }
        if (!t.accountId) {
            return NextResponse.json(
                { error: "This order has no customer account to invoice — attach a customer first." },
                { status: 400 },
            );
        }

        // 1. Per-line GST back-out: storefront prices are tax-inclusive.
        const lines: { productId: number; quantity: number; rate: number; taxRate: number }[] = [];
        for (const l of t.order.lines) {
            const tax = await resolveProductTax(l.productId);
            const taxable = tax.taxability == null || tax.taxability === "TAXABLE";
            const r = taxable ? (tax.gstRate ?? 0) : 0;
            const inclUnit = l.unitPricePaise / 100;
            lines.push({
                productId: l.productId,
                quantity: l.quantity,
                rate: r > 0 ? inclUnit / (1 + r / 100) : inclUnit, // unrounded pre-engine
                taxRate: r,
            });
        }
        const goodsIncl = t.order.lines.reduce((s, l) => s + (l.unitPricePaise * l.quantity) / 100, 0);
        const shipping = (t.order.shippingChargePaise ?? 0) / 100;
        const total = goodsIncl + shipping;

        const addr = (t.order.shippingAddress ?? {}) as Record<string, unknown>;
        const partyType = t.account?.personId ? "customer" : t.account?.companyId ? "company" : undefined;
        const partyId = t.account?.personId ?? t.account?.companyId ?? undefined;
        const partyAddress = [addr.line1, addr.line2, addr.city, addr.state, addr.pincode]
            .filter((x) => typeof x === "string" && x.trim())
            .join(", ");
        const placeOfSupply = stateCodeForName(typeof addr.state === "string" ? addr.state : null) ?? undefined;

        const today = new Date().toISOString().slice(0, 10);
        const cookie = req.headers.get("cookie") ?? "";

        // 2. Create the DRAFT ONLINE_INVOICE via the existing trading-voucher route
        //    (party snapshot, GST routing, voucher series — all reused, not rebuilt).
        const createRes = await fetch(new URL("/api/inventory/vouchers", req.url), {
            method: "POST",
            headers: { "content-type": "application/json", cookie },
            body: JSON.stringify({
                type: "ONLINE_INVOICE",
                date: today,
                description: `Online sale — Order #${oid}`,
                branchId: HQ_BRANCH_ID,
                partyName: t.order.shippingName || t.account?.name || "Customer",
                partyType,
                partyId,
                partyPhone: typeof addr.phone === "string" ? addr.phone : undefined,
                partyAddress: partyAddress || undefined,
                shippingAmt: shipping,
                deliveryMode: "SHIPPED",
                placeOfSupply,
                lines,
                // CREDIT sale: the whole total is the customer-AR tender row; the
                // advance receipt (online payment) allocates against it below.
                tenders: [{ accountId: t.accountId, amount: total }],
            }),
        });
        if (!createRes.ok) {
            const e = (await createRes.json().catch(() => ({}))) as { error?: string };
            return NextResponse.json({ error: e.error || "Could not create the invoice" }, { status: 422 });
        }
        const draft = (await createRes.json()) as { id: number; universalVoucherId: number | null };

        // 3. Post it — GL + real stock OUT (existing post flow, untouched).
        const postRes = await fetch(new URL(`/api/inventory/vouchers/${draft.id}/post`, req.url), {
            method: "POST",
            headers: { "content-type": "application/json", cookie },
        });
        if (!postRes.ok) {
            const e = (await postRes.json().catch(() => ({}))) as { error?: string };
            return NextResponse.json(
                { error: e.error || "Invoice created but posting failed", invoiceId: draft.id },
                { status: 422 },
            );
        }

        const spineId = draft.universalVoucherId;
        const spine = spineId
            ? await prisma.universalVoucher.findUnique({ where: { id: spineId }, select: { voucherNo: true } })
            : null;

        // 4. Reservation → EXECUTED, link invoice ↔ order, allocate the advance receipt.
        const receiptVoucherId = Number(addr.receiptVoucherId) || null;
        let allocated = false;
        await prisma.$transaction(async (tx) => {
            const held = await tx.stockReservation.findMany({
                where: { orderSource: "shop", orderId: oid, status: "HELD" },
                select: { productId: true, quantity: true },
            });
            for (const r of held) {
                await tx.invProduct.update({
                    where: { id: r.productId },
                    data: { reserved: { decrement: r.quantity } },
                });
            }
            if (held.length > 0) {
                await tx.stockReservation.updateMany({
                    where: { orderSource: "shop", orderId: oid, status: "HELD" },
                    data: { status: "EXECUTED" },
                });
            }

            if (spineId) await syncVoucherLinks(tx, spineId, { shopOrderId: oid });

            // Allocate the order's advance receipt onto this invoice, unless the
            // receipt is already allocated to a live target (re-raise safety).
            if (spineId && receiptVoucherId) {
                const priorAllocs = await tx.voucherAllocation.findMany({
                    where: { sourceType: "VOUCHER", sourceId: receiptVoucherId, targetType: "UNIVERSAL_VOUCHER" },
                    select: { targetId: true },
                });
                const liveTarget = priorAllocs.length
                    ? await tx.universalVoucher.findFirst({
                          where: { id: { in: priorAllocs.map((a) => a.targetId) }, status: { not: "CANCELLED" }, deletedAt: null },
                          select: { id: true },
                      })
                    : null;
                if (!liveTarget) {
                    const receipt = await tx.voucherDetail.findUnique({
                        where: { id: receiptVoucherId },
                        select: { totalAmount: true, universalVoucher: { select: { voucherNo: true } } },
                    });
                    if (receipt) {
                        const amount = Math.min(toNumber(receipt.totalAmount), total);
                        if (amount > 0.005) {
                            await tx.voucherAllocation.create({
                                data: {
                                    targetType: "UNIVERSAL_VOUCHER",
                                    targetId: spineId,
                                    sourceType: "VOUCHER",
                                    sourceId: receiptVoucherId,
                                    amount,
                                    method: "AGAINST_REF",
                                    reference: receipt.universalVoucher?.voucherNo ?? `RCPT-${receiptVoucherId}`,
                                    createdById: user!.id,
                                },
                            });
                            allocated = true;
                        }
                    }
                }
            }
        }, { timeout: 30_000, maxWait: 10_000 });

        return NextResponse.json({
            invoiceId: draft.id,
            reference: spine?.voucherNo ?? null,
            allocated,
        });
    } catch (e) {
        return handleApiError(e, "Failed to create the invoice");
    }
}
