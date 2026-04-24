import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { z } from "zod";
import { nextRef, balanceDelta } from "@/lib/finance/balance";

const lineSchema = z.object({
    description: z.string().trim().min(1),
    quantity: z.number().positive(),
    unitPrice: z.number().min(0),
    taxRate: z.number().min(0).max(100).default(0),
});

const createSchema = z.object({
    partyName: z.string().trim().min(1),
    partyType: z.enum(["customer", "company"]),
    partyId: z.number().int().positive(),
    issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    notes: z.string().trim().optional(),
    lines: z.array(lineSchema).min(1, "At least one line item required"),
    // If status is SENT, auto-post the AR/Revenue journal entry
    status: z.enum(["DRAFT", "SENT"]).default("DRAFT"),
});

// GET /api/finance/invoices
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const partyType = searchParams.get("partyType");
    const partyId = searchParams.get("partyId");

    try {
        const invoices = await prisma.invoice.findMany({
            where: {
                ...(status ? { status: status as "DRAFT" | "SENT" | "PARTIAL" | "PAID" | "VOID" } : {}),
                ...(partyType ? { partyType } : {}),
                ...(partyId ? { partyId: Number(partyId) } : {}),
            },
            orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
            include: {
                createdBy: { select: { id: true, name: true } },
                _count: { select: { lines: true, payments: true } },
            },
        });
        return NextResponse.json(invoices);
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to fetch invoices" }, { status: 500 });
    }
}

// POST /api/finance/invoices
export async function POST(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }
    const body = parsed.data;

    // Compute totals
    const computedLines = body.lines.map((l) => {
        const lineSubtotal = l.quantity * l.unitPrice;
        const taxAmount = Math.round(lineSubtotal * (l.taxRate / 100) * 100) / 100;
        return { ...l, taxAmount, amount: lineSubtotal + taxAmount };
    });
    const subtotal = computedLines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    const taxAmount = computedLines.reduce((s, l) => s + l.taxAmount, 0);
    const totalAmount = subtotal + taxAmount;

    try {
        const invoice = await prisma.$transaction(async (tx) => {
            const number = await nextRef(tx, "invoice", "INV");

            const inv = await tx.invoice.create({
                data: {
                    number,
                    status: body.status,
                    issueDate: new Date(body.issueDate),
                    dueDate: new Date(body.dueDate),
                    notes: body.notes ?? null,
                    partyName: body.partyName,
                    partyType: body.partyType,
                    partyId: body.partyId,
                    subtotal,
                    taxAmount,
                    totalAmount,
                    amountPaid: 0,
                    amountDue: totalAmount,
                    createdById: user!.id,
                    lines: {
                        create: computedLines.map((l) => ({
                            description: l.description,
                            quantity: l.quantity,
                            unitPrice: l.unitPrice,
                            taxRate: l.taxRate,
                            taxAmount: l.taxAmount,
                            amount: l.amount,
                        })),
                    },
                },
                include: { lines: true },
            });

            // Auto-post AR/Revenue JE if status is SENT
            if (body.status === "SENT") {
                await postInvoiceJe(tx, inv.id, number, subtotal, taxAmount, totalAmount, user!.id);
            }

            return inv;
        });

        return NextResponse.json(invoice, { status: 201 });
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to create invoice" }, { status: 500 });
    }
}

/** Post the accounts-receivable / revenue journal entry for an invoice. */
export async function postInvoiceJe(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
    invoiceId: number,
    invoiceNumber: string,
    subtotal: number,
    taxAmount: number,
    totalAmount: number,
    userId: number,
) {
    const [ar, revenue, taxPayable] = await Promise.all([
        tx.glAccount.findFirst({ where: { code: "1100" } }),
        tx.glAccount.findFirst({ where: { code: "4000" } }),
        taxAmount > 0 ? tx.glAccount.findFirst({ where: { code: "2100" } }) : Promise.resolve(null),
    ]);

    if (!ar || !revenue) {
        throw new Error("Required GL accounts not found (1100 AR, 4000 Revenue). Run the finance seed first.");
    }

    const jeRef = await nextRef(tx, "journalEntry", "JE");
    const lines = [
        { glAccountId: ar.id, type: "DEBIT",  amount: totalAmount, description: `Invoice ${invoiceNumber}` },
        { glAccountId: revenue.id, type: "CREDIT", amount: subtotal, description: `Invoice ${invoiceNumber}` },
    ];
    if (taxAmount > 0 && taxPayable) {
        lines.push({ glAccountId: taxPayable.id, type: "CREDIT", amount: taxAmount, description: `Tax on ${invoiceNumber}` });
    }

    const je = await tx.journalEntry.create({
        data: {
            date: new Date(),
            reference: jeRef,
            description: `Invoice ${invoiceNumber}`,
            status: "POSTED",
            postedAt: new Date(),
            createdById: userId,
            lines: { create: lines },
        },
    });

    // Update GL balances
    for (const line of lines) {
        const acct = lines === lines ? await tx.glAccount.findUnique({ where: { id: line.glAccountId } }) : null;
        if (!acct) continue;
        const delta = balanceDelta(acct.normalBalance, line.type as "DEBIT" | "CREDIT", line.amount);
        await tx.glAccount.update({ where: { id: line.glAccountId }, data: { balance: { increment: delta } } });
    }

    // Link invoice to je via a note (loose — we don't store the je id on invoice to keep isolation)
    return je;
}
