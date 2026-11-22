import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { getDealsPipeline } from "@/modules/deals/lib/dealsPipeline";
import { sourceCounterId } from "@/shared/lib/counter/sourceCounter";
import { loadShopStockPolicy } from "@/shared/lib/shop/stockPolicy";
import { resolveAvailability } from "@/modules/ecommerce/lib/shopStock";

// POST /api/shop/interest { productId } — "Show interest" on an out-of-stock
// product the shop cannot sell (owner, 2026-11-22). A signed-in customer only (an
// OTP-verified number, so every deal is a real lead). Creates a Deal in the first
// stage of the Deals pipeline, linked to the customer; the same customer's open
// interest deal for the same product is reused, never doubled.

const INTEREST_SOURCE = "Shop — out of stock";
const schema = z.object({ productId: z.coerce.number().int().positive() });
/** One customer may open at most this many interest deals in any 24 hours. */
const DAILY_LIMIT = 10;
/** pg_advisory_xact_lock namespace for interest deals (4711 = bill links). */
const INTEREST_LOCK = 4712;

export async function POST(req: Request) {
    const auth = await requirePortalCustomer();
    if (auth.response) return auth.response;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    try {
        const [product, person, pipeline, policy] = await Promise.all([
            prisma.invProduct.findUnique({
                where: { id: data.productId },
                select: { id: true, sku: true, name: true, shopSubheading: true, stock: true, allowBackorder: true, reserved: true },
            }),
            prisma.person.findUnique({ where: { id: auth.customerId }, select: { id: true, name: true } }),
            getDealsPipeline(prisma),
            loadShopStockPolicy(),
        ]);
        if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
        // Only a product the shop cannot sell (owner, 2026-11-22) — the same rule the
        // product page uses; an in-stock or backorder product is simply added to the cart.
        if (resolveAvailability(product.stock, product.allowBackorder, policy, product.reserved).orderable) {
            return NextResponse.json({ error: "This product is in stock — add it to your cart" }, { status: 409 });
        }
        if (!person) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
        if (!pipeline) return NextResponse.json({ error: "Deals are not set up" }, { status: 503 });
        const entry = pipeline.statuses.find((s) => s.isEntryPoint) ?? pipeline.statuses[0];
        if (!entry) return NextResponse.json({ error: "Deals are not set up" }, { status: 503 });

        // The SKU ends the title and never changes; the name can be corrected later, so
        // a repeat is matched on the SKU — a renamed product must not open a second deal.
        const skuTag = `(SKU ${product.sku})`;
        const title = `Interest: ${product.shopSubheading || product.name} ${skuTag}`;
        const mine = { deal: { personId: person.id, source: INTEREST_SOURCE } };
        const counterId = await sourceCounterId();
        // Check and create under one lock per customer, so two taps at once (two tabs,
        // card + product page) cannot both pass the "already open?" check.
        const outcome = await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${INTEREST_LOCK}, ${person.id})`;
            const open = await tx.ticket.findFirst({ where: { ...mine, title: { endsWith: skuTag }, closedAt: null }, select: { id: true } });
            if (open) return "again" as const;
            const recent = await tx.ticket.count({ where: { ...mine, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
            if (recent >= DAILY_LIMIT) return "limit" as const;
            await tx.ticket.create({
                data: {
                    sourceCounterId: counterId,
                    pipelineId: pipeline.id,
                    status: entry.id,
                    title,
                    priority: "MEDIUM",
                    notes: `Customer asked to be told when SKU ${product.sku} is back in stock (shop "Show interest").`,
                    deal: { create: { contactName: person.name, personId: person.id, source: INTEREST_SOURCE } },
                },
            });
            return "created" as const;
        });
        if (outcome === "again") return NextResponse.json({ ok: true, again: true });
        if (outcome === "limit") return NextResponse.json({ error: "Too many requests today — we will be in touch" }, { status: 429 });
        return NextResponse.json({ ok: true, again: false }, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Could not save your interest");
    }
}
