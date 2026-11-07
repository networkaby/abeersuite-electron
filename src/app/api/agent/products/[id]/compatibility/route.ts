import { NextResponse } from "next/server";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { requireIncomingKey } from "@/modules/incoming/lib/incomingApi";
import { AgentCopyError, compatSchema, saveCompatibility } from "@/modules/ecommerce/lib/agentProductCopy";

// POST /api/agent/products/[id]/compatibility { pages, models, labelWebsite? } —
// Claude's compatibility-only mode: the server reads the pages, keeps only the
// models really on them, and puts the list into the product's draft as the
// "Compatible Models" spec (replacing the old list). Nothing else changes.
// Answer: { kept, dropped, sources }.

export const maxDuration = 120;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
    if (!(await requireIncomingKey(req, "PRODUCT_COPY"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Bad product id" }, { status: 400 });
    const { data, error } = await validateRequest(req, compatSchema);
    if (error) return error;
    try {
        return NextResponse.json(await saveCompatibility(id, data));
    } catch (e) {
        if (e instanceof AgentCopyError) return NextResponse.json({ error: e.message }, { status: e.message === "Product not found" ? 404 : 422 });
        return handleApiError(e, "Failed to save the compatible list");
    }
}
