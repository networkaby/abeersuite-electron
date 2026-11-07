import { NextResponse } from "next/server";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { requireIncomingKey } from "@/modules/incoming/lib/incomingApi";
import { AgentCopyError, agentCopySchema, saveAgentCopy } from "@/modules/ecommerce/lib/agentProductCopy";

// POST /api/agent/products/[id]/copy — Claude's Verified copy for one product.
// The server reads Claude's pages itself and checks every fact (Step 4); what
// fails goes to "unsure". Saved as a draft for staff on the product page; an
// Unpublished product becomes Draft. Never publishes.
// Answer: { result: "draft", shopStatus, kept: { specs, highlights }, unsure, flags, note, sources }.

export const maxDuration = 120; // reads up to 8 pages

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
    if (!(await requireIncomingKey(req, "COWORK"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Bad product id" }, { status: 400 });
    const { data, error } = await validateRequest(req, agentCopySchema);
    if (error) return error;
    try {
        const { draft, shopStatus } = await saveAgentCopy(id, data);
        return NextResponse.json({
            result: "draft",
            shopStatus,
            kept: { specs: draft.specs, highlights: draft.highlights, warranty: draft.warranty },
            unsure: draft.unsure,
            flags: draft.flags,
            note: draft.note,
            sources: draft.sources,
        });
    } catch (e) {
        if (e instanceof AgentCopyError) {
            return NextResponse.json({ error: e.message }, { status: e.message === "Product not found" ? 404 : 422 });
        }
        return handleApiError(e, "Failed to save the draft");
    }
}
