import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { AgentCopyError } from "@/modules/ecommerce/lib/agentProductCopy";
import { setProblemAside } from "@/modules/ecommerce/lib/agentProductPrep";
import { publishChangeServer } from "@/shared/lib/realtime/serverPublish";

// POST /api/ecommerce/products/[id]/problems { text, aside } — the AI notes box's
// "can't fix now" tick (owner, 2026-11-20): set an open problem aside so it stops
// blocking, or bring it back. Kept on the product; the list's "Set aside" tab finds it.

const schema = z.object({ text: z.string().trim().min(1).max(1000), aside: z.boolean() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const mod = await requireModuleAccess("e-commerce");
    if (mod.response) return mod.response;
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Bad product id" }, { status: 400 });
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    try {
        const by = (await prisma.user.findUnique({ where: { id: mod.user.id }, select: { name: true } }))?.name ?? "Staff";
        const out = await setProblemAside(id, data.text, data.aside, by);
        void publishChangeServer(["catalogue"]);
        return NextResponse.json(out);
    } catch (e) {
        if (e instanceof AgentCopyError) return NextResponse.json({ error: e.message }, { status: 409 });
        return handleApiError(e, "Could not save the tick");
    }
}
