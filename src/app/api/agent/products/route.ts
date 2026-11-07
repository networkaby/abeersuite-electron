import { NextResponse } from "next/server";
import { handleApiError } from "@/shared/lib/api";
import { requireIncomingKey } from "@/modules/incoming/lib/incomingApi";
import { backlogQuery, productBacklog } from "@/modules/ecommerce/lib/agentProductCopy";

// GET /api/agent/products?stage=unpublished|ready|published|draft|all&need=copy|all&limit=20&before=<id>
// — the Cowork agent's backlog for Verified product copy (x-api-key = the "Claude — Product copy" key on
// Settings → Incoming API). Default: active Unpublished products with no description and
// no draft waiting. Newest first; pass nextBefore back as `before` for the next page.

export async function GET(req: Request) {
    if (!(await requireIncomingKey(req, "PRODUCT_COPY"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const q = backlogQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!q.success) return NextResponse.json({ error: q.error.issues[0]?.message ?? "Bad query" }, { status: 400 });
    try {
        return NextResponse.json(await productBacklog(q.data));
    } catch (e) {
        return handleApiError(e, "Failed to load products");
    }
}
