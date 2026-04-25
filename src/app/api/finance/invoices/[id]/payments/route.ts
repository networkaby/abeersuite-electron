import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { z } from "zod";
import { nextRef, balanceDelta } from "@/lib/finance/balance";

const paymentSchema = z.object({
    amount: z.number().positive(),
    method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "CHEQUE", "MOBILE_PAYMENT", "OTHER"]),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reference: z.string().trim().optional(),
    notes: z.string().trim().optional(),
    // Which cash/bank account to debit (defaults to 1000 Cash)
    cashGlAccountCode: z.string().default("1000"),
});

// POST /api/finance/invoices/[id]/payments
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const parsed = paymentSchema.safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }
    const body = parsed.data;

    const invoice = await prisma.invoice.findUnique({ where: { id: Number(id) } });
    if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (invoice.status === "VOID") {
        return NextResponse.json({ error: "Cannot add payment to a voided invoice" }, { status: 409 });
    }
    if (invoice.status === "PAID") {
        return NextResponse.json({ error: "Invoice is already fully paid" }, { status: 409 });
    }

    const amountDue = Number(invoice.totalAmount) - Number(invoice.amountPaid);
    if (body.amount > amountDue + 0.005) {
        return NextResponse.json(
            { error: `Payment amount (${body.amount}) exceeds amount due (${amountDue.toFixed(2)})` },
            { status: 422 },
        );
    }

    try {
        const payment = await prisma.$transaction(async (tx) => {
            // Fetch accounts
            const [cashAcct, arAcct] = await Promise.all([
                tx.account.findFirst({ where: { code: body.cashGlAccountCode } }),
                tx.account.findFirst({ where: { code: "1100" } }),
            ]);
            if (!cashAcct || !arAcct) {
                throw new Error("Required accounts not found. Run the finance seed first.");
            }

            // Post JE: DR Cash / CR Accounts Receivable
            const jeRef = await nextRef(tx, "journalEntry", "JE");
            const jeLines = [
                { accountId: cashAcct.id, type: "DEBIT" as const,  amount: body.amount, description: `Payment for ${invoice.number}` },
                { accountId: arAcct.id,   type: "CREDIT" as const, amount: body.amount, description: `Payment for ${invoice.number}` },
            ];
            const je = await tx.journalEntry.create({
                data: {
                    date: new Date(body.date),
                    reference: jeRef,
                    description: `Payment received — Invoice ${invoice.number}`,
                    status: "POSTED",
                    postedAt: new Date(),
                    createdById: user!.id,
                    lines: { create: jeLines },
                },
            });

            // Update account balances
            for (const line of jeLines) {
                const acct = line.accountId === cashAcct.id ? cashAcct : arAcct;
                const delta = balanceDelta(acct.normalBalance!, line.type, line.amount);
                await tx.account.update({ where: { id: line.accountId }, data: { balance: { increment: delta } } });
            }

            // Create payment record
            const pmt = await tx.payment.create({
                data: {
                    invoiceId: Number(id),
                    amount: body.amount,
                    method: body.method,
                    reference: body.reference ?? null,
                    date: new Date(body.date),
                    notes: body.notes ?? null,
                    journalEntryId: je.id,
                    createdById: user!.id,
                },
            });

            // Update invoice amountPaid / status
            const newPaid = Number(invoice.amountPaid) + body.amount;
            const newDue = Number(invoice.totalAmount) - newPaid;
            const newStatus = newDue <= 0.005 ? "PAID" : "PARTIAL";

            await tx.invoice.update({
                where: { id: Number(id) },
                data: { amountPaid: newPaid, status: newStatus },
            });

            return pmt;
        });

        return NextResponse.json(payment, { status: 201 });
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to record payment" }, { status: 500 });
    }
}

// GET /api/finance/invoices/[id]/payments
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const payments = await prisma.payment.findMany({
        where: { invoiceId: Number(id) },
        orderBy: { date: "desc" },
        include: { createdBy: { select: { id: true, name: true } } },
    });
    return NextResponse.json(payments);
}
