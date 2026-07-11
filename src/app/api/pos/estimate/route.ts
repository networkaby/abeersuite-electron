import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { resolveActiveBranchId, BranchAccessError } from "@/shared/lib/auth/activeBranch";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";
import { createPosQuoteVoucher, type PosQuoteBody } from "@/modules/pos/lib/posQuoteVoucher";

/**
 * POST /api/pos/estimate — O2C POS Estimate mode.
 *
 * Creates a POS_ESTIMATE voucher (price-privacy quotation — NO GL, NO stock, NO
 * tenders; carries the tier/manual bill discount + tag-price snapshots) and, when
 * a party is attached, captures a CRM Deal. The customer copy hides discounts by
 * default (see loadEstimateDiscountVisibility); the cashier screen shows them.
 *
 * Gated by the same permission as the POS sale — a cashier needs no deals:manage.
 */
export async function POST(req: NextRequest) {
    const { user, response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW);
    if (response) return response;

    const session = await auth();
    let branchId: string;
    try {
        branchId = resolveActiveBranchId(req, session);
    } catch (e) {
        if (e instanceof BranchAccessError) {
            return NextResponse.json({ error: e.message }, { status: e.code === "forbidden_branch" ? 403 : 400 });
        }
        throw e;
    }

    try {
        const body = (await req.json()) as PosQuoteBody;
        const result = await createPosQuoteVoucher({ type: "POS_ESTIMATE", branchId, userId: user!.id, body });
        return NextResponse.json(result, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to save estimate");
    }
}
