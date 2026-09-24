// POST /api/pos/shifts/[id]/takeover
//
// The next cashier (B) takes the WHOLE drawer of the shift running on a counter.
// B has already signed in — that is B's confirmation — and has seen the drawer on
// the lock screen and in the takeover modal. Accepting makes it B's.
//
// Two ways to arrive here, one rule for the books:
//   • A handed over properly (shift AWAITING_HANDOVER, PENDING row with A's count):
//     the drawer is what A counted. Any gap between A's count and the books is A's
//     variance, posted on A's shift. B opens with A's count.
//   • A just signed out (shift OPEN, nobody counted): A closes at the books' figure
//     with no variance. B opens with that figure; whatever B finds from here on is
//     B's, because B saw it and accepted.
//
// One transaction:
//   1. Claim A's shift (status check and write in one statement — two people
//      accepting at once cannot both win).
//   2. Variance Journal on A's shift, only when A counted and it differs.
//   3. Contra: the day's safe drops → vault. They left the drawer earlier but stay
//      on the till ledger until a close sweeps them; nothing else leaves — the
//      whole drawer stays on the counter for B.
//   4. A's shift CLOSED with its figures; B's shift OPEN on the same counter.
//   5. The handover row ACCEPTED (written now, as the audit trail, if A never
//      asked for one).
//
// Body: { deviceId? } — this PC's identity, for the counter's device lock only.

import { prisma, prismaAuthoritative } from "@/shared/lib/prisma/prismaClient";
import { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { postContra } from "@/modules/accountancy/lib/postContra";
import { enginePost } from "@/modules/accountancy/lib/transactionEngine";
import { computeExpectedCash, computeVariance, sumPaise, tillBalancePaise } from "@/modules/pos/lib/shiftMath";
import { requestBusinessDate } from "@/shared/lib/api/requestBusinessDate";
import { blockStartFor } from "@/shared/lib/counter/idRange";
import { stampAttendanceIn, stampAttendanceOut } from "@/shared/lib/hr/attendanceStamp";

const takeoverSchema = z.object({
    deviceId: z.string().trim().max(200).optional(),
});

/** A refusal found inside the transaction — rolls everything back, answered as 409. */
class TakeoverRefused extends Error {}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.POS_SHIFT_OPEN);
    if (response) return response;

    const { id: idStr } = await params;
    const shiftId = Number(idStr);
    if (!Number.isFinite(shiftId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const { data, error } = await validateRequest(req, takeoverSchema);
    if (error) return error;

    try {
        const shift = await prisma.posShift.findUnique({
            where:   { id: shiftId },
            include: {
                user:     { select: { id: true, name: true } },
                counter:  { include: { tillAccount: { select: { id: true, name: true } } } },
                branch:   { select: { id: true, name: true, vaultAccountId: true } },
                drops:    { select: { amountPaise: true } },
                handover: { select: { status: true, declaredByAPaise: true } },
            },
        });
        if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });
        if (shift.status === "CLOSED") {
            return NextResponse.json({ error: "This shift is already closed. Open a fresh shift instead." }, { status: 409 });
        }
        if (shift.userId === user!.id) {
            return NextResponse.json({ error: "This is your own shift — carry on with it." }, { status: 409 });
        }
        const isAdmin = user!.permissions.includes(PERMISSIONS.ADMIN_BYPASS);
        if (!isAdmin && !user!.branchIds.includes(shift.branchId)) {
            return NextResponse.json({ error: `This counter belongs to ${shift.branch.name}, which is not one of your branches.` }, { status: 403 });
        }
        // Same device lock as opening a shift: a counter bound to another PC is
        // taken over from that PC, not from here.
        if (shift.counter.boundDeviceId && data.deviceId && shift.counter.boundDeviceId !== data.deviceId) {
            return NextResponse.json(
                { error: "This counter is locked to another computer. Take it over from that computer." },
                { status: 409 },
            );
        }

        const tillAccountId = shift.counter.tillAccountId;
        const dropsPaise    = sumPaise(shift.drops);
        // Authoritative, as shift open and close read it: this figure posts the
        // variance and becomes B's opening cash.
        const expectedPaise = computeExpectedCash(await tillBalancePaise(prismaAuthoritative, tillAccountId), dropsPaise);

        // A's count, when A handed over properly. Otherwise nobody counted, and the
        // drawer passes at the books' figure.
        const counted = shift.status === "AWAITING_HANDOVER" && shift.handover?.status === "PENDING"
            ? shift.handover.declaredByAPaise
            : null;
        const declaredPaise = counted ?? expectedPaise;
        const variancePaise = computeVariance(declaredPaise, expectedPaise);
        const variance      = Number(variancePaise);

        if (dropsPaise > BigInt(0) && !shift.branch.vaultAccountId) {
            return NextResponse.json({ error: `Branch ${shift.branch.name} has no Vault account configured.` }, { status: 400 });
        }

        let shortAccountId: number | null = null;
        let overAccountId:  number | null = null;
        if (variance !== 0) {
            const shortAcc = await prisma.account.findFirst({ where: { name: "Cash Short" }, select: { id: true } });
            const overAcc  = await prisma.account.findFirst({ where: { name: "Cash Over"  }, select: { id: true } });
            if (!shortAcc || !overAcc) {
                return NextResponse.json({ error: "Cash Short / Cash Over ledgers missing. Re-run bootstrap seed." }, { status: 500 });
            }
            shortAccountId = shortAcc.id;
            overAccountId  = overAcc.id;
        }

        // The counter's reserved id block for offline writes — same as shift open.
        let idRangeStart = shift.counter.idRangeStart;
        if (!idRangeStart && shift.counter.counterNumber) {
            try { idRangeStart = blockStartFor(shift.counter.counterNumber); }
            catch (err) { console.warn("[Takeover] Invalid counterNumber for id-range reservation:", err); }
        }

        const closedAt    = new Date();
        const voucherDate = requestBusinessDate(req);

        const result = await prisma.$transaction(async (tx) => {
            // 1. Claim A's shift. The status check and the write are one statement.
            const claimed = await tx.posShift.updateMany({
                where: { id: shift.id, status: shift.status },
                data:  { status: "CLOSED", closedAt, closedById: user!.id },
            });
            if (claimed.count !== 1) throw new TakeoverRefused("This counter changed while you were looking at it — open the POS again to see it as it is now.");

            // B must not end up running two tills.
            const busy = await tx.posShift.findFirst({
                where:  { userId: user!.id, status: { in: ["OPEN", "AWAITING_HANDOVER"] } },
                select: { id: true, counter: { select: { name: true } } },
            });
            if (busy) throw new TakeoverRefused(`You already have shift #${busy.id} open on ${busy.counter.name}. Close it first.`);

            // 2. A's variance — only when A counted and the count differs.
            let varianceJeId: number | null = null;
            if (variance !== 0) {
                const absRupees = Math.abs(variance) / 100;
                const lines = variance > 0
                    ? [
                        { accountId: tillAccountId,  type: "DEBIT"  as const, amount: absRupees, description: "Cash drawer over at handover" },
                        { accountId: overAccountId!, type: "CREDIT" as const, amount: absRupees, description: "Cash Over (POS handover)" },
                    ]
                    : [
                        { accountId: shortAccountId!, type: "DEBIT"  as const, amount: absRupees, description: "Cash Short (POS handover)" },
                        { accountId: tillAccountId,   type: "CREDIT" as const, amount: absRupees, description: "Cash drawer short at handover" },
                    ];
                const { journalEntryId } = await enginePost(tx, {
                    type:        "JOURNAL",
                    date:        voucherDate,
                    description: `Shift #${shift.id} handover — ${variance > 0 ? "over" : "short"} ₹${absRupees} (${shift.user.name}'s count)`,
                    glLines:     lines,
                    stockMoves:  [],
                }, user!.id, { branchId: shift.branchId });
                varianceJeId = journalEntryId;
            }

            // 3. The day's safe drops go to the vault; the drawer itself stays.
            let closingContraId: number | null = null;
            if (dropsPaise > BigInt(0)) {
                const rupees = Number(dropsPaise) / 100;
                const narration = `Handover — ${shift.counter.name} safe drops → Vault (${shift.branch.name})`;
                closingContraId = (await postContra(tx, {
                    branchId: shift.branchId,
                    date:     voucherDate,
                    narration,
                    userId:   user!.id,
                    lines: [
                        { accountId: shift.branch.vaultAccountId!, type: "DEBIT",  amount: rupees, description: "Cash dropped to the safe during the shift" },
                        { accountId: tillAccountId,                type: "CREDIT", amount: rupees, description: "Safe drops swept on handover (drawer stays on the counter)" },
                    ],
                })).voucherId;
            }

            // 4. B's shift, with the whole drawer.
            if (idRangeStart && idRangeStart !== shift.counter.idRangeStart) {
                await tx.posCounter.update({ where: { id: shift.counterId }, data: { idRangeStart } });
            }
            const opened = await tx.posShift.create({
                data: {
                    userId:              user!.id,
                    counterId:           shift.counterId,
                    branchId:            shift.branchId,
                    openedById:          user!.id,
                    openingFloatPaise:   declaredPaise,
                    carryOverFloatPaise: declaredPaise,
                    vaultTopUpPaise:     BigInt(0),
                },
                include: {
                    counter: { include: { tillAccount: { select: { id: true, name: true } } } },
                    branch:  { select: { id: true, name: true } },
                },
            });

            // A's shift keeps its figures. carryOverNext = the drawer passed on.
            await tx.posShift.update({
                where: { id: shift.id },
                data: {
                    declaredCashPaise:      declaredPaise,
                    expectedCashPaise:      expectedPaise,
                    variancePaise,
                    carryOverNextPaise:     declaredPaise,
                    toVaultPaise:           dropsPaise,
                    closingContraVoucherId: closingContraId,
                    varianceJournalEntryId: varianceJeId,
                    handoverToShiftId:      opened.id,
                },
            });

            // 5. The handover row, ACCEPTED. A plain sign-out never wrote one — it is
            // written now so the shift pages show who took the drawer over. A row a
            // cancelled attempt left behind is overwritten: nobody counted this time.
            const accepted = { status: "ACCEPTED" as const, toUserId: user!.id, toShiftId: opened.id, acceptedAt: closedAt };
            const uncounted = { declaredByAPaise: null, denominationsJson: Prisma.DbNull, notes: null, initiatedAt: closedAt };
            await tx.posHandover.upsert({
                where:  { fromShiftId: shift.id },
                create: { fromShiftId: shift.id, ...uncounted, ...accepted },
                update: counted != null ? accepted : { ...uncounted, ...accepted },
            });

            return opened;
        });

        // HR & People: the handover is A's out and B's in. Best-effort, as on close/open.
        await stampAttendanceOut(prisma, shift.userId, closedAt, { openedAt: shift.openedAt, counterId: shift.counterId });
        await stampAttendanceIn(prisma, result.userId, result.counterId, result.openedAt);

        // Explicit fields only — the same shape shift open answers with.
        return NextResponse.json({
            id:                  result.id,
            status:              result.status,
            openedAt:            result.openedAt,
            openingFloatPaise:   result.openingFloatPaise.toString(),
            carryOverFloatPaise: result.carryOverFloatPaise.toString(),
            vaultTopUpPaise:     result.vaultTopUpPaise.toString(),
            idRangeStart:        result.counter.idRangeStart ?? null,
            closedShiftId:       shift.id,
            variancePaise:       variancePaise.toString(),
            counter: {
                id:            result.counter.id,
                name:          result.counter.name,
                counterNumber: result.counter.counterNumber ?? null,
                tillAccount:   { id: result.counter.tillAccount.id, name: result.counter.tillAccount.name },
            },
            branch: { id: result.branch.id, name: result.branch.name },
        }, { status: 201 });
    } catch (e) {
        if (e instanceof TakeoverRefused) return NextResponse.json({ error: e.message }, { status: 409 });
        return handleApiError(e, "Failed to take over the counter");
    }
}
