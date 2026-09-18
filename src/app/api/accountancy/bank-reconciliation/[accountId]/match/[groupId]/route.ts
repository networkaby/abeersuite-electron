import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { removeMatchGroup } from "@/modules/accountancy/lib/bankReconciliation";
import { accountIdOf, reconError } from "@/modules/accountancy/lib/bankReconRoute";

// DELETE /api/accountancy/bank-reconciliation/[accountId]/match/[groupId]
// Undoes one match action — every statement line and book entry it tied together.
export async function DELETE(_req: Request, { params }: { params: Promise<{ accountId: string; groupId: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_MASTERS_EDIT);
    if (response) return response;
    const p = await params;
    const { id, error: idError } = accountIdOf(p);
    if (idError) return idError;
    if (!/^[0-9a-f-]{36}$/.test(p.groupId)) return NextResponse.json({ error: "Bad match id" }, { status: 400 });
    try {
        return NextResponse.json(await removeMatchGroup(id, p.groupId));
    } catch (e) {
        return reconError(e, "Unmatch failed");
    }
}
