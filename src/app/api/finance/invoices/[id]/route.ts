import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { z } from "zod";
import { postInvoiceJe } from "../route";

const updateSchema = z.object({
    notes: z.string().trim().optional().nullable(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    // Sending (DRAFT → SENT) auto-posts the JE
    status: z.enum(["SENT"]).optional(),
});

// GET /api/finance/invoices/[id]
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("accountancy:view:org");
    if (response) return response;

    const { id } = await params;
    const invoice = await prisma.invoice.findUnique({
        where: { id: Number(id) },
        include: {
            createdBy: { select: { id: true, name: true } },
            account: {
                select: {
                    id: true,
                    name: true,
                    person: {
                        select: {
                            id: true,
                            name: true,
                            phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1 },
                        },
                    },
                    company: { select: { id: true, name: true } },
                },
            },
            shopOrder: { select: { id: true, orderSource: true, totalPaise: true } },
            lines: { orderBy: { id: "asc" } },
            payments: {
                orderBy: { date: "desc" },
                include: { createdBy: { select: { id: true, name: true } } },
            },
        },
    });
    if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(invoice);
}

// PATCH /api/finance/invoices/[id]
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission("accountancy:view:org");
    if (response) return response;

    const { id } = await params;
    const existing = await prisma.invoice.findUnique({ where: { id: Number(id) } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.status === "VOID") {
        return NextResponse.json({ error: "Cannot update a voided invoice" }, { status: 409 });
    }

    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }
    const body = parsed.data;

    try {
        const updated = await prisma.$transaction(async (tx) => {
            // DRAFT → SENT: auto-post JE
            if (body.status === "SENT" && existing.status === "DRAFT") {
                await postInvoiceJe(
                    tx,
                    existing.id,
                    existing.number,
                    Number(existing.subtotal),
                    Number(existing.taxAmount),
                    Number(existing.totalAmount),
                    user!.id,
                );
            }

            return tx.invoice.update({
                where: { id: Number(id) },
                data: {
                    ...(body.status ? { status: body.status } : {}),
                    ...(body.dueDate ? { dueDate: new Date(body.dueDate) } : {}),
                    ...(body.notes !== undefined ? { notes: body.notes } : {}),
                },
                include: {
                    lines: true,
                    payments: true,
                },
            });
        });
        return NextResponse.json(updated);
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to update invoice" }, { status: 500 });
    }
}
