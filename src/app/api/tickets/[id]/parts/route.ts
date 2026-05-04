import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { z } from "zod";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
    const { response } = await requireAuth();
    if (response) return response;
    const ticketId = Number((await params).id);
    if (!Number.isFinite(ticketId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    try {
        const parts = await prisma.ticketPart.findMany({
            where: { ticketId },
            include: {
                product: {
                    select: {
                        id: true, sku: true, name: true,
                        unit: { select: { code: true } },
                        brand: { select: { name: true } },
                    },
                },
            },
            orderBy: { createdAt: "asc" },
        });
        return NextResponse.json(parts);
    } catch {
        return NextResponse.json({ error: "Failed to load parts" }, { status: 500 });
    }
}

const addSchema = z.object({
    invProductId: z.number().int().positive(),
    quantity: z.number().positive().default(1),
    notes: z.string().trim().max(500).optional().nullable(),
});

export async function POST(req: Request, { params }: Ctx) {
    const { response } = await requireAuth();
    if (response) return response;
    const ticketId = Number((await params).id);
    if (!Number.isFinite(ticketId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const parsed = addSchema.safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }
    const { invProductId, quantity, notes } = parsed.data;
    try {
        const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { id: true } });
        if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
        const part = await prisma.ticketPart.create({
            data: { ticketId, invProductId, quantity, notes: notes ?? null },
            include: {
                product: {
                    select: {
                        id: true, sku: true, name: true,
                        unit: { select: { code: true } },
                        brand: { select: { name: true } },
                    },
                },
            },
        });
        return NextResponse.json(part, { status: 201 });
    } catch (e: unknown) {
        const code = typeof e === "object" && e !== null && "code" in e ? (e as { code: string }).code : "";
        if (code === "P2003") return NextResponse.json({ error: "Product not found" }, { status: 400 });
        return NextResponse.json({ error: "Failed to add part" }, { status: 500 });
    }
}

export async function DELETE(req: Request, { params }: Ctx) {
    const { response } = await requireAuth();
    if (response) return response;
    const ticketId = Number((await params).id);
    if (!Number.isFinite(ticketId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const { searchParams } = new URL(req.url);
    const partId = Number(searchParams.get("partId"));
    if (!Number.isFinite(partId) || partId <= 0) {
        return NextResponse.json({ error: "partId required" }, { status: 400 });
    }
    try {
        const part = await prisma.ticketPart.findUnique({ where: { id: partId } });
        if (!part || part.ticketId !== ticketId) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        await prisma.ticketPart.delete({ where: { id: partId } });
        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Failed to delete part" }, { status: 500 });
    }
}
