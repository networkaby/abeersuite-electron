import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError, parseIdParam } from "@/shared/lib/api";
import { resolveProductTax } from "@/modules/inventory/lib/gstResolver";

// GET /api/inventory/products/[id]/resolved-tax
// Returns the effective GST rate, HSN code, and taxability for a product
// by walking: product → group → parent group → … → OrgDefaults.
// Consumed by voucher/invoice/POS line-entry forms to prefill taxRate — so any
// authed staff (anyone who can raise a voucher) may read it.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { id, error } = await parseIdParam(params);
        if (error) return error;
        const resolved = await resolveProductTax(id);
        return NextResponse.json(resolved);
    } catch (e) {
        return handleApiError(e, "Failed to resolve product tax");
    }
}
