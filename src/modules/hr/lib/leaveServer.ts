import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { toDateOnlyUtc } from "@/shared/lib/format/formatDate";
import type { LeaveKind, LeaveStatus } from "@/shared/lib/schemas/hrAttendanceSchema";
import { inclusiveDays } from "./payrollProrate";
import { isoDaysBetween } from "./attendanceCalendar";
import type { LeaveRequestDto } from "./attendanceTypes";

export const LEAVE_INCLUDE = { user: { select: { name: true } } } satisfies Prisma.LeaveRequestInclude;
type LeaveRow = Prisma.LeaveRequestGetPayload<{ include: typeof LEAVE_INCLUDE }>;

export function toLeaveDto(r: LeaveRow): LeaveRequestDto {
    const fromDate = toDateOnlyUtc(r.fromDate);
    const toDate = toDateOnlyUtc(r.toDate);
    return {
        id: r.id, userId: r.userId, userName: r.user.name,
        fromDate, toDate, days: inclusiveDays(fromDate, toDate),
        kind: r.kind as LeaveKind, reason: r.reason,
        status: r.status as LeaveStatus,
        decidedById: r.decidedById, decidedAt: r.decidedAt?.toISOString() ?? null, decisionNote: r.decisionNote,
        createdAt: r.createdAt.toISOString(),
    };
}

/** The register note that ties a LEAVE day to the request that wrote it. */
const leaveTag = (id: number) => `Leave #${id}`;

/**
 * Decide a request and keep the register in step: approval writes LEAVE onto
 * every day of the range that has no mark yet (a day the till already recorded
 * as PRESENT is a fact and stays); taking an approval back removes exactly the
 * days this request wrote, and nothing else.
 */
export async function applyLeaveDecision(
    tx: Prisma.TransactionClient,
    id: number,
    status: "APPROVED" | "REJECTED" | "CANCELLED",
    decisionNote: string | null,
    decidedById: number,
): Promise<LeaveRow> {
    const before = await tx.leaveRequest.findUniqueOrThrow({ where: { id } });
    const row = await tx.leaveRequest.update({
        where: { id },
        data: { status, decisionNote, decidedById, decidedAt: new Date() },
        include: LEAVE_INCLUDE,
    });
    const days = isoDaysBetween(toDateOnlyUtc(before.fromDate), toDateOnlyUtc(before.toDate));
    if (status === "APPROVED") {
        for (const iso of days) {
            const date = new Date(`${iso}T00:00:00.000Z`);
            const existing = await tx.attendanceDay.findUnique({ where: { userId_date: { userId: before.userId, date } }, select: { id: true } });
            if (existing) continue;
            await tx.attendanceDay.create({ data: { userId: before.userId, date, status: "LEAVE", source: "OFFICE", note: leaveTag(id), markedById: decidedById } });
        }
    } else if (before.status === "APPROVED") {
        await tx.attendanceDay.deleteMany({ where: { userId: before.userId, status: "LEAVE", note: leaveTag(id) } });
    }
    return row;
}
