import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { createMatch } from "@/modules/accountancy/lib/bankReconciliation";
import { accountIdOf, reconError } from "@/modules/accountancy/lib/bankReconRoute";

const ids = z.array(z.number().int().positive()).min(1).max(200);
const schema = z.object({ statementLineIds: ids, glLineIds: ids });

// POST /api/accountancy/bank-reconciliation/[accountId]/match
// One match action: N statement lines against M book entries whose signed
// totals agree. All rows share one groupId, which is what Unmatch removes.
export async function POST(req: Request, { params }: { params: Promise<{ accountId: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_MASTERS_EDIT);
    if (response) return response;
    const { id, error: idError } = accountIdOf(await params);
    if (idError) return idError;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    try {
        const result = await createMatch(id, user!.id, [...new Set(data.statementLineIds)], [...new Set(data.glLineIds)]);
        return NextResponse.json(result, { status: 201 });
    } catch (e) {
        return reconError(e, "Match failed");
    }
}
