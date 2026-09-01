// GET /api/pos/shifts/current
//
// Returns the current user's active shift (OPEN or AWAITING_HANDOVER), or null.
// No branch filter — a cashier should always see their active shift regardless of
// which branch cookie is set. (Branch filter caused 404 whenever the user switched
// the branch switcher after opening a shift.)
// PosScreen calls this on mount:
//   • OPEN            → show ActiveShiftBar
//   • AWAITING_HANDOVER → show amber "Handover pending" bar
//   • null            → check /api/pos/shifts/pending-handover, then ShiftOpenDialog
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

export async function GET() {
    const { user, response } = await requireAuth();
    if (response) return response;

    try {
        const shift = await prisma.posShift.findFirst({
            where:   { userId: user!.id, status: { in: ["OPEN", "AWAITING_HANDOVER"] } },
            include: {
                counter: {
                    include: {
                        tillAccount:         { select: { id: true, name: true, balance: true } },
                        // The counter's payment accounts (UPI/Card/gateway…) — drive
                        // the checkout payment rows. Each carries its bank ledger
                        // (accountId) + optional VPA for the Share QR.
                        paymentAccounts: {
                            where:   { isActive: true },
                            orderBy: { sortOrder: "asc" },
                            select: {
                                id: true, channel: true, label: true, accountId: true, vpa: true, defaultVisible: true,
                                account: { select: { id: true, name: true } },
                            },
                        },
                    },
                },
                branch:  { select: { id: true, name: true, vaultAccountId: true } },
                drops:   { orderBy: { droppedAt: "desc" }, select: { id: true, amountPaise: true, droppedAt: true, notes: true } },
                // Include pending handover so UI can show who B is.
                handover: {
                    select: {
                        id: true,
                        status: true,
                        declaredByAPaise: true,
                        carryOverPaise: true,
                        toUser: { select: { id: true, name: true } },
                    },
                },
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

        return NextResponse.json({
            ...shift,
            openingFloatPaise:   shift.openingFloatPaise.toString(),
            carryOverFloatPaise: shift.carryOverFloatPaise.toString(),
            vaultTopUpPaise:     shift.vaultTopUpPaise.toString(),
            declaredCashPaise:   shift.declaredCashPaise?.toString()  ?? null,
            expectedCashPaise:   shift.expectedCashPaise?.toString()  ?? null,
            variancePaise:       shift.variancePaise?.toString()      ?? null,
            drops: shift.drops.map((d) => ({ ...d, amountPaise: d.amountPaise.toString() })),
            handover: shift.handover ? {
                ...shift.handover,
                declaredByAPaise: shift.handover.declaredByAPaise.toString(),
                carryOverPaise:   shift.handover.carryOverPaise.toString(),
            } : null,
        });
    } catch (e) {
        return handleApiError(e, "Failed to fetch current shift");
    }
}
