import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError, parseIdParam } from "@/shared/lib/api";
import { CHANNEL_SPECS, POST_MEDIA_MAX_BYTES, type PostChannel, type PostVariants } from "@/modules/campaigns/lib/post";
import { loadPost } from "@/modules/campaigns/lib/postServer";
import { PhotoFitError, attachPostPhoto, fitPostPhoto } from "@/modules/campaigns/lib/postPhotoFit";
import { agentGate, ownOpenPost } from "@/modules/campaigns/lib/agentPosts";

/**
 * POST /api/agent/posts/:id/photos — the Cowork agent adds a photo (or MP4) to
 * one of its own posts. Either multipart form-data (`file`, plus the fields
 * below as text) or JSON with `url` — an https link the server reads once.
 *   channel  give it to that channel only (its copy's photos, in order)
 *   extra    keep it beside the main photo (default: main when there is none)
 *   fit      after adding, cut the main photo to every ticked channel's shape
 * Answer: { post, fitted? }.
 */

const fields = z.object({
    url: z.string().url().startsWith("https://").max(2000).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    channel: z.string().refine((c) => c in CHANNEL_SPECS, "Unknown channel").optional(),
    extra: z.boolean().optional(),
    fit: z.boolean().optional(),
});

const bool = (v: FormDataEntryValue | null) => (v === null ? undefined : v === "true" || v === "1");

async function readBody(req: Request): Promise<{ file: { bytes: ArrayBuffer; type: string; name: string }; opts: z.infer<typeof fields> } | string> {
    if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
        const form = await req.formData();
        const file = form.get("file");
        if (!(file instanceof File)) return "Send the photo as the `file` field.";
        const opts = fields.safeParse({
            name: (form.get("name") as string | null) ?? undefined,
            channel: (form.get("channel") as string | null) ?? undefined,
            extra: bool(form.get("extra")),
            fit: bool(form.get("fit")),
        });
        if (!opts.success) return opts.error.issues[0]?.message ?? "Bad fields";
        return { file: { bytes: await file.arrayBuffer(), type: file.type, name: opts.data.name ?? file.name }, opts: opts.data };
    }
    const opts = fields.safeParse(await req.json().catch(() => null));
    if (!opts.success) return opts.error.issues[0]?.message ?? "Send { url } or a multipart file.";
    if (!opts.data.url) return "Send `url` (https) or a multipart `file`.";
    const res = await fetch(opts.data.url, { headers: { Accept: "image/jpeg,image/png,image/webp,video/mp4" } });
    if (!res.ok) return `Could not read the link (${res.status}).`;
    if (Number(res.headers.get("content-length") ?? 0) > POST_MEDIA_MAX_BYTES) return "Too large — keep it under 16 MB.";
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    const fromUrl = new URL(opts.data.url).pathname.split("/").pop() || "photo";
    return { file: { bytes: await res.arrayBuffer(), type, name: opts.data.name ?? fromUrl }, opts: opts.data };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const denied = await agentGate(req);
    if (denied) return denied;
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;
    const own = await ownOpenPost(id);
    if (own.error) return own.error;
    try {
        const body = await readBody(req);
        if (typeof body === "string") return NextResponse.json({ error: body }, { status: 400 });
        const { file, opts } = body;
        const photo = await attachPostPhoto(id, file, opts.extra ?? !!opts.channel);

        if (opts.channel) {
            const row = await prisma.post.findUnique({ where: { id }, select: { variants: true, mediaKey: true } });
            const variants = { ...((row?.variants ?? {}) as PostVariants) };
            const v = variants[opts.channel] ?? { caption: null, scheduledAt: null, photos: null };
            const max = CHANNEL_SPECS[opts.channel as PostChannel].photosMax;
            // Its first own photo replaces "the main photo"; later ones add on.
            const photos = photo.key === row?.mediaKey ? v.photos : [...(v.photos ?? []), photo.key].slice(-max);
            variants[opts.channel] = { ...v, photos };
            await prisma.post.update({ where: { id }, data: { variants } });
        }
        if (opts.fit) return NextResponse.json(await fitPostPhoto(id));
        return NextResponse.json({ post: await loadPost(id) });
    } catch (e) {
        if (e instanceof PhotoFitError) return NextResponse.json({ error: e.message }, { status: 400 });
        return handleApiError(e, "Failed to add the photo");
    }
}
