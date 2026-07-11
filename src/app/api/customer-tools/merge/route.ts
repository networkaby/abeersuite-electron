import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, hasPermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { mergeParty, MergeBlockedError, type MergeKind } from "@/modules/customer/lib/convertParty";

const bodySchema = z.object({
    kind: z.enum(["person", "company"]),
    winnerId: z.number().int().positive(),
    loserId: z.number().int().positive(),
});

// POST /api/customer-tools/merge
export async function POST(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;

    if (
        !hasPermission(user, PERMISSIONS.CUSTOMERS_EDIT)
    ) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data, error } = await validateRequest(req, bodySchema);
    if (error) return error;

    try {
        const result = await mergeParty(data.kind as MergeKind, data.winnerId, data.loserId);
        return NextResponse.json(result, { status: 200 });
    } catch (err) {
        if (err instanceof MergeBlockedError) {
            return NextResponse.json({ error: err.message, blockers: err.blockers }, { status: 409 });
        }
        return handleApiError(err, "Failed to merge");
    }
}
