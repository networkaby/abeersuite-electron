import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { balanceDelta, toNumber, nextRef } from "@/modules/accountancy/lib/balance";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// POST /api/accountancy/vouchers/[id]/post
// DRAFT → POSTED: applies GL impact, creates a mirror JournalEntry for the audit
// trail, and updates Account.balance per line.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.FINANCE_VOUCHER_POST);
    if (response) return response;

    const { id } = await params;
    const voucher = await prisma.voucher.findUnique({
        where: { id: Number(id) },
        include: {
            lines: { include: { account: { select: { id: true, normalBalance: true } } } },
        },
    });
    if (!voucher) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (voucher.deletedAt) return NextResponse.json({ error: "Voucher is deleted — restore first" }, { status: 409 });
    if (voucher.status !== "DRAFT") return NextResponse.json({ error: "Only DRAFT vouchers can be posted" }, { status: 409 });

    try {
        const posted = await prisma.$transaction(async (tx) => {
            // Mirror JE for the audit trail (so reports/Day Book see it the same as Journal entries).
            const jeRef = await nextRef(tx, "journalEntry", "JE");
            const je = await tx.journalEntry.create({
                data: {
                    date:        voucher.date,
                    reference:   jeRef,
                    description: `${voucher.type} ${voucher.reference}: ${voucher.narration ?? ""}`.trim(),
                    status:      "POSTED",
                    postedAt:    new Date(),
                    createdById: user!.id,
                    lines: {
                        create: voucher.lines.map((l) => ({
                            accountId:   l.accountId,
                            type:        l.type,
                            amount:      l.amount,
                            description: l.description ?? null,
                        })),
                    },
                },
            });

            // Apply Account.balance deltas.
            for (const line of voucher.lines) {
                const delta = balanceDelta(line.account.normalBalance!, line.type, toNumber(line.amount));
                await tx.account.update({
                    where: { id: line.accountId },
                    data:  { balance: { increment: delta } },
                });
            }

            await tx.voucher.update({
                where: { id: voucher.id },
                data:  {
                    status:         "POSTED",
                    postedAt:       new Date(),
                    journalEntryId: je.id,
                },
            });

            return tx.voucher.findUnique({ where: { id: voucher.id } });
        });

        return NextResponse.json(posted);
    } catch (e) {
        return handleApiError(e, "Failed to post voucher");
    }
}
