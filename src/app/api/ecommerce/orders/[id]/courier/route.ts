import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { quoteShipping } from "@/modules/delivery/lib/shippingQuote";
import { loadDeliveryMethod, type ShiprocketConfig } from "@/modules/delivery/lib/deliveryMethods";
import { chargeableUnitGrams } from "@/modules/delivery/lib/chargeableWeight";
import { ORDER_STAGE } from "@/modules/order/lib/orderPipeline";

// Staff-side "change courier for special cause" on a shop order — allowed only
// BEFORE auto-booking fires (order still at New / Under Review / Confirmed and
// the P8 delivery has no AWB). The customer's paid shipping charge is NEVER
// touched — switching courier is our cost decision, not a re-bill.
//
// GET  → re-quote the live courier options for the order's address + parcel.
// POST → { optionId } from that quote; updates the order's courier snapshot
//        (TicketOrder.courier + shippingAddress.courier* fields) and the spawned
//        delivery's carrier, so the Packing auto-book uses the new pick.

const DEFAULT_ITEM_WEIGHT_GRAMS = 500;

const COURIER_CHANGEABLE_STAGES: string[] = [
    ORDER_STAGE.NEW,
    ORDER_STAGE.UNDER_REVIEW,
    ORDER_STAGE.CONFIRMED,
];

type ShipAddress = {
    pincode?: string;
    state?: string;
    neighbourhood?: string | null;
    [k: string]: unknown;
};

async function loadOrderForQuote(oid: number) {
    const t = await prisma.ticket.findUnique({
        where: { id: oid },
        select: {
            id: true,
            status: true,
            order: {
                select: {
                    courier: true,
                    paymentMethod: true,
                    totalPaise: true,
                    shippingChargePaise: true,
                    shippingAddress: true,
                    lines: {
                        select: {
                            quantity: true,
                            product: { select: { weightGrams: true } },
                        },
                    },
                },
            },
        },
    });
    if (!t?.order) return null;
    return t;
}

async function quoteForOrder(order: NonNullable<Awaited<ReturnType<typeof loadOrderForQuote>>>["order"]) {
    const addr = (order!.shippingAddress ?? {}) as ShipAddress;
    if (!addr.pincode) return null;
    const srMethod = await loadDeliveryMethod("SHIPROCKET");
    const fallbackWeight =
        Number((srMethod?.configJson as ShiprocketConfig | undefined)?.defaultItemWeightGrams) ||
        DEFAULT_ITEM_WEIGHT_GRAMS;
    const weightGrams = order!.lines.reduce(
        (g, l) => g + chargeableUnitGrams(l.product, fallbackWeight) * l.quantity,
        0,
    );
    const options = await quoteShipping({
        deliveryPincode: String(addr.pincode),
        deliveryState: typeof addr.state === "string" ? addr.state : undefined,
        deliveryNeighbourhood: typeof addr.neighbourhood === "string" ? addr.neighbourhood : undefined,
        subtotalPaise: order!.totalPaise,
        weightGrams,
        cod: order!.paymentMethod === "COD",
    });
    // Drop the dev-only hidden pool — staff pick from the same list customers see.
    return options.filter((o) => !o.hidden);
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requireModuleAccess("e-commerce");
    if (response) return response;
    const { id } = await ctx.params;
    const oid = parseInt(id, 10);
    if (!Number.isFinite(oid)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    try {
        const t = await loadOrderForQuote(oid);
        if (!t) return NextResponse.json({ error: "Order not found" }, { status: 404 });
        const options = await quoteForOrder(t.order);
        if (!options) {
            return NextResponse.json({ error: "The order has no delivery pincode to quote." }, { status: 422 });
        }
        const addr = (t.order!.shippingAddress ?? {}) as ShipAddress;
        return NextResponse.json({
            options,
            current: {
                courier: t.order!.courier,
                optionId: typeof addr.courierOptionId === "string" ? addr.courierOptionId : null,
                serviceName: typeof addr.courierService === "string" ? addr.courierService : null,
            },
            paidShippingPaise: t.order!.shippingChargePaise ?? 0,
        });
    } catch (e) {
        return handleApiError(e, "Failed to quote couriers");
    }
}

const changeSchema = z.object({ optionId: z.string().trim().min(1).max(80) });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requireModuleAccess("e-commerce");
    if (response) return response;
    const { id } = await ctx.params;
    const oid = parseInt(id, 10);
    if (!Number.isFinite(oid)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const { data, error } = await validateRequest(req, changeSchema);
    if (error) return error;

    try {
        const t = await loadOrderForQuote(oid);
        if (!t) return NextResponse.json({ error: "Order not found" }, { status: 404 });

        // Guard: only before the auto-book step — pre-Packing and no AWB yet.
        if (!COURIER_CHANGEABLE_STAGES.includes(t.status)) {
            return NextResponse.json(
                { error: "Courier can only be changed before packing starts." },
                { status: 422 },
            );
        }
        const delivery = await prisma.ticketDelivery.findFirst({
            where: { orderSource: "shop", orderId: oid },
            select: { ticketId: true, awb: true },
        });
        if (delivery?.awb) {
            return NextResponse.json(
                { error: "The courier is already booked (AWB assigned) — cannot change now." },
                { status: 422 },
            );
        }

        const options = await quoteForOrder(t.order);
        if (!options) {
            return NextResponse.json({ error: "The order has no delivery pincode to quote." }, { status: 422 });
        }
        const chosen = options.find((o) => o.optionId === data.optionId);
        if (!chosen) {
            return NextResponse.json(
                { error: "That courier option is no longer available — refresh and pick again." },
                { status: 422 },
            );
        }

        // Merge the new pick into the shippingAddress snapshot (same fields checkout
        // writes); shippingChargePaise stays what the customer paid.
        const addr = (t.order!.shippingAddress ?? {}) as Record<string, unknown>;
        const nextAddr = {
            ...addr,
            courierKind: chosen.kind,
            courierOptionId: chosen.optionId,
            courierService: chosen.serviceName ?? chosen.label,
            shiprocketCourierId: chosen.shiprocketCourierId ?? null,
            shiprocketCourierName: chosen.shiprocketCourierName ?? null,
        };
        await prisma.$transaction(async (tx) => {
            await tx.ticketOrder.update({
                where: { ticketId: oid },
                data: { courier: chosen.kind, shippingAddress: nextAddr },
            });
            if (delivery) {
                await tx.ticketDelivery.update({
                    where: { ticketId: delivery.ticketId },
                    data: { carrier: chosen.kind, addressJson: nextAddr },
                });
            }
        });

        return NextResponse.json({
            ok: true,
            courier: { kind: chosen.kind, label: chosen.serviceName ?? chosen.label },
        });
    } catch (e) {
        return handleApiError(e, "Failed to change the courier");
    }
}
