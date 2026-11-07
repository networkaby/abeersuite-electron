import { NextResponse } from "next/server";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { requireIncomingKey } from "@/modules/incoming/lib/incomingApi";
import { AgentCopyError, readPageForAgent, readPageSchema } from "@/modules/ecommerce/lib/agentProductCopy";

// POST /api/agent/read-page { productId, url, labelWebsite? } — for Claude (the
// "Claude — Product copy" key) when a maker's or seller's page blocks it: the
// server reads it through its own path (plain download, then the Read page keys
// on AI Setup). Maker / known sellers only. Answer: { read, site, maker,
// codeMatch, text, photos } or { read: false, why }.

export const maxDuration = 60;

export async function POST(req: Request) {
    if (!(await requireIncomingKey(req, "PRODUCT_COPY"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const { data, error } = await validateRequest(req, readPageSchema);
    if (error) return error;
    try {
        return NextResponse.json(await readPageForAgent(data));
    } catch (e) {
        if (e instanceof AgentCopyError) return NextResponse.json({ error: e.message }, { status: 404 });
        return handleApiError(e, "Could not read the page");
    }
}
