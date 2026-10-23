"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Send } from "lucide-react";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { channelOf, pendingChannels, postCaption, type PostRow } from "@/modules/campaigns/lib/post";
import { PHONE_POST_CHANNELS, WHATSAPP_PACKAGES } from "@/modules/mobile/lib/mobilePosts";
import MobileHeader from "./MobileHeader";

/** The staff Android app's share add-on (phone-app, NsSharePlugin.java) — absent in a browser. */
type NativeShare = {
    share: (o: { text: string; data?: string; mimeType?: string; fileName?: string; packages?: string[] }) => Promise<void>;
};
const nativeShare = (): NativeShare | null =>
    (window as { Capacitor?: { Plugins?: { NsShare?: NativeShare } } }).Capacitor?.Plugins?.NsShare ?? null;

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** The file as base64, read through our own site (the bucket refuses a script read). */
async function fileBase64(postId: number): Promise<{ data: string; type: string } | null> {
    const res = await fetch(`/api/mobile/posts/${postId}/media`);
    if (!res.ok) return null;
    const blob = await res.blob();
    const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
    });
    return { data, type: blob.type };
}

/**
 * Phone app: posts waiting for WhatsApp (Channel / Status). What is pending
 * shows the moment the screen opens — no timer, no alert (owner, 2026-10-23).
 * Share opens WhatsApp with the photo and caption (the caption is copied too,
 * since WhatsApp can drop it); the person picks our Channel or My status, sends,
 * comes back and presses Done — which keeps who and when.
 */
export default function MobilePosts() {
    const [posts, setPosts] = useState<PostRow[] | null>(null);
    const [open, setOpen] = useState<number | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [now, setNow] = useState(0);

    const load = useCallback(() => {
        fetch("/api/mobile/posts")
            .then(async (r) => {
                if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? `Failed (${r.status})`);
                return r.json() as Promise<{ posts: PostRow[] }>;
            })
            .then((d) => {
                setPosts(d.posts);
                setNow(Date.now());
            })
            .catch((e) => toast.error(extractApiError(e, "Failed to load posts")));
    }, []);
    useEffect(load, [load]);

    async function share(post: PostRow) {
        const text = postCaption(post, COMPANY_DETAILS.sites.shop);
        setBusy(`share-${post.id}`);
        try {
            await navigator.clipboard?.writeText(text).catch(() => {});
            const file = post.mediaKey ? await fileBase64(post.id) : null;
            const native = nativeShare();
            if (native) {
                await native.share({ text, data: file?.data, mimeType: file?.type ?? post.mediaType ?? undefined, fileName: post.mediaName ?? "post", packages: [...WHATSAPP_PACKAGES] });
                return;
            }
            // Phone Chrome (no app): the browser's own share sheet.
            const blob = file ? await (await fetch(`data:${file.type};base64,${file.data}`)).blob() : null;
            const files = blob ? [new File([blob], post.mediaName ?? "post", { type: file!.type })] : [];
            const payload = files.length ? { files, text } : { text };
            if (navigator.share && (!navigator.canShare || navigator.canShare(payload))) await navigator.share(payload);
            else toast.message("Caption copied — open WhatsApp and paste it");
        } catch (e) {
            if ((e as Error)?.name !== "AbortError") toast.error(extractApiError(e, "Could not open WhatsApp"));
        } finally {
            setBusy(null);
        }
    }

    async function markDone(post: PostRow, channel: string) {
        setBusy(`done-${post.id}-${channel}`);
        try {
            const r = await fetch(`/api/mobile/posts/${post.id}/shares`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ channel }),
            });
            if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? `Failed (${r.status})`);
            const saved = (await r.json()) as PostRow;
            toast.success(`Marked done on ${channelOf(channel)?.label ?? channel}`);
            // Gone from the list once nothing is left for WhatsApp.
            setPosts((ps) => (ps ?? []).flatMap((p) => (p.id !== post.id ? [p] : pendingChannels(saved).some((c) => (PHONE_POST_CHANNELS as readonly string[]).includes(c)) ? [saved] : [])));
        } catch (e) {
            toast.error(extractApiError(e, "Failed to save"));
        } finally {
            setBusy(null);
        }
    }

    return (
        <>
            <MobileHeader title="Posts" onRefresh={load} busy={posts === null} />
            <main className="flex flex-1 flex-col gap-3 p-4">
                {posts === null ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
                ) : posts.length === 0 ? (
                    <div className="rounded-2xl border bg-card p-6 text-center">
                        <Check className="mx-auto mb-2 size-8 text-emerald-600" />
                        <p className="font-medium">Nothing to share</p>
                        <p className="text-sm text-muted-foreground">New posts for WhatsApp show here.</p>
                    </div>
                ) : (
                    posts.map((p) => {
                        const waiting = pendingChannels(p).filter((c) => (PHONE_POST_CHANNELS as readonly string[]).includes(c));
                        const due = !!p.scheduledAt && new Date(p.scheduledAt).getTime() <= now;
                        const expanded = open === p.id;
                        return (
                            <section key={p.id} className={`overflow-hidden rounded-2xl border bg-card shadow-sm ${due ? "border-amber-400" : ""}`}>
                                <button type="button" onClick={() => setOpen(expanded ? null : p.id)} className="flex w-full items-start gap-3 p-3 text-left active:bg-muted">
                                    {p.mediaUrl && !p.mediaType?.startsWith("video/") ? (
                                        // eslint-disable-next-line @next/next/no-img-element -- a signed private R2 link
                                        <img src={p.mediaUrl} alt="" className="size-16 shrink-0 rounded-xl bg-muted object-cover" />
                                    ) : (
                                        <div className="size-16 shrink-0 rounded-xl bg-muted" />
                                    )}
                                    <span className="min-w-0 flex-1">
                                        <span className={`block text-xs font-medium ${due ? "text-amber-700" : "text-muted-foreground"}`}>
                                            {p.scheduledAt ? `${due ? "Due · " : ""}${when(p.scheduledAt)}` : "Any time"}
                                        </span>
                                        <span className="line-clamp-2 block text-sm">{p.caption}</span>
                                        <span className="mt-1 block text-xs text-muted-foreground">{waiting.map((c) => channelOf(c)?.label ?? c).join(" · ")}</span>
                                    </span>
                                </button>

                                {expanded && (
                                    <div className="space-y-3 border-t p-3">
                                        {p.mediaUrl &&
                                            (p.mediaType?.startsWith("video/") ? (
                                                <video src={p.mediaUrl} className="w-full rounded-xl bg-black" controls muted playsInline />
                                            ) : (
                                                // eslint-disable-next-line @next/next/no-img-element -- a signed private R2 link
                                                <img src={p.mediaUrl} alt="" className="w-full rounded-xl bg-muted object-contain" />
                                            ))}
                                        <p className="whitespace-pre-line rounded-xl bg-muted/60 p-3 text-sm">{postCaption(p, COMPANY_DETAILS.sites.shop)}</p>
                                        <button
                                            type="button"
                                            disabled={busy !== null}
                                            onClick={() => share(p)}
                                            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 font-semibold text-white active:scale-[.98] disabled:opacity-60"
                                        >
                                            <Send className="size-5" /> {busy === `share-${p.id}` ? "Opening WhatsApp…" : "Share to WhatsApp"}
                                        </button>
                                        <p className="text-xs text-muted-foreground">
                                            In WhatsApp pick {waiting.map((c) => (c === "WA_STATUS" ? "My status" : "our Channel")).join(" or ")} and send. Then come back and press Done.
                                        </p>
                                        <div className="grid grid-cols-2 gap-2">
                                            {waiting.map((c) => (
                                                <button
                                                    key={c}
                                                    type="button"
                                                    disabled={busy !== null}
                                                    onClick={() => markDone(p, c)}
                                                    className="flex h-11 items-center justify-center gap-1.5 rounded-xl border text-sm font-medium active:bg-muted disabled:opacity-60"
                                                >
                                                    <Check className="size-4" /> Done · {channelOf(c)?.short ?? c}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </section>
                        );
                    })
                )}
            </main>
        </>
    );
}
