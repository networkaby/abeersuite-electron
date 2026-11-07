import { NextResponse } from "next/server";
import { handleApiError } from "@/shared/lib/api";
import { requireIncomingKey } from "@/modules/incoming/lib/incomingApi";
import { productForAgent } from "@/modules/ecommerce/lib/agentProductCopy";

// GET /api/agent/products/[id] — everything the Verified Step 1 needs for one product:
// typed data (a hint, may be wrong), the maker's barcodes, our photo URLs (Skip-for-AI
// photos left out), our support period (never the maker's warranty), the house style
// and the exact keys to write, and the photo kinds for Step 5.

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
    if (!(await requireIncomingKey(req, "COWORK"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Bad product id" }, { status: 400 });
    try {
        const p = await productForAgent(id);
        return p ? NextResponse.json(p) : NextResponse.json({ error: "Product not found" }, { status: 404 });
    } catch (e) {
        return handleApiError(e, "Failed to load the product");
    }
}
