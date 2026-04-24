import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { z } from "zod";
import { nextRef, balanceDelta, toNumber } from "@/lib/finance/balance";

const voidSchema = z.object({ reason: z.string().trim().min(1) });

// POST /api/finance/invoices/[id]/void
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const parsed = voidSchema.safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Reason required" }, { status: 400 });
    }

    const invoice = await prisma.invoice.findUnique({ where: { id: Number(id) } });
    if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (invoice.status === "VOID") {
        return NextResponse.json({ error: "Invoice is already voided" }, { status: 409 });
    }
    if (invoice.status === "PAID") {
        return NextResponse.json({ error: "Cannot void a fully paid invoice — reverse payments first" }, { status: 409 });
    }

    try {
        await prisma.$transaction(async (tx) => {
            // Find posted JEs for this invoice (matched by description pattern)
            const relatedJes = await tx.journalEntry.findMany({
                where: {
                    status: "POSTED",
                    description: { contains: invoice.number },
                },
                include: {
                    lines: { include: { glAccount: { select: { normalBalance: true } } } },
                },
            });

            for (const je of relatedJes) {
                // Reverse GL balances
                for (const line of je.lines) {
                    const delta = balanceDelta(line.glAccount.normalBalance, line.type, toNumber(line.amount));
                    await tx.glAccount.update({ where: { id: line.glAccountId }, data: { balance: { decrement: delta } } });
                }

                // Create reversal entry
                const reversalRef = await nextRef(tx, "journalEntry", "JE");
                const reversalLines = je.lines.map((l) => ({
                    glAccountId: l.glAccountId,
                    type: l.type === "DEBIT" ? "CREDIT" : "DEBIT" as "DEBIT" | "CREDIT",
                    amount: l.amount,
                    description: `Void reversal — Invoice ${invoice.number}`,
                }));

                const reversalJe = await tx.journalEntry.create({
                    data: {
                        date: new Date(),
                        reference: reversalRef,
                        description: `VOID reversal of Invoice ${invoice.number}: ${parsed.data.reason}`,
                        status: "POSTED",
                        postedAt: new Date(),
                        createdById: user!.id,
                        lines: { create: reversalLines },
                    },
                    include: { lines: { include: { glAccount: { select: { normalBalance: true } } } } },
                });

                // Apply reversal balance changes
                for (const line of reversalJe.lines) {
                    const delta = balanceDelta(line.glAccount.normalBalance, line.type, toNumber(line.amount));
                    await tx.glAccount.update({ where: { id: line.glAccountId }, data: { balance: { increment: delta } } });
                }

                // Mark original JE as voided
                await tx.journalEntry.update({
                    where: { id: je.id },
                    data: { status: "VOIDED", voidedAt: new Date(), voidReason: parsed.data.reason },
                });
            }

            await tx.invoice.update({
                where: { id: Number(id) },
                data: { status: "VOID" },
            });
        });

        const voided = await prisma.invoice.findUnique({ where: { id: Number(id) } });
        return NextResponse.json(voided);
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to void invoice" }, { status: 500 });
    }
}
