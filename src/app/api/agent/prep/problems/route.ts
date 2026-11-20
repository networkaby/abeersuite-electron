import { NextResponse } from "next/server";
import { handleApiError } from "@/shared/lib/api";
import { requireIncomingKey } from "@/modules/incoming/lib/incomingApi";
import { findProblems } from "@/modules/ecommerce/lib/agentProductPrep";

// GET /api/agent/prep/problems?q=box back — every product whose open problems
// (AI, staff {…}, set aside) match all the words (owner, 2026-11-20: "check open
// problem where has xyz"). Empty q = every product with an open problem.

export async function GET(req: Request) {
    if (!(await requireIncomingKey(req, "PRODUCT_COPY"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 200);
    try {
        return NextResponse.json(await findProblems(q));
    } catch (e) {
        return handleApiError(e, "Failed to search the problems");
    }
}
