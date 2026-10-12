import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";
import { touchStaffProfile } from "@/modules/hr/lib/staffProfileServer";

// DELETE /api/hr/staff/[userId]/salary/[id] — remove one salary revision.
// Whoever may add a revision may take a wrong one back. A payroll run (later
// phase) will refuse this for a revision a payslip was computed from.

export async function DELETE(_: Request, { params }: { params: Promise<{ userId: string; id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.HR_STAFF_EDIT);
    if (response) return response;

    const p = await params;
    const userId = Number(p.userId);
    const id = Number(p.id);
    if (!Number.isInteger(userId) || userId <= 0 || !Number.isInteger(id) || id <= 0) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    try {
        // Scoped to the user in the URL so a revision cannot be deleted through
        // someone else's record by guessing its id.
        await prisma.$transaction(async (tx) => {
            const { count } = await tx.staffSalary.deleteMany({ where: { id, userId } });
            if (count === 0) throw new Error("NOT_FOUND");
            await touchStaffProfile(tx, userId);
        });
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        if (e?.message === "NOT_FOUND") return NextResponse.json({ error: "Revision not found" }, { status: 404 });
        return handleApiError(e, "Failed to delete the salary revision");
    }
}
