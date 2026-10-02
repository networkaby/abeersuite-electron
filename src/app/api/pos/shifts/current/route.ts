// GET /api/pos/shifts/current
//
// Returns the current user's active shift (OPEN or AWAITING_HANDOVER), or null.
// No branch filter — a cashier should always see their active shift regardless of
// which branch cookie is set. (Branch filter caused 404 whenever the user switched
// the branch switcher after opening a shift.)
// PosScreen calls this on mount:
//   • OPEN              → carry on billing
//   • AWAITING_HANDOVER → the cashier came back before anybody took the drawer:
//                         the client cancels the handover and carries on
//                         (modules/pos/lib/currentShift.ts)
//   • null              → check /api/pos/shifts/counter-takeover, then ShiftOpenDialog
//
// ── Why the replica's answer is confirmed before it is trusted ───────────────
// The heavy read stays on `prisma` (the replica on a counter PC) — it is the whole
// shift with its counter, payment accounts and drops, and it is on the POS load path.
// But the replica cannot know about a close that happened while this machine was down:
// the office force-closes a shift on the counter's own request, the machine comes back,
// and its replica still says OPEN. Handing that shift back would let the cashier keep
// billing into a shift the DB has settled, and everything they wrote is then dropped on
// push as a replay onto a closed shift.
//
// So the status alone — one indexed column, not the graph — is confirmed against the
// DB. If the DB says CLOSED, this returns null and the cashier is offered a FRESH
// shift, which is the counter's own job on recovery. If the DB cannot be reached the
// replica's answer stands, exactly as it does everywhere else: offline must never cost
// a cashier their open till.

import { prisma, prismaAuthoritative } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { tillBalancePaise } from "@/modules/pos/lib/shiftMath";
import { payAccountMdr } from "@/modules/pos/lib/paymentGateways";

export async function GET() {
    const { user, response } = await requireAuth();
    if (response) return response;

    try {
        const shift = await prisma.posShift.findFirst({
            where:   { userId: user!.id, status: { in: ["OPEN", "AWAITING_HANDOVER"] } },
            include: {
                counter: {
                    include: {
                        // No cached `balance` — the till figure is summed from the
                        // GL below, the same way every other till surface reads it.
                        tillAccount:         { select: { id: true, name: true } },
                        // The counter's payment accounts (UPI/Card/gateway…) — drive
                        // the checkout payment rows. Each carries its bank ledger
                        // (accountId) + optional VPA for the Share QR.
                        paymentAccounts: {
                            where:   { isActive: true },
                            orderBy: { sortOrder: "asc" },
                            select: {
                                id: true, channel: true, label: true, accountId: true, vpa: true, defaultVisible: true,
                                gatewayId: true,
                                account: { select: { id: true, name: true } },
                            },
                        },
                    },
                },
                branch:  { select: { id: true, name: true, vaultAccountId: true } },
                drops:   { orderBy: { droppedAt: "desc" }, select: { id: true, amountPaise: true, droppedAt: true, notes: true } },
                // The handover this cashier asked for, while nobody has taken it.
                handover: { select: { id: true, status: true, declaredByAPaise: true } },
            },
            orderBy: { openedAt: "desc" },
        });

        if (!shift) return NextResponse.json(null);

        // Cheap confirmation: one row, one column, by primary key.
        try {
            const live = await prismaAuthoritative.posShift.findUnique({
                where:  { id: shift.id },
                select: { status: true },
            });
            if (live?.status === "CLOSED") return NextResponse.json(null);
        } catch {
            // DB unreachable — trust the replica and keep the cashier billing.
        }

        // The till's book balance from the ledger, never the cached column: this
        // is the cashier's carry-over, and it has to agree with the cash in the
        // drawer. One indexed groupBy on the counter's own replica.
        const tillPaise = await tillBalancePaise(prisma, shift.counter.tillAccountId);

        // Each payment account's bank charge (MDR) + UPI split rule, read off its
        // Settings → Payment Methods row — the checkout works the bill out with
        // them (paymentMdr.ts) and /api/pos/sale re-reads the same rows.
        const methodRows = shift.counter.paymentAccounts.length > 0
            ? await prisma.paymentGateway.findMany({ select: { id: true, provider: true, configJson: true } })
            : [];

        return NextResponse.json({
            ...shift,
            counter: {
                ...shift.counter,
                paymentAccounts: shift.counter.paymentAccounts.map((a) => ({ ...a, ...payAccountMdr(a, methodRows) })),
                tillAccount: {
                    ...shift.counter.tillAccount,
                    balance: String(Number(tillPaise) / 100),
                },
            },
            openingFloatPaise:   shift.openingFloatPaise.toString(),
            carryOverFloatPaise: shift.carryOverFloatPaise.toString(),
            vaultTopUpPaise:     shift.vaultTopUpPaise.toString(),
            declaredCashPaise:   shift.declaredCashPaise?.toString()  ?? null,
            expectedCashPaise:   shift.expectedCashPaise?.toString()  ?? null,
            variancePaise:       shift.variancePaise?.toString()      ?? null,
            drops: shift.drops.map((d) => ({ ...d, amountPaise: d.amountPaise.toString() })),
            handover: shift.handover ? {
                ...shift.handover,
                declaredByAPaise: shift.handover.declaredByAPaise?.toString() ?? null,
            } : null,
        });
    } catch (e) {
        return handleApiError(e, "Failed to fetch current shift");
    }
}
