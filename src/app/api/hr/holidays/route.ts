import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, prismaUniqueError, validateRequest } from "@/shared/lib/api";
import { holidayCreateSchema } from "@/shared/lib/schemas/hrAttendanceSchema";
import { toDateOnlyUtc, businessTodayIso } from "@/shared/lib/format/formatDate";
import type { HolidayDto } from "@/modules/hr/lib/attendanceTypes";

// /api/hr/holidays — the shop's holiday list. GET ?year=YYYY (default: this year).

const toDto = (h: { id: number; date: Date; name: string; branchId: string | null }): HolidayDto =>
    ({ id: h.id, date: toDateOnlyUtc(h.date), name: h.name, branchId: h.branchId });

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const year = Number(new URL(req.url).searchParams.get("year") ?? businessTodayIso().slice(0, 4));
        if (!Number.isInteger(year) || year < 2000 || year > 2100) return NextResponse.json({ error: "Bad year" }, { status: 400 });
        const rows = await prisma.holiday.findMany({
            where: { date: { gte: new Date(`${year}-01-01T00:00:00.000Z`), lte: new Date(`${year}-12-31T00:00:00.000Z`) } },
            orderBy: { date: "asc" },
        });
        return NextResponse.json(rows.map(toDto));
    } catch (e) {
        return handleApiError(e, "Failed to fetch holidays");
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.HR_ATTENDANCE_EDIT);
    if (response) return response;
    const { data, error } = await validateRequest(req, holidayCreateSchema);
    if (error) return error;
    try {
        const row = await prisma.holiday.create({
            data: { date: new Date(`${data.date}T00:00:00.000Z`), name: data.name, branchId: data.branchId ?? null },
        });
        return NextResponse.json(toDto(row));
    } catch (e) {
        const conflict = prismaUniqueError(e, "That holiday is already on the list for that day");
        if (conflict) return conflict;
        return handleApiError(e, "Failed to add the holiday");
    }
}
