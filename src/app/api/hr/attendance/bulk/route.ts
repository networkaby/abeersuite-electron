import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { attendanceBulkMarkSchema } from "@/shared/lib/schemas/hrAttendanceSchema";
import { businessTodayIso } from "@/shared/lib/format/formatDate";

// POST /api/hr/attendance/bulk { cells: [{ userId, date }], status | null }
//
// The register's "Bulk mark": the same office mark as PUT /api/hr/attendance,
// on many cells at once, in one transaction and a fixed number of queries
// (not one per cell — AGENTS §7). Same gate as a single mark.
//   status  → every cell becomes a MANUAL office mark; the till's figures on an
//             existing row stay underneath, exactly as a single mark leaves them.
//   null    → a cell the till measured goes back to auto; an office-only cell goes.

const dayOf = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

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
        // De-duplicate, so createMany never sees the same (user, day) twice.
        const seen = new Map<string, { userId: number; date: Date }>();
        for (const c of data.cells) seen.set(`${c.userId}|${c.date}`, { userId: c.userId, date: dayOf(c.date) });
        const cells = [...seen.values()];
        const anyCell = { OR: cells.map((c) => ({ userId: c.userId, date: c.date })) };

        if (data.status === null) {
            await prisma.$transaction([
                prisma.attendanceDay.updateMany({
                    where: { AND: [anyCell, { OR: [{ workedMinutes: { gt: 0 } }, { firstInAt: { not: null } }] }] },
                    data:  { status: "PRESENT", source: "COUNTER", manualStatus: null, note: null, markedById: null },
                }),
                prisma.attendanceDay.deleteMany({
                    where: { AND: [anyCell, { workedMinutes: { lte: 0 } }, { firstInAt: null }] },
                }),
            ]);
            return NextResponse.json({ ok: true, count: cells.length });
        }

        const mark = { status: data.status, manualStatus: data.status, source: "OFFICE" as const, note: null, markedById: user.id };
        await prisma.$transaction([
            prisma.attendanceDay.updateMany({ where: anyCell, data: mark }),
            prisma.attendanceDay.createMany({
                data: cells.map((c) => ({ userId: c.userId, date: c.date, ...mark })),
                skipDuplicates: true,
            }),
        ]);
        return NextResponse.json({ ok: true, count: cells.length });
    } catch (e) {
        return handleApiError(e, "Failed to mark the days");
    }
}
