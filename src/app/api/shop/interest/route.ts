import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { getDealsPipeline } from "@/modules/deals/lib/dealsPipeline";
import { sourceCounterId } from "@/shared/lib/counter/sourceCounter";

// POST /api/shop/interest { productId } — "Show interest" on an out-of-stock
// product the shop cannot sell (owner, 2026-11-22). A signed-in customer only (an
// OTP-verified number, so every deal is a real lead). Creates a Deal in the first
// stage of the Deals pipeline, linked to the customer; the same customer's open
// interest deal for the same product is reused, never doubled.

const INTEREST_SOURCE = "Shop — out of stock";
const schema = z.object({ productId: z.coerce.number().int().positive() });
/** One customer may open at most this many interest deals a day. */
const DAILY_LIMIT = 10;

export async function POST(req: Request) {
    const auth = await requirePortalCustomer();
    if (auth.response) return auth.response;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    try {
        const [product, person, pipeline] = await Promise.all([
            prisma.invProduct.findUnique({ where: { id: data.productId }, select: { id: true, sku: true, name: true, shopSubheading: true } }),
            prisma.person.findUnique({ where: { id: auth.customerId }, select: { id: true, name: true } }),
            getDealsPipeline(prisma),
        ]);
        if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
        if (!person) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
        if (!pipeline) return NextResponse.json({ error: "Deals are not set up" }, { status: 503 });
        const entry = pipeline.statuses.find((s) => s.isEntryPoint) ?? pipeline.statuses[0];
        if (!entry) return NextResponse.json({ error: "Deals are not set up" }, { status: 503 });

        const title = `Interest: ${product.shopSubheading || product.name} (SKU ${product.sku})`;
        const mine = { deal: { personId: person.id, source: INTEREST_SOURCE } };
        const open = await prisma.ticket.findFirst({ where: { ...mine, title, closedAt: null }, select: { id: true } });
        if (open) return NextResponse.json({ ok: true, again: true });
        const today = await prisma.ticket.count({ where: { ...mine, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
        if (today >= DAILY_LIMIT) return NextResponse.json({ error: "Too many requests today — we will be in touch" }, { status: 429 });

        await prisma.ticket.create({
            data: {
                sourceCounterId: await sourceCounterId(),
                pipelineId: pipeline.id,
                status: entry.id,
                title,
                priority: "MEDIUM",
                notes: `Customer asked to be told when SKU ${product.sku} is back in stock (shop "Show interest").`,
                deal: { create: { contactName: person.name, personId: person.id, source: INTEREST_SOURCE } },
            },
        });
        return NextResponse.json({ ok: true, again: false }, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Could not save your interest");
    }
}
