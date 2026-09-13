// GET /api/pos/cash-movements
//
// Recent counter cash movements for the POS register's "Payment/Receipt" tab:
// receipts collected from parties (the Rcv flow) and expenditures paid from the
// drawer (the Exp flow).
//
// Reads the VOUCHERS themselves, filtered by the shift they were raised on.
// Until 2026-09-13 this read the pos_receipts / pos_expenditures side tables and
// only looked the voucher up afterwards to print its number — so a deleted
// voucher left its side row on this list forever, showing a dash where the
// reference belonged. The shift link lives on the voucher now
// (`UniversalVoucher.sourceShiftId`), which means a deleted voucher simply is
// not here: one row, one lifecycle.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";

export async function GET(req: NextRequest) {
    const { response } = await requireAuth();
    if (response) return response;

    try {
        const params = new URL(req.url).searchParams;
        const limit = Math.min(200, Math.max(1, Number(params.get("limit")) || 100));
        // "Only this counter". A voucher's shift knows its counter, so the filter
        // is a shift lookup rather than a column on the voucher: `sourceCounterId`
        // says where a voucher was RAISED, which is the same thing here but would
        // also drag in POS sales and every other counter document.
        const counterIdRaw = Number(params.get("counterId"));
        const counterId = Number.isInteger(counterIdRaw) && counterIdRaw > 0 ? counterIdRaw : null;
        const shiftIds = counterId == null ? null : (await prisma.posShift.findMany({
            where:  { counterId },
            select: { id: true },
        })).map((s) => s.id);
        if (shiftIds != null && shiftIds.length === 0) return NextResponse.json({ items: [] });

        // RECEIPT = money in at the counter, PAYMENT = money out of the drawer.
        // Both must be raised ON a shift to belong here — an office receipt into
        // the same till is not a counter movement.
        const vouchers = await prisma.universalVoucher.findMany({
            where: {
                type:          { in: ["RECEIPT", "PAYMENT"] },
                status:        "POSTED",
                deletedAt:     null,
                sourceShiftId: shiftIds == null ? { not: null } : { in: shiftIds },
            },
            orderBy: { createdAt: "desc" },
            take:    limit,
            select: {
                id: true, type: true, voucherNo: true, narration: true, description: true,
                createdAt: true, sourceShiftId: true, partyAccountId: true,
                lines: { select: { accountId: true, type: true, amount: true } },
            },
        });
        if (vouchers.length === 0) return NextResponse.json({ items: [] });

        // Batch-resolve the shift (counter + cashier) and the party ledger name.
        // `partyAccountId` is the settled party on a receipt; an expenditure has
        // none, so its party column shows the expense ledger — the debit leg.
        const shifts = await prisma.posShift.findMany({
            where:  { id: { in: [...new Set(vouchers.map((v) => v.sourceShiftId!))] } },
            select: { id: true, counter: { select: { name: true } }, user: { select: { name: true } } },
        });
        const shiftById = new Map(shifts.map((s) => [s.id, s]));

        // One debit leg names an expenditure; on a receipt the party is explicit.
        const partyIdFor = (v: (typeof vouchers)[number]): number | null =>
            v.type === "RECEIPT"
                ? v.partyAccountId
                : (v.lines.find((l) => l.type === "DEBIT")?.accountId ?? null);
        const accountIds = [...new Set(vouchers.map(partyIdFor).filter((x): x is number => x != null))];
        const accounts = accountIds.length === 0 ? [] : await prisma.account.findMany({
            where: { id: { in: accountIds } }, select: { id: true, name: true },
        });
        const nameById = new Map(accounts.map((a) => [a.id, a.name]));

        // The amount is the voucher itself — one side of a balanced voucher.
        const sumSide = (v: (typeof vouchers)[number], side: "DEBIT" | "CREDIT"): number =>
            v.lines.filter((l) => l.type === side).reduce((s, l) => s + Number(l.amount), 0);

        const items = vouchers.map((v) => {
            const shift = shiftById.get(v.sourceShiftId!);
            const partyId = partyIdFor(v);
            return {
                id:        `v-${v.id}`,
                voucherId: v.id,                  // → /receipt/payment/[voucherId] reprint
                kind:      v.type === "RECEIPT" ? ("IN" as const) : ("OUT" as const),
                reference: v.voucherNo ?? formatUvNo(v.id),
                date:      v.createdAt.toISOString(),
                amount:    sumSide(v, "DEBIT").toFixed(2),
                party:     (partyId != null ? nameById.get(partyId) : null) ?? "—",
                note:      v.narration ?? v.description ?? null,
                counter:   shift?.counter.name ?? "—",
                cashier:   shift?.user.name ?? "—",
            };
        });

        return NextResponse.json({ items });
    } catch (e) {
        return handleApiError(e, "Failed to load cash movements");
    }
}
