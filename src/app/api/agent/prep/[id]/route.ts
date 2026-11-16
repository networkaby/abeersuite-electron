import { NextResponse } from "next/server";
import { handleApiError } from "@/shared/lib/api";
import { requireIncomingKey } from "@/modules/incoming/lib/incomingApi";
import { AgentCopyError } from "@/modules/ecommerce/lib/agentProductCopy";
import { productForPrep } from "@/modules/ecommerce/lib/agentProductPrep";

// GET /api/agent/prep/[id] — product prep's read: product-copy's read plus the
// title, group, shipping, old notes, the last part done and the saved search.
// Same key as product-copy (Claude — Product copy). Skill: .claude/skills/product-prep.

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
    if (!(await requireIncomingKey(req, "PRODUCT_COPY"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Bad product id" }, { status: 400 });
    try {
        const p = await productForPrep(id);
        return p ? NextResponse.json(p) : NextResponse.json({ error: "Product not found" }, { status: 404 });
    } catch (e) {
        if (e instanceof AgentCopyError) return NextResponse.json({ error: e.message }, { status: 422 });
        return handleApiError(e, "Failed to load the product");
    }
}
