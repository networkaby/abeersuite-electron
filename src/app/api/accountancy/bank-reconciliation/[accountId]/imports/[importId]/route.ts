import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { removeImport } from "@/modules/accountancy/lib/bankReconciliation";
import { accountIdOf, reconError } from "@/modules/accountancy/lib/bankReconRoute";

// DELETE /api/accountancy/bank-reconciliation/[accountId]/imports/[importId]
// Removes one upload with its lines; their matches go with them (cascade).
export async function DELETE(_req: Request, { params }: { params: Promise<{ accountId: string; importId: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_MASTERS_EDIT);
    if (response) return response;
    const p = await params;
    const { id, error: idError } = accountIdOf(p);
    if (idError) return idError;
    const importId = Number(p.importId);
    if (!Number.isInteger(importId) || importId <= 0) return NextResponse.json({ error: "Bad upload id" }, { status: 400 });
    try {
        return NextResponse.json(await removeImport(id, importId));
    } catch (e) {
        return reconError(e, "Failed to remove upload");
    }
}
