import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";

// DELETE /api/hr/holidays/[id]
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.HR_ATTENDANCE_EDIT);
    if (response) return response;
    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    try {
        const { count } = await prisma.holiday.deleteMany({ where: { id } });
        if (count === 0) return NextResponse.json({ error: "Holiday not found" }, { status: 404 });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to remove the holiday");
    }
}
