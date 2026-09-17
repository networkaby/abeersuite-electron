import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { requirePosVoucher } from "@/shared/lib/auth/permissions";
import { requireWritableBranchId, BranchAccessError } from "@/shared/lib/auth/activeBranch";
import { branchAccessResponse } from "@/shared/lib/api/branchAccessResponse";
import { handleApiError } from "@/shared/lib/api";
import { createPosQuoteVoucher, type PosQuoteBody } from "@/modules/pos/lib/posQuoteVoucher";
import { ServiceLineError } from "@/shared/lib/accountancy/serviceCharges";
import { requestBusinessDate } from "@/shared/lib/api/requestBusinessDate";

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
    const { user, response } = await requirePosVoucher("estimate", "create");
    if (response) return response;

    const session = await auth();
    let branchId: string;
    try {
        branchId = requireWritableBranchId(req, session);
    } catch (e) {
        if (e instanceof BranchAccessError) return branchAccessResponse(e);
        throw e;
    }

    try {
        const body = (await req.json()) as PosQuoteBody;
        const result = await createPosQuoteVoucher({ type: "POS_ESTIMATE", branchId, userId: user!.id, body, today: requestBusinessDate(req) });
        return NextResponse.json(result, { status: 201 });
    } catch (e) {
        // A service switched off since the screen loaded is the cashier's to fix
        // (remove the line), not a server fault — say so instead of "Failed to save estimate".
        if (e instanceof ServiceLineError) return NextResponse.json({ error: e.message, code: e.code }, { status: 422 });
        return handleApiError(e, "Failed to save estimate");
    }
}
