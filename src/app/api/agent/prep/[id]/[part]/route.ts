import { NextResponse } from "next/server";
import type { z } from "zod";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { requireIncomingKey } from "@/modules/incoming/lib/incomingApi";
import { AgentCopyError } from "@/modules/ecommerce/lib/agentProductCopy";
import { part1Schema, part2Schema, part3Schema, part4Schema, part5Schema, runParts, runSchema, savePart1, savePart2, savePart3, savePart4, savePart5 } from "@/modules/ecommerce/lib/agentProductPrep";

// POST /api/agent/prep/[id]/run | part1 | part2 | part3 | part4 | part5 — product prep's four parts.
// part1 clean the seed · part2 the one search (saved) · part3 process from the
// saved pages → Draft · part4 verify (no internet). Never publishes.

export const maxDuration = 120; // part2 reads up to 8 pages

const PARTS = {
    part1: { schema: part1Schema, run: savePart1 },
    part2: { schema: part2Schema, run: savePart2 },
    part3: { schema: part3Schema, run: savePart3 },
    part4: { schema: part4Schema, run: savePart4 },
    // Touch-up: photos and small fixes, no search, no rewrite.
    part5: { schema: part5Schema, run: savePart5 },
    // Parts 1–3 in one call — the usual run; the parts above restart a run part-way.
    run: { schema: runSchema, run: runParts },
} as const;

export async function POST(req: Request, ctx: { params: Promise<{ id: string; part: string }> }) {
    if (!(await requireIncomingKey(req, "PRODUCT_COPY"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const { id: rawId, part } = await ctx.params;
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Bad product id" }, { status: 400 });
    const def = PARTS[part as keyof typeof PARTS];
    if (!def) return NextResponse.json({ error: "Unknown part — use run, part1, part2, part3, part4 or part5" }, { status: 404 });
    const { data, error } = await validateRequest(req, def.schema as z.ZodType<unknown>);
    if (error) return error;
    try {
        return NextResponse.json(await (def.run as (id: number, b: unknown) => Promise<unknown>)(id, data));
    } catch (e) {
        if (e instanceof AgentCopyError) return NextResponse.json({ error: e.message }, { status: e.message === "Product not found" ? 404 : 422 });
        return handleApiError(e, "Product prep failed");
    }
}
