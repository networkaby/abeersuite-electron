import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { commissionEntrySchema } from "@/shared/lib/schemas/hrSchema";
import { ensureStaffProfile, dateOnlyFromIso } from "@/modules/hr/lib/staffProfileServer";
import { toEntryDto } from "@/modules/hr/lib/commissionServer";

// POST /api/hr/commission/entries — one thing done outside the app, typed in
// against a MANUAL head: who, which head, the day, how many, a note. It counts
// in the month of its date. hr:staff:edit, like every other commission write.
export async function POST(req: Request) {
    const { user: caller, response } = await requirePermission(PERMISSIONS.HR_STAFF_EDIT);
    if (response) return response;
    const { data: body, error } = await validateRequest(req, commissionEntrySchema);
    if (error) return error;
    try {
        const [user, head] = await Promise.all([
            prisma.user.findUnique({ where: { id: body.userId }, select: { id: true, name: true } }),
            prisma.commissionHead.findUnique({ where: { id: body.headId }, select: { id: true, kind: true } }),
        ]);
        if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
        if (!head) return NextResponse.json({ error: "Head not found" }, { status: 404 });
        if (head.kind !== "MANUAL") return NextResponse.json({ error: "Only a manual-count head takes entries" }, { status: 400 });
        const row = await prisma.$transaction(async (tx) => {
            await ensureStaffProfile(tx, user);
            return tx.commissionEntry.create({
                data: {
                    userId: body.userId,
                    headId: body.headId,
                    date: dateOnlyFromIso(body.date),
                    count: body.count,
                    note: body.note?.trim() || null,
                    createdById: caller.id,
                },
                select: { id: true, userId: true, headId: true, date: true, count: true, note: true },
            });
        });
        return NextResponse.json(toEntryDto(row));
    } catch (e) {
        return handleApiError(e, "Failed to add the entry");
    }
}
