import "server-only";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { incomingSettings } from "@/modules/incoming/lib/incomingApi";
import { googlePostMode, type GooglePostMode } from "@/modules/incoming/lib/incomingCatalog";

/**
 * The Cowork agent's side of Campaigns → Posts (/api/agent/posts…). Same key as
 * its review replies (Settings → Incoming API → Google Business API). Its posts carry
 * no staff id and the name below, so the queue shows who made them and the
 * agent can only change its own — and only until any channel has them.
 */

export const AGENT_NAME = "Cowork agent";

export const agentPostMode = async (): Promise<GooglePostMode> => googlePostMode(await incomingSettings("COWORK"));

/**
 * The status the agent's post may take. Mode Draft: always DRAFT, its times
 * kept as the plan (no job picks a draft). Mode Schedule: what the times say,
 * unless the agent itself asked for a draft.
 */
export function agentStatus(mode: GooglePostMode, parsed: "DRAFT" | "SCHEDULED", asked: unknown): "DRAFT" | "SCHEDULED" {
    return mode === "DRAFT" || asked === "DRAFT" ? "DRAFT" : parsed;
}

/** What the agent may leave out of a post; the office editor always sends these. */
const POST_DEFAULTS = { link: "", scheduledAt: null, googleType: "UPDATE", googleButton: null, campaignId: null, status: "DRAFT", variants: {} };

/**
 * Read the agent's post body against the office schema (`postSchema` /
 * `newPostSchema`), its left-out fields filled in. The error names the field,
 * so the agent can fix it. `asked` is the status it sent, before the times decide.
 */
export async function readAgentPost<T>(req: Request, schema: z.ZodType<T>): Promise<{ data: T; asked: unknown; error: null } | { data: null; asked: null; error: NextResponse }> {
    const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") return { data: null, asked: null, error: NextResponse.json({ error: "Send the post as a JSON object" }, { status: 400 }) };
    const parsed = schema.safeParse({ ...POST_DEFAULTS, ...raw });
    if (!parsed.success) {
        const i = parsed.error.issues[0];
        return { data: null, asked: null, error: NextResponse.json({ error: i ? `${i.path.join(".") || "body"}: ${i.message}` : "Invalid post" }, { status: 400 }) };
    }
    return { data: parsed.data, asked: raw.status, error: null };
}

/** The agent's own post, not yet out anywhere — or why not, as a response. */
export async function ownOpenPost(id: number): Promise<{ error: NextResponse } | { error: null }> {
    const p = await prisma.post.findUnique({ where: { id }, select: { createdById: true, createdByName: true, _count: { select: { shares: true } } } });
    if (!p) return { error: NextResponse.json({ error: "Post not found" }, { status: 404 }) };
    if (p.createdById !== null || p.createdByName !== AGENT_NAME) return { error: NextResponse.json({ error: "Only the agent's own posts can be changed here." }, { status: 403 }) };
    if (p._count.shares > 0) return { error: NextResponse.json({ error: "Already out on a channel — staff change it now." }, { status: 409 }) };
    return { error: null };
}
