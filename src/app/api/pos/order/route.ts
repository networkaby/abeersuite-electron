import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { resolveActiveBranchId, BranchAccessError } from "@/shared/lib/auth/activeBranch";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";
import { createPosQuoteVoucher, type PosQuoteBody } from "@/modules/pos/lib/posQuoteVoucher";

/**
 * POST /api/pos/order — O2C POS Order mode.
 *
 * Creates a POS_ORDER voucher (counter order — deliver-later / book-and-collect;
 * NO GL, NO stock; reservation + pipeline are Phase 2/3) and captures a CRM Deal
 * when a party is attached. The order print shows the real (discounted) price.
 *
 * Gated by the same permission as the POS sale.
 */
export async function POST(req: NextRequest) {
    const { user, response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
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
        const result = await createPosQuoteVoucher({ type: "POS_ORDER", branchId, userId: user!.id, body });
        return NextResponse.json(result, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to save order");
    }
}
