import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { runAutoMatch } from "@/modules/accountancy/lib/bankReconciliation";
import { accountIdOf, reconError } from "@/modules/accountancy/lib/bankReconRoute";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-mm-dd");
const schema = z.object({
    from: iso,
    to: iso,
});

// POST /api/accountancy/bank-reconciliation/[accountId]/auto-match
// Clears stale matches, then pairs every statement line in the period that has
// exactly one book entry on the same day for the same amount. Ties are left
// for a person.
export async function POST(req: Request, { params }: { params: Promise<{ accountId: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_MASTERS_EDIT);
    if (response) return response;
    const { id, error: idError } = accountIdOf(await params);
    if (idError) return idError;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    try {
        return NextResponse.json(await runAutoMatch(id, user!.id, data.from, data.to));
    } catch (e) {
        return reconError(e, "Auto-match failed");
    }
}
