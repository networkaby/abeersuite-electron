import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";
import { resolvedUserFromSession } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { buildActorSnapshot, type ActorSnapshot } from "@/shared/lib/auth/actorSnapshot";

// Ongoing "draft bill" for a repair ticket — the pick-list the technician builds
// while the job runs. Two kinds of lines:
//   • products — real stock items (become POS cart lines)
//   • services — PosService catalogue entries (Settings → Services); they
//     become kind="service" cart lines in POS with their configured GST +
//     income ledger, exactly like the cashier's "+ Add service charge".
// Stored as a snapshot on Ticket.context.billDraft. NO stock/ledger impact — the
// real invoice is generated later via POS (Generate Bill preloads this).
const productSchema = z.object({
    productId: z.coerce.number().int().positive(),
    sku: z.string().trim().default(""),
    name: z.string().trim().default(""),
    qty: z.coerce.number().positive().default(1),
    salePrice: z.coerce.number().nullable().default(null), // indicative ₹, display only
});

const serviceSchema = z.object({
    serviceId: z.coerce.number().int().positive(),
    name: z.string().trim().default(""),
    qty: z.coerce.number().positive().default(1),
    // Tax-INCLUSIVE ₹ (same convention as PosService.defaultPricePaise);
    // null = use the catalogue default at billing time.
    price: z.coerce.number().nullable().default(null),
    note: z.string().trim().default(""),
});

const bodySchema = z.object({
    products: z.array(productSchema).default([]),
    services: z.array(serviceSchema).default([]),
});

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const resolvedUser = resolvedUserFromSession(session);

        const { id } = await params;
        const ticketId = Number(id);
        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            select: { id: true, context: true },
        });
        if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });

        const { data, error } = await validateRequest(req, bodySchema);
        if (error) return error;

        const author = await buildActorSnapshot(resolvedUser.id);
        const updatedBy = (author as unknown as ActorSnapshot).userName ?? null;

        const billDraft = {
            products: data.products,
            services: data.services,
            updatedAt: new Date().toISOString(),
            updatedBy,
        };

        const prevContext =
            ticket.context && typeof ticket.context === "object" && !Array.isArray(ticket.context)
                ? (ticket.context as Record<string, unknown>)
                : {};

        await prisma.ticket.update({
            where: { id: ticketId },
            data: { context: { ...prevContext, billDraft } },
        });

        return NextResponse.json({ ok: true, billDraft });
    } catch (e) {
        return handleApiError(e, "Failed to save bill draft");
    }
}
