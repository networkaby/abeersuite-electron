import { NextResponse } from "next/server";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { requireIncomingKey } from "@/modules/incoming/lib/incomingApi";
import { AgentCopyError, addReviewNotes, notesSchema } from "@/modules/ecommerce/lib/agentProductCopy";

// POST /api/agent/products/[id]/notes { notes: [...], replace? } — Claude's review
// mode: notes only, the product is not changed. They become its Attention reason
// (the Attention tab) until staff fix them and Resolve.
// Answer: { notes: <count> }.

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
    if (!(await requireIncomingKey(req, "PRODUCT_COPY"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Bad product id" }, { status: 400 });
    const { data, error } = await validateRequest(req, notesSchema);
    if (error) return error;
    try {
        return NextResponse.json(await addReviewNotes(id, data));
    } catch (e) {
        if (e instanceof AgentCopyError) return NextResponse.json({ error: e.message }, { status: 404 });
        return handleApiError(e, "Failed to save the notes");
    }
}
