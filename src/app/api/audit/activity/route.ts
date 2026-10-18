import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { AI_COPY_TEST_ENTITY } from "@/shared/lib/constants/ai";
import { auditSnapshotKind } from "@/shared/lib/accountancy/auditSnapshotKind";

// GET /api/audit/activity?from=<ISO>&to=<ISO>
// Who did what to which voucher, in a time window — the Recycle Bin's Activity tab.
//
// Nothing new is written for this. Every action already leaves its mark:
//   Created   → UniversalVoucher.createdById / createdAt
//   Cancelled → UniversalVoucher.cancelledById / cancelledAt
//   Edited    → the PRE_EDIT AuditLog copy (actor = the editor)
//   Deleted   → the DELETE AuditLog copy (actor = the deleter)
//   Restored  → AuditLog.restoredById / restoredAt
// Merged newest first. A voucher edited many times shows one row per edit.

const MAX_PER_SOURCE = 1000;

type Action = "CREATED" | "EDITED" | "CANCELLED" | "DELETED" | "RESTORED";

interface ActivityRow {
    key: string;
    at: string;
    action: Action;
    userId: number | null;
    userName: string | null;
    voucherId: number;
    /** Still on the books → the row can open it. */
    live: boolean;
    type: string | null;
    voucherNo: string | null;
    date: string | null;
    amount: number | null;
    party: string | null;
    note: string | null;
}

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    try {
        const url = new URL(req.url);
        const to = url.searchParams.get("to") ? new Date(url.searchParams.get("to")!) : new Date();
        const from = url.searchParams.get("from")
            ? new Date(url.searchParams.get("from")!)
            : new Date(to.getTime() - 24 * 3600 * 1000);
        if (isNaN(from.getTime()) || isNaN(to.getTime())) {
            return NextResponse.json({ error: "Bad from/to" }, { status: 400 });
        }
        const win = { gte: from, lt: to };

        const [created, cancelled, audits, restored] = await Promise.all([
            prisma.universalVoucher.findMany({
                where: { createdAt: win },
                orderBy: { createdAt: "desc" },
                take: MAX_PER_SOURCE,
                select: { id: true, createdAt: true, createdById: true },
            }),
            prisma.universalVoucher.findMany({
                where: { cancelledAt: win },
                take: MAX_PER_SOURCE,
                select: { id: true, cancelledAt: true, cancelledById: true, cancelReason: true },
            }),
            prisma.auditLog.findMany({
                where: { createdAt: win, entityType: { not: AI_COPY_TEST_ENTITY } },
                orderBy: { createdAt: "desc" },
                take: MAX_PER_SOURCE,
                select: {
                    id: true, originalId: true, originalRef: true, subtype: true, action: true,
                    reason: true, createdAt: true, actorId: true,
                },
            }),
            prisma.auditLog.findMany({
                where: { restoredAt: win, entityType: { not: AI_COPY_TEST_ENTITY } },
                take: MAX_PER_SOURCE,
                select: {
                    id: true, originalId: true, originalRef: true, subtype: true, action: true,
                    reason: true, restoredAt: true, restoredById: true,
                },
            }),
        ]);

        // One read each for the voucher headers, amounts, parties and names involved.
        const voucherIds = [...new Set([
            ...created.map((v) => v.id),
            ...cancelled.map((v) => v.id),
            ...audits.map((a) => a.originalId),
            ...restored.map((a) => a.originalId),
        ])];
        const [vouchers, totals] = await Promise.all([
            prisma.universalVoucher.findMany({
                where: { id: { in: voucherIds } },
                select: { id: true, type: true, voucherNo: true, date: true, partyAccountId: true },
            }),
            prisma.voucherGlLine.groupBy({
                by: ["universalVoucherId"],
                where: { universalVoucherId: { in: voucherIds }, type: "DEBIT" },
                _sum: { amount: true },
            }),
        ]);
        const vById = new Map(vouchers.map((v) => [v.id, v]));
        const amountById = new Map(totals.map((t) => [t.universalVoucherId, Number(t._sum.amount ?? 0)]));

        const partyIds = [...new Set(vouchers.map((v) => v.partyAccountId).filter((x): x is number => x != null))];
        const userIds = [...new Set([
            ...created.map((v) => v.createdById),
            ...cancelled.map((v) => v.cancelledById),
            ...audits.map((a) => a.actorId),
            ...restored.map((a) => a.restoredById),
        ].filter((x): x is number => x != null))];
        const [parties, users] = await Promise.all([
            prisma.account.findMany({ where: { id: { in: partyIds } }, select: { id: true, name: true } }),
            prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
        ]);
        const partyName = new Map(parties.map((p) => [p.id, p.name]));
        const userName = new Map(users.map((u) => [u.id, u.name]));

        const row = (
            key: string, at: Date, action: Action, userId: number | null, voucherId: number,
            fallback: { ref?: string | null; subtype?: string | null } = {}, note: string | null = null,
        ): ActivityRow => {
            const v = vById.get(voucherId);
            return {
                key, at: at.toISOString(), action, userId,
                userName: userId != null ? userName.get(userId) ?? null : null,
                voucherId,
                live: !!v,
                type: v?.type ?? fallback.subtype ?? null,
                voucherNo: v?.voucherNo ?? fallback.ref ?? null,
                date: v?.date.toISOString() ?? null,
                amount: v ? amountById.get(voucherId) ?? null : null,
                party: v?.partyAccountId != null ? partyName.get(v.partyAccountId) ?? null : null,
                note,
            };
        };

        const rows: ActivityRow[] = [
            ...created.map((v) => row(`c${v.id}`, v.createdAt, "CREATED", v.createdById, v.id)),
            ...cancelled.map((v) => row(`x${v.id}`, v.cancelledAt!, "CANCELLED", v.cancelledById, v.id, {}, v.cancelReason)),
            ...audits.map((a) => row(
                `a${a.id}`, a.createdAt, auditSnapshotKind(a) === "EDIT" ? "EDITED" : "DELETED", a.actorId, a.originalId,
                { ref: a.originalRef, subtype: a.subtype }, a.reason,
            )),
            ...restored.map((a) => row(`r${a.id}`, a.restoredAt!, "RESTORED", a.restoredById, a.originalId, { ref: a.originalRef, subtype: a.subtype })),
        ].sort((a, b) => b.at.localeCompare(a.at));

        return NextResponse.json(rows);
    } catch (e) {
        return handleApiError(e, "Failed to load activity");
    }
}
