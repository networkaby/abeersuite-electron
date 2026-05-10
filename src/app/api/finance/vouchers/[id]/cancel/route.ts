import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/authGuard";
import { z } from "zod";
import { balanceDelta, toNumber, nextRef } from "@/modules/accountancy/lib/balance";
import { ensureCancelable, cancelFields, lifecycleErrorResponse } from "@/modules/accountancy/lib/voucherLifecycle";

const schema = z.object({ reason: z.string().trim().min(1, "Cancel reason required") });

// POST /api/finance/vouchers/[id]/cancel
// Tally-style: writes a counter-JE and marks the voucher CANCELLED. Reference number preserved.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission("finance:voucher:cancel");
    if (response) return response;

    const { id } = await params;
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Reason required" }, { status: 400 });

    const voucher = await prisma.voucher.findUnique({
        where: { id: Number(id) },
        include: { lines: { include: { account: { select: { normalBalance: true } } } } },
    });
    if (!voucher) return NextResponse.json({ error: "Not found" }, { status: 404 });

    try {
        ensureCancelable(voucher);

        await prisma.$transaction(async (tx) => {
            // Reverse account balances
            for (const line of voucher.lines) {
                const delta = balanceDelta(line.account.normalBalance!, line.type, toNumber(line.amount));
                await tx.account.update({ where: { id: line.accountId }, data: { balance: { decrement: delta } } });
            }

            // Counter JE
            const reversalRef = await nextRef(tx, "journalEntry", "JE");
            const reversalLines = voucher.lines.map((l) => ({
                accountId:   l.accountId,
                type:        (l.type === "DEBIT" ? "CREDIT" : "DEBIT") as "DEBIT" | "CREDIT",
                amount:      l.amount,
                description: `Cancel reversal — ${voucher.reference}`,
            }));
            const reversalJe = await tx.journalEntry.create({
                data: {
                    date:        new Date(),
                    reference:   reversalRef,
                    description: `CANCEL of ${voucher.type} ${voucher.reference}: ${parsed.data.reason}`,
                    status:      "POSTED",
                    postedAt:    new Date(),
                    createdById: user!.id,
                    lines:       { create: reversalLines },
                },
                include: { lines: { include: { account: { select: { normalBalance: true } } } } },
            });
            for (const line of reversalJe.lines) {
                const delta = balanceDelta(line.account.normalBalance!, line.type, toNumber(line.amount));
                await tx.account.update({ where: { id: line.accountId }, data: { balance: { increment: delta } } });
            }

            // Mirror JE on the original voucher → mark cancelled
            if (voucher.journalEntryId) {
                await tx.journalEntry.update({
                    where: { id: voucher.journalEntryId },
                    data:  {
                        status:        "CANCELLED",
                        cancelledAt:   new Date(),
                        cancelledById: user!.id,
                        cancelReason:  `Voucher ${voucher.reference} cancelled. Reversal: ${reversalJe.reference}`,
                    },
                });
            }

            await tx.voucher.update({
                where: { id: voucher.id },
                data:  cancelFields(user!.id, parsed.data.reason),
            });
        });

        const cancelled = await prisma.voucher.findUnique({ where: { id: Number(id) } });
        return NextResponse.json(cancelled);
    } catch (err) {
        const lifecycle = lifecycleErrorResponse(err);
        if (lifecycle) return lifecycle;
        console.error(err);
        return NextResponse.json({ error: "Failed to cancel voucher" }, { status: 500 });
    }
}
