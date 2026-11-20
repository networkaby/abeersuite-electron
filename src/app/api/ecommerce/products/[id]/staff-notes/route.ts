import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { AgentCopyError } from "@/modules/ecommerce/lib/agentProductCopy";
import { changeStaffNotes } from "@/modules/ecommerce/lib/agentProductPrep";
import { publishChangeServer } from "@/shared/lib/realtime/serverPublish";

// POST /api/ecommerce/products/[id]/staff-notes — staff / owner instructions for
// the next AI run (owner, 2026-11-20): { add } a note, or { noteId, done } tick it.

const schema = z.union([
    z.object({ add: z.string().trim().min(1).max(500) }),
    z.object({ noteId: z.string().min(1).max(20), done: z.boolean() }),
]);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const mod = await requireModuleAccess("e-commerce");
    if (mod.response) return mod.response;
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Bad product id" }, { status: 400 });
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    try {
        const by = (await prisma.user.findUnique({ where: { id: mod.user.id }, select: { name: true } }))?.name ?? "Staff";
        const out = await changeStaffNotes(id, data, by);
        void publishChangeServer(["catalogue"]);
        return NextResponse.json(out);
    } catch (e) {
        if (e instanceof AgentCopyError) return NextResponse.json({ error: e.message }, { status: 409 });
        return handleApiError(e, "Could not save the note");
    }
}
