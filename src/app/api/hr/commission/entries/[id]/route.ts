import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";

// DELETE /api/hr/commission/entries/[id] — take an entry back. A month already
// paid keeps what payroll froze.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.HR_STAFF_EDIT);
    if (response) return response;
    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    try {
        const { count } = await prisma.commissionEntry.deleteMany({ where: { id } });
        if (!count) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete the entry");
    }
}
