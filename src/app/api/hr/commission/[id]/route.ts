import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";

// DELETE /api/hr/commission/[id] — remove one scheme revision. A month already
// paid is untouched: payroll froze what it earned onto its own line.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.HR_STAFF_EDIT);
    if (response) return response;
    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    try {
        const { count } = await prisma.commissionScheme.deleteMany({ where: { id } });
        if (!count) return NextResponse.json({ error: "Scheme not found" }, { status: 404 });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete the scheme");
    }
}
