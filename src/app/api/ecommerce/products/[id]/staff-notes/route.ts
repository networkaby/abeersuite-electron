import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { AgentCopyError } from "@/modules/ecommerce/lib/agentProductCopy";
import { saveStaffNote } from "@/modules/ecommerce/lib/agentProductPrep";
import { publishChangeServer } from "@/shared/lib/realtime/serverPublish";

// POST /api/ecommerce/products/[id]/staff-notes { text } — the product's manual
// note (owner, 2026-11-20): one Markdown box, saved whole; empty text removes it.
// Each {…} in it is an open problem for the AI.

const schema = z.object({ text: z.string().max(4000) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const mod = await requireModuleAccess("e-commerce");
    if (mod.response) return mod.response;
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Bad product id" }, { status: 400 });
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    try {
        const by = (await prisma.user.findUnique({ where: { id: mod.user.id }, select: { name: true } }))?.name ?? "Staff";
        const out = await saveStaffNote(id, data.text, by);
        void publishChangeServer(["catalogue"]);
        return NextResponse.json(out);
    } catch (e) {
        if (e instanceof AgentCopyError) return NextResponse.json({ error: e.message }, { status: 409 });
        return handleApiError(e, "Could not save the note");
    }
}
