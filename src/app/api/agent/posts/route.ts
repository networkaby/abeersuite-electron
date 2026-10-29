import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError } from "@/shared/lib/api";
import { incomingSettings, requireIncomingKey } from "@/modules/incoming/lib/incomingApi";
import { coworkPostMode, coworkPostRules } from "@/modules/incoming/lib/incomingCatalog";
import { CHANNEL_SPECS, GOOGLE_BUTTONS, GOOGLE_POST_TYPES, POST_CHANNELS, POST_SELECT, newPostSchema } from "@/modules/campaigns/lib/post";
import { copyProductPhoto, loadPost, withMediaLinks } from "@/modules/campaigns/lib/postServer";
import { AGENT_NAME, agentStatus, readAgentPost } from "@/modules/campaigns/lib/agentPosts";

/**
 * GET  /api/agent/posts — for the Cowork agent (x-api-key = the Cowork key on
 *      Settings → Incoming API): the post mode and rules set there, every
 *      channel's limits and best photo shape, and the queue (drafts and
 *      scheduled, soonest first, then the last 20 done) so it plans around it.
 * POST /api/agent/posts — make a post. Body as the office editor's:
 *      { caption, channels[], scheduledAt?, link?, googleType?, googleButton?,
 *        variants?: { CHANNEL: { caption?, scheduledAt?, photos? } }, status?,
 *        fromProductId? } — times are ISO with offset (+05:30). In Draft mode it
 *      is kept as a draft whatever the times say. Photos go on next, through
 *      ./{id}/photos. Answer: the post, `mode`, `photoNote` when a product photo was skipped.
 */

export async function GET(req: Request) {
    if (!(await requireIncomingKey(req, "COWORK"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    try {
        const [open, done, settings] = await Promise.all([
            prisma.post.findMany({ where: { status: { not: "DONE" } }, select: POST_SELECT, orderBy: [{ scheduledAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }], take: 100 }),
            prisma.post.findMany({ where: { status: "DONE" }, select: POST_SELECT, orderBy: { updatedAt: "desc" }, take: 20 }),
            incomingSettings("COWORK"),
        ]);
        return NextResponse.json({
            mode: coworkPostMode(settings),
            rules: coworkPostRules(settings),
            note: "Draft mode: your posts wait for staff to schedule. Change or delete only your own posts, before any channel has them.",
            channels: POST_CHANNELS.filter((c) => c.ready).map((c) => ({
                value: c.value,
                label: c.label,
                postsByItself: c.mode === "AUTO" || c.value === "GOOGLE_BUSINESS",
                ...CHANNEL_SPECS[c.value],
            })),
            googleTypes: GOOGLE_POST_TYPES.map((t) => t.value),
            googleButtons: GOOGLE_BUTTONS.map((b) => b.value),
            posts: [...open, ...done].map((p) => ({ ...withMediaLinks(p), mine: p.createdByName === AGENT_NAME })),
        });
    } catch (e) {
        return handleApiError(e, "Failed to load the posts");
    }
}

export async function POST(req: Request) {
    if (!(await requireIncomingKey(req, "COWORK"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const { data, asked, error } = await readAgentPost(req, newPostSchema);
    if (error) return error;
    const { fromProductId, ...fields } = data;
    try {
        const mode = coworkPostMode(await incomingSettings("COWORK"));
        const row = await prisma.post.create({
            data: { ...fields, status: agentStatus(mode, fields.status as "DRAFT" | "SCHEDULED", asked), createdById: null, createdByName: AGENT_NAME },
            select: { id: true },
        });
        const photoNote = fromProductId ? await copyProductPhoto(row.id, fromProductId) : null;
        return NextResponse.json({ mode, photoNote, post: await loadPost(row.id) });
    } catch (e) {
        return handleApiError(e, "Failed to save the post");
    }
}
