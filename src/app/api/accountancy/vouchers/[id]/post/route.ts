import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, userCanVoucher } from "@/shared/lib/auth/permissions";
import { balanceDelta, toNumber, nextRefFromSeries } from "@/modules/accountancy/lib/balance";
import { handleApiError } from "@/shared/lib/api";

// POST /api/accountancy/vouchers/[id]/post
// DRAFT → POSTED: applies GL impact, creates a mirror JournalEntry for the audit
// trail, and updates Account.balance per line.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const voucher = await prisma.voucher.findUnique({
        where: { id: Number(id) },
        include: {
            lines: { include: { account: { select: { id: true, normalBalance: true } } } },
        },
    });
    if (!voucher) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Per-kind post gate (falls back to generic finance:voucher:post).
    if (!userCanVoucher(user, voucher.type, "post")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (voucher.deletedAt) return NextResponse.json({ error: "Voucher is deleted — restore first" }, { status: 409 });
    if (voucher.status !== "DRAFT") return NextResponse.json({ error: "Only DRAFT vouchers can be posted" }, { status: 409 });

    try {
        const posted = await prisma.$transaction(async (tx) => {
            // Mirror JE for the audit trail (so reports/Day Book see it the same as Journal entries).
            const jeRef = await nextRefFromSeries(tx, "GL_POSTING", user!.id);
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
        // Per-line account.update + mirror-JE over the Supabase pooler can
        // exceed the default 5s interactive-tx ceiling (P2028) on multi-line
        // vouchers — match the 30s headroom used elsewhere.
        }, { timeout: 30_000, maxWait: 10_000 });

        return NextResponse.json(posted);
    } catch (e) {
        return handleApiError(e, "Failed to post voucher");
    }
}
