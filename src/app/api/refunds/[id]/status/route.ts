import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { assertRefundStatus, getRefundForPayout, markRefundPaid, REFUND_STAGE } from "@/modules/refund/lib/refund";
import { businessTodayIso } from "@/shared/lib/format/formatDate";

// PATCH /api/refunds/[id]/status  body { statusId } — move a refund along P9
// (validates the seeded transition graph). Moving to Refunded (S59) posts the GL
// pay-back: a PAYMENT voucher (Dr customer / Cr cash-bank) reversing the advance
// Receipt, via the canonical create+post voucher routes — no new GL math here.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const id = Number((await params).id);
    if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    try {
        const { statusId } = (await req.json()) as { statusId?: string };
        if (!statusId) return NextResponse.json({ error: "statusId required" }, { status: 400 });

        const refund = await prisma.ticket.findUnique({ where: { id }, select: { status: true, refund: { select: { ticketId: true } } } });
        if (!refund?.refund) return NextResponse.json({ error: "Refund not found" }, { status: 404 });

        const check = await assertRefundStatus(statusId);
        if (!check.ok) return NextResponse.json({ error: check.message }, { status: 422 });

        if (refund.status && refund.status !== statusId) {
            const allowed = await prisma.statusTransition.findFirst({
                where: { fromStatusId: refund.status, toStatusId: statusId },
                select: { id: true },
            });
            if (!allowed) {
                return NextResponse.json({ error: "That refund move isn't allowed.", code: "TRANSITION_NOT_ALLOWED" }, { status: 400 });
            }
        }

        // refund-apply: posting the pay-back when the refund reaches Refunded. Reuse
        // the protected create+post voucher routes (internal fetch, forwarding the
        // operator's cookie) so the GL math stays in the tested path. Idempotent via
        // the refund's payoutVoucherId.
        let payoutRef: string | null = null;
        if (statusId === REFUND_STAGE.REFUNDED) {
            const payout = await getRefundForPayout(id);
            if (payout && !payout.alreadyPaid) {
                if (!payout.sourceVoucherId) {
                    return NextResponse.json({ error: "No advance Receipt is linked to this refund — pay it back manually, then mark it Refunded.", code: "NO_SOURCE_VOUCHER" }, { status: 409 });
                }
                if (!payout.customerAccountId || !payout.cashBankAccountId || !(payout.amount > 0)) {
                    return NextResponse.json({ error: "Couldn't resolve the advance to refund (customer / cash ledger). Pay it back manually.", code: "PAYOUT_UNRESOLVED" }, { status: 409 });
                }
                const cookie = req.headers.get("cookie") ?? "";
                // Server clock is UTC regardless of where the shop is —
                // business-zone "today" so a refund run between 00:00-05:30 IST
                // isn't stamped with yesterday's date.
                const today = businessTodayIso();
                const narration = `Refund of advance${payout.orderRef ? ` — ${payout.orderRef}` : ""}`;
                const createRes = await fetch(new URL("/api/accountancy/vouchers", req.url), {
                    method: "POST",
                    headers: { "content-type": "application/json", cookie },
                    body: JSON.stringify({
                        type: "PAYMENT",
                        date: today,
                        narration,
                        partyAccountId: payout.customerAccountId,
                        lines: [
                            { accountId: payout.customerAccountId, type: "DEBIT", amount: payout.amount, description: "Advance refund" },
                            { accountId: payout.cashBankAccountId, type: "CREDIT", amount: payout.amount, description: "Advance refund" },
                        ],
                    }),
                });
                if (!createRes.ok) {
                    const e = (await createRes.json().catch(() => ({}))) as { error?: string };
                    return NextResponse.json({ error: e.error || "Couldn't create the refund payment.", code: "PAYOUT_CREATE_FAILED" }, { status: 422 });
                }
                const pv = (await createRes.json()) as { id: number; reference: string };
                const postRes = await fetch(new URL(`/api/accountancy/vouchers/${pv.id}/post`, req.url), {
                    method: "POST",
                    headers: { "content-type": "application/json", cookie },
                });
                if (!postRes.ok) {
                    const e = (await postRes.json().catch(() => ({}))) as { error?: string };
                    return NextResponse.json({ error: e.error || "Refund payment created but posting failed.", code: "PAYOUT_POST_FAILED" }, { status: 422 });
                }
                await markRefundPaid(id, pv.id);
                payoutRef = pv.reference;
            }
        }

        await prisma.ticket.update({ where: { id }, data: { status: statusId } });
        return NextResponse.json({ id, statusId, payoutRef });
    } catch (e) {
        return handleApiError(e, "Failed to move refund");
    }
}
