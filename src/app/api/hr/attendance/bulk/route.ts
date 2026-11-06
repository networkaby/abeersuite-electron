import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { attendanceBulkMarkSchema, type AttendanceStatus } from "@/shared/lib/schemas/hrAttendanceSchema";
import { businessTodayIso } from "@/shared/lib/format/formatDate";
import type { Prisma } from "@/generated/prisma/client";

// POST /api/hr/attendance/bulk { cells: [{ userId, date, status | null }] }
//
// The register's "Bulk mark": the same office mark as PUT /api/hr/attendance,
// on many cells at once, in one transaction and a fixed number of queries per
// distinct mark (not one per cell — AGENTS §7). Same gate as a single mark.
//   status  → the cell becomes a MANUAL office mark; the till's figures on an
//             existing row stay underneath, exactly as a single mark leaves them.
//   null    → a cell the till measured goes back to auto; an office-only cell goes.
// A day on auto (source COUNTER) is left alone — overriding one is a one-by-one
// job on the grid — EXCEPT by a W / H mark: setting an off day's till activity
// aside (testing on the off day) is a bulk job (owner, 2026-11-06).

const dayOf = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const OFF_MARKS: ReadonlySet<AttendanceStatus> = new Set(["WEEKLY_OFF", "HOLIDAY"]);

export async function POST(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.HR_ATTENDANCE_EDIT);
    if (response) return response;
    const { data, error } = await validateRequest(req, attendanceBulkMarkSchema);
    if (error) return error;
    try {
        const today = businessTodayIso();
        if (data.cells.some((c) => c.date > today)) {
            return NextResponse.json({ error: "A day in the future cannot be marked" }, { status: 400 });
        }
        // De-duplicate (last one wins), then group by the mark to write.
        const unique = new Map<string, (typeof data.cells)[number]>();
        for (const c of data.cells) unique.set(`${c.userId}|${c.date}`, c);
        const groups = new Map<AttendanceStatus | null, { userId: number; date: Date }[]>();
        for (const c of unique.values()) {
            const list = groups.get(c.status) ?? [];
            list.push({ userId: c.userId, date: dayOf(c.date) });
            groups.set(c.status, list);
        }

        const ops: Prisma.PrismaPromise<unknown>[] = [];
        for (const [status, cells] of groups) {
            const any: Prisma.AttendanceDayWhereInput = { OR: cells.map((c) => ({ userId: c.userId, date: c.date })) };
            if (status === null) {
                const where: Prisma.AttendanceDayWhereInput = { AND: [any, { source: { not: "COUNTER" } }] };
                ops.push(
                    prisma.attendanceDay.updateMany({
                        where: { AND: [where, { OR: [{ workedMinutes: { gt: 0 } }, { firstInAt: { not: null } }] }] },
                        data:  { status: "PRESENT", source: "COUNTER", manualStatus: null, note: null, markedById: null },
                    }),
                    prisma.attendanceDay.deleteMany({ where: { AND: [where, { workedMinutes: { lte: 0 } }, { firstInAt: null }] } }),
                );
                continue;
            }
            const mark = { status, manualStatus: status, source: "OFFICE", note: null, markedById: user.id };
            ops.push(
                prisma.attendanceDay.updateMany({
                    where: OFF_MARKS.has(status) ? any : { AND: [any, { source: { not: "COUNTER" } }] },
                    data: mark,
                }),
                prisma.attendanceDay.createMany({
                    data: cells.map((c) => ({ userId: c.userId, date: c.date, ...mark })),
                    skipDuplicates: true,
                }),
            );
        }
        await prisma.$transaction(ops);
        return NextResponse.json({ ok: true, count: unique.size });
    } catch (e) {
        return handleApiError(e, "Failed to mark the days");
    }
}
