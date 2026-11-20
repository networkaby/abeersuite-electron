import { NextResponse } from "next/server";
import type { z } from "zod";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { requireIncomingKey } from "@/modules/incoming/lib/incomingApi";
import { AgentCopyError } from "@/modules/ecommerce/lib/agentProductCopy";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { publishChangeServer } from "@/shared/lib/realtime/serverPublish";
import { z as zod } from "zod";
import { changeStaffNotes, part1Schema, part2Schema, part3Schema, part4Schema, part5Schema, recordRun, runParts, runSchema, savePart1, savePart2, savePart3, savePart4, savePart5 } from "@/modules/ecommerce/lib/agentProductPrep";

// POST /api/agent/prep/[id]/run | part1 | part2 | part3 | part4 | part5 — product prep's four parts.
// part1 clean the seed · part2 the one search (saved) · part3 process from the
// saved pages → Draft · part4 verify (no internet). Never publishes.

export const maxDuration = 120; // part2 reads up to 8 pages

const PARTS = {
    part1: { schema: part1Schema, run: savePart1 },
    part2: { schema: part2Schema, run: savePart2 },
    part3: { schema: part3Schema, run: savePart3 },
    part4: { schema: part4Schema, run: savePart4 },
    // Photos only (no search, no text) — normally sent with Part 1 through run.
    part5: { schema: part5Schema, run: savePart5 },
    // One call: Parts 1–3 (no description yet) or Parts 1 + 5 (photos) — the usual run.
    run: { schema: runSchema, run: runParts },
    // Report on a staff note (owner, 2026-11-20): done + what was done, or still open + why.
    note: {
        schema: zod.object({ noteId: zod.string().min(1).max(20), done: zod.boolean(), reply: zod.string().trim().min(1).max(500) }),
        run: (id: number, b: { noteId: string; done: boolean; reply: string }) => changeStaffNotes(id, b, "Claude"),
    },
} as const;

export async function POST(req: Request, ctx: { params: Promise<{ id: string; part: string }> }) {
    if (!(await requireIncomingKey(req, "PRODUCT_COPY"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const { id: rawId, part } = await ctx.params;
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Bad product id" }, { status: 400 });
    const def = PARTS[part as keyof typeof PARTS];
    if (!def) return NextResponse.json({ error: "Unknown part — use run, part1, part2, part3, part4, part5 or note" }, { status: 404 });
    const { data, error } = await validateRequest(req, def.schema as z.ZodType<unknown>);
    if (error) return error;
    // Every run of every part leaves its record (owner, 2026-11-20) — refused ones too.
    const isRun = part !== "note";
    const b = data as { part2?: unknown; part5?: unknown };
    const label = part === "run" ? (b.part5 ? "1+5" : b.part2 ? "1+2+3" : "1+3") : part.slice(4);
    const skill = part === "part4" ? "product-recheck" : "product-prep";
    const before = isRun ? await prisma.invProduct.findUnique({ where: { id }, select: { shopStatus: true } }) : null;
    try {
        const out = await (def.run as (id: number, b: unknown) => Promise<unknown>)(id, data);
        if (before) {
            const stopped = (out as { stoppedAt?: number })?.stoppedAt;
            await recordRun(id, skill, stopped ? `${label} (stopped at ${stopped})` : label, before.shopStatus);
        }
        // The AI writes from outside any browser, so nothing announces it (owner, 2026-11-18):
        // an open product form would keep an old photo list and a staff tick would overwrite Part 4.
        void publishChangeServer(["catalogue"]);
        return NextResponse.json(out);
    } catch (e) {
        if (before) await recordRun(id, skill, `${label} · refused: ${e instanceof Error ? e.message.slice(0, 120) : "error"}`, before.shopStatus).catch(() => {});
        if (e instanceof AgentCopyError) return NextResponse.json({ error: e.message }, { status: e.message === "Product not found" ? 404 : 422 });
        return handleApiError(e, "Product prep failed");
    }
}
