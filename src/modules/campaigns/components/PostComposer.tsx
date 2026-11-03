"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { SquarePen, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import {
    productPostCaption,
    type PhotoCrop,
    type PostInput,
    type PostProduct,
    type PostRow,
} from "@/modules/campaigns/lib/post";
import CampaignsHeader from "./CampaignsHeader";
import PostProductPicker, { loadPostProducts } from "./PostProductPicker";
import PostPlatformCards, { type CopyForm } from "./PostPlatformCards";
import PostMaterials from "./PostMaterials";
import { toLocalInput } from "@/modules/campaigns/lib/campaign";
import { fitPostPhoto, uploadPostFile } from "@/modules/campaigns/lib/postUpload";
import { takesMedia, variantEmpty } from "@/modules/campaigns/lib/post";

type Form = Omit<PostInput, "caption" | "link" | "hashtags" | "scheduledAt" | "variants"> & { caption: string; link: string; hashtags: string; scheduledAt: string; variants: Record<string, CopyForm> };

const blank: Form = { caption: "", link: "", hashtags: "", channels: ["WA_CHANNEL", "GOOGLE_BUSINESS"], scheduledAt: "", googleType: "UPDATE", googleButton: "SHOP", campaignId: null, status: "DRAFT", variants: {} };


const fromRow = (p: PostRow): Form => ({
    caption: p.caption,
    link: p.link ?? "",
    hashtags: p.hashtags ?? "",
    channels: p.channels as Form["channels"],
    scheduledAt: toLocalInput(p.scheduledAt),
    googleType: p.googleType,
    googleButton: p.googleButton,
    campaignId: p.campaignId,
    status: p.status === "SCHEDULED" ? "SCHEDULED" : "DRAFT",
    variants: Object.fromEntries(
        Object.entries(p.variants).flatMap(([c, v]) => (v ? [[c, { caption: v.caption, scheduledAt: v.scheduledAt ? toLocalInput(v.scheduledAt) : null, photos: v.photos, hashtags: v.hashtags ?? null, background: v.background ?? null, coverMs: v.coverMs ?? null, alt: v.alt ?? null }]] : [])),
    ),
});

const iso = (local: string | null) => (local ? new Date(local).toISOString() : null);


/**
 * Write one post for several channels. Photos can be picked before the first
 * save — they upload on Save, and "Fit for each channel" then cuts the main one
 * to every channel's shape; per-channel Share / Done appear below once saved.
 * Instagram cannot go out without a photo, so a timed post refuses to save
 * without one. A time puts it on the calendar as
 * Scheduled; no time keeps it a draft to share whenever. A new post can start
 * from a shop product (`startProductId`, or "From a product"): its text and link
 * fill in, and saving copies its photo in.
 */
export default function PostComposer({
    postId,
    startAt = null,
    startProductId = null,
}: {
    postId: number | null;
    startAt?: string | null;
    startProductId?: number | null;
}) {
    const router = useRouter();
    const [post, setPost] = useState<PostRow | null>(null);
    const [form, setForm] = useState<Form>(() => ({ ...blank, scheduledAt: toLocalInput(startAt) }));
    const [campaigns, setCampaigns] = useState<{ value: number; label: string }[]>([]);
    const [loading, setLoading] = useState(postId !== null);
    // false, or what the Save button says while it works ("Saving…", "Uploading photos…", "Fitting photos…").
    const [saving, setSaving] = useState<string | false>(false);
    const [picking, setPicking] = useState(false);
    const [fromProduct, setFromProduct] = useState<PostProduct | null>(null);
    // A new post's photos, held until the first save; the first is the main one.
    const [pending, setPending] = useState<File[]>([]);
    const [fitOnSave, setFitOnSave] = useState(true);
    // A new post's photo for one platform only (its card's Upload), held until the first save.
    const [cardFiles, setCardFiles] = useState<Record<string, File>>({});
    // A new post: which Master photo a platform takes instead of the main one, held until the first save.
    const [prePick, setPrePick] = useState<Record<string, File[]>>({});

    useEffect(() => {
        if (postId === null) return;
        axios
            .get<PostRow>(`/api/campaigns/posts/${postId}`)
            .then((r) => {
                setPost(r.data);
                setForm(fromRow(r.data));
            })
            .catch((e) => toast.error(extractApiError(e, "Failed to load the post")))
            .finally(() => setLoading(false));
    }, [postId]);

    useEffect(() => {
        // Linking a campaign needs the Campaigns tick; without it the picker just stays empty.
        axios
            .get<{ campaigns: { id: number; name: string; status: string }[] }>("/api/campaigns")
            .then((r) => setCampaigns(r.data.campaigns.map((c) => ({ value: c.id, label: c.name }))))
            .catch(() => setCampaigns([]));
    }, []);

    useEffect(() => {
        // "Make a post" on a shop product opens here with it already picked.
        if (startProductId === null) return;
        loadPostProducts()
            .then((list) => {
                const p = list.find((x) => x.id === startProductId);
                if (p) pickProduct(p);
                else toast.error("That product is not on the shop now — pick another or write the post.");
            })
            .catch((e) => toast.error(extractApiError(e, "Failed to load the shop products")));
    }, [startProductId]);

    function pickProduct(p: PostProduct) {
        setFromProduct(p);
        setForm((f) => ({ ...f, caption: productPostCaption(p), link: p.path }));
        setPicking(false);
    }

    const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
    const toggle = (v: Form["channels"][number]) =>
        set("channels", form.channels.includes(v) ? form.channels.filter((c) => c !== v) : [...form.channels, v]);

    /** The server changed some channels' photos: take the post, and those channels' picks, without touching unsaved words. */
    function tookPhotos(row: PostRow, channels: string[]) {
        setPost(row);
        setForm((f) => {
            const variants = { ...f.variants };
            for (const c of channels) {
                const photos = row.variants[c]?.photos ?? null;
                const v = { ...(variants[c] ?? { caption: null, scheduledAt: null }), photos };
                if (variantEmpty(v)) delete variants[c];
                else variants[c] = v;
            }
            return { ...f, variants };
        });
    }

    /** Fit (every channel, or some) or Adjust (one channel, a frame) — the cut is made on the server. */
    async function fit(opts: { channels?: string[]; key?: string; crop?: PhotoCrop | null } = {}) {
        if (!post) return;
        try {
            const r = await fitPostPhoto(post.id, opts);
            tookPhotos(r.post, Object.keys(r.fitted));
            toast.success(opts.crop ? "Photo cut to your frame" : Object.keys(r.fitted).length > 1 ? "Photo fitted for each channel" : "Photo fitted");
        } catch (e) {
            toast.error(extractApiError(e, "Could not fit the photo"));
        }
    }

    /** A platform card's own photo: held until the first save, uploaded at once after. */
    async function cardUpload(channel: string, file: File) {
        if (!post) return setCardFiles((m) => ({ ...m, [channel]: file }));
        try {
            tookPhotos(await uploadPostFile(post.id, file, true, channel), [channel]);
            toast.success("Photo added for this platform");
        } catch (e) {
            toast.error(extractApiError(e, "Upload failed"));
        }
    }

    const hasPhoto = (c: string) => !!post?.mediaKey || pending.length > 0 || !!fromProduct?.imageUrl || !!cardFiles[c];
    const timed = !!form.scheduledAt || Object.values(form.variants).some((v) => v.scheduledAt);
    const scheduled = post?.status === "SCHEDULED";
    // Platforms already out (some can be posted while others wait for later).
    const posted = post ? form.channels.filter((c) => post.shares.some((sh) => sh.channel === c)).length : 0;

    /**
     * "Save as draft" keeps the whole set — Master and every platform's own
     * text, time and photos — to continue later; nothing goes out, times or no
     * times. "Schedule" lets the times stand: each platform still waiting goes
     * out at its time (platforms already posted stay posted).
     */
    async function save(as: "DRAFT" | "SCHEDULED") {
        if (as === "SCHEDULED" && !timed) {
            toast.error("Set a time first — in Master's Schedule time, or on a platform's own Time.");
            return;
        }
        if (as === "SCHEDULED" && form.channels.includes("INSTAGRAM") && !hasPhoto("INSTAGRAM")) {
            toast.error("Instagram needs a photo — add one, or untick Instagram, before scheduling.");
            return;
        }
        setSaving("Saving…");
        const variants = Object.fromEntries(
            // Every platform's own copy, switched on or off — off only means "not now".
            Object.entries(form.variants).map(([c, v]) => [c, { caption: v.caption?.trim() || null, scheduledAt: iso(v.scheduledAt), photos: v.photos, hashtags: v.hashtags === null || v.hashtags === undefined ? null : v.hashtags.trim(), background: v.background ?? null, coverMs: v.coverMs ?? null, alt: v.alt?.trim() || null }]),
        );
        const body = {
            ...form,
            variants,
            scheduledAt: iso(form.scheduledAt),
            status: as,
        };
        try {
            if (post) {
                const r = await axios.patch<PostRow>(`/api/campaigns/posts/${post.id}`, body);
                setPost(r.data);
                setForm(fromRow(r.data));
                toast.success(as === "SCHEDULED" ? "Scheduled — each waiting platform goes out at its time" : "Saved as draft — nothing goes out until you schedule it");
            } else {
                // Photos picked here win over the product's own. With photos to
                // upload it stays a draft until they are in, so the job never
                // sends it text-only (post 7 went to Google without its photo).
                const hasUploads = pending.length > 0 || Object.keys(cardFiles).length > 0;
                const r = await axios.post<PostRow & { photoNote?: string | null }>("/api/campaigns/posts", {
                    ...body,
                    status: hasUploads ? "DRAFT" : as,
                    fromProductId: pending.length ? null : (fromProduct?.id ?? null),
                });
                const id = r.data.id;
                let note = r.data.photoNote ?? null;
                let main = pending.length ? pending[0].type : r.data.mediaKey ? "image/" : null;
                if (pending.length) setSaving("Uploading photos…");
                const keyOf = new Map<File, string>();
                let photoFailed = false;
                try {
                    for (const [i, f] of pending.entries()) {
                        const row = await uploadPostFile(id, f, i > 0);
                        const k = i === 0 ? row.mediaKey : row.extraMedia[row.extraMedia.length - 1]?.key;
                        if (k) keyOf.set(f, k);
                    }
                } catch (e) {
                    note = extractApiError(e, "A photo did not upload — add it below.");
                    main = null;
                    photoFailed = true;
                }
                // Channels with a photo of their own keep it; the rest get the main one fitted.
                const ownMedia = (c: string) => {
                    const mine = (prePick[c] ?? []).filter((f) => pending.includes(f));
                    if (mine.length) return mine;
                    // The main photo is not something this platform carries (a reel and a photo): its first usable one.
                    const first = pending.find((f) => takesMedia(c, f.type));
                    return pending[0] && !takesMedia(c, pending[0].type) && first ? [first] : [];
                };
                const keysOf = (c: string) => ownMedia(c).flatMap((f) => (keyOf.has(f) ? [keyOf.get(f)!] : []));
                const picked = form.channels.filter((c) => !cardFiles[c] && keysOf(c).length > 0);
                const toFit = form.channels.filter((c) => !cardFiles[c] && !picked.includes(c));
                if (fitOnSave && main?.startsWith("image/") && !note && toFit.length) {
                    setSaving("Fitting photos for each channel…");
                    try {
                        await fitPostPhoto(id, { channels: toFit });
                    } catch (e) {
                        note = extractApiError(e, "Could not fit the photo — use Fit on each channel.");
                    }
                }
                // A platform that picked another Master photo gets that one, cut to its shape.
                for (const c of picked) {
                    try {
                        await fitPostPhoto(id, { channels: [c], keys: keysOf(c) });
                    } catch (e) {
                        note = extractApiError(e, "A platform's picked photo could not be fitted — pick it again on its card.");
                    }
                }
                const own = Object.entries(cardFiles).filter(([c]) => (form.channels as string[]).includes(c));
                if (own.length) setSaving("Uploading platform photos…");
                for (const [c, f] of own) {
                    try {
                        await uploadPostFile(id, f, true, c);
                    } catch (e) {
                        note = extractApiError(e, "A platform's photo did not upload — add it on its card.");
                        photoFailed = true;
                    }
                }
                // A failed upload leaves a draft; a failed fit still schedules (the photo is on).
                let draftKept = false;
                // No time = "share now": it was never going to be scheduled.
                if (hasUploads && as === "SCHEDULED" && r.data.scheduledAt) {
                    if (photoFailed) draftKept = true;
                    else {
                        try {
                            await axios.post(`/api/campaigns/posts/${id}`);
                        } catch (e) {
                            note = extractApiError(e, "Could not schedule it.");
                            draftKept = true;
                        }
                    }
                }
                if (draftKept) toast.warning(`Saved as a draft, not scheduled. ${note} Then press Schedule.`);
                else if (note) toast.warning(`Post saved. ${note}`);
                else toast.success(as === "SCHEDULED" ? "Scheduled — each platform goes out at its time" : "Saved as draft — continue any time, nothing goes out yet");
                router.replace(`/office/campaigns/posts/${id}`);
            }
        } catch (e) {
            toast.error(extractApiError(e, "Failed to save the post"));
        } finally {
            setSaving(false);
        }
    }

    async function remove() {
        if (!post) return;
        if (!(await confirmAction({ title: "Delete this post?", body: "Its photo and posted record go too. This cannot be undone.", confirmLabel: "Delete" }))) return;
        try {
            await axios.delete(`/api/campaigns/posts/${post.id}`);
            toast.success("Post deleted");
            router.push("/office/campaigns/posts");
        } catch (e) {
            toast.error(extractApiError(e, "Failed to delete the post"));
        }
    }

    return (
        <ScrollArea className="h-full" type="always">
            <div className="mx-auto max-w-7xl space-y-5 px-6 pt-4 pb-10">
                <CampaignsHeader
                    icon={SquarePen}
                    title={post ? "Edit post" : "New post"}
                    description="Write the idea once, then shape it per channel — its own words, time and photos. Share gets each one ready."
                />

                {loading ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
                ) : (
                        <PostPlatformCards
                            head={<PostMaterials
                            caption={form.caption}
                            link={form.link}
                            onCaption={(v) => set("caption", v)}
                            onLink={(v) => set("link", v)}
                            post={post}
                            onPostChanged={setPost}
                            pending={pending}
                            onPending={setPending}
                            fitOnSave={fitOnSave}
                            onFitOnSave={setFitOnSave}
                            fromProduct={fromProduct}
                            onPickProduct={() => setPicking(true)}
                            onClearProduct={() => setFromProduct(null)}
                            channels={form.channels}
                            onToggleChannel={(c) => toggle(c as Form["channels"][number])}
                            when={form.scheduledAt}
                            onWhen={(v) => set("scheduledAt", v)}
                            hashtags={form.hashtags}
                            onHashtags={(v) => set("hashtags", v)}
                            campaigns={campaigns}
                            campaignId={form.campaignId ?? null}
                            onCampaign={(v) => set("campaignId", v)}
                        />}
                            channels={form.channels}
                            onToggle={(c) => toggle(c as Form["channels"][number])}
                            copies={form.variants}
                            master={{ caption: form.caption, hashtags: form.hashtags, scheduledAt: form.scheduledAt, link: form.link.trim() }}
                            post={post}
                            onFit={fit}
                            onPostChanged={setPost}
                            onUpload={cardUpload}
                            cardFiles={cardFiles}
                            onDropCardFile={(c) => setCardFiles(({ [c]: _drop, ...rest }) => rest)}
                            prePick={prePick}
                            onPrePick={(c, files) => setPrePick(({ [c]: _old, ...rest }) => (files ? { ...rest, [c]: files } : rest))}
                            pending={pending}
                            productImage={fromProduct?.imageUrl ?? null}
                            google={{ type: form.googleType, button: form.googleButton ?? null }}
                            onGoogle={(g) =>
                                setForm((f) => ({
                                    ...f,
                                    ...(g.type !== undefined ? { googleType: g.type } : {}),
                                    ...(g.button !== undefined ? { googleButton: g.button } : {}),
                                }))
                            }
                            onChange={(c, copy) =>
                                setForm((f) => {
                                    const variants = { ...f.variants };
                                    if (copy) variants[c] = copy;
                                    else delete variants[c];
                                    return { ...f, variants };
                                })
                            }
                            foot={<section className="sticky bottom-2 z-20 rounded-xl border bg-card/95 px-4 py-3 text-card-foreground shadow-lg backdrop-blur">
                            {/* Always in reach, however long the page (owner, 2026-10-30). */}
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-3">
                                    {post && (
                                        <Button variant="ghost" className="text-destructive" onClick={remove}>
                                            <Trash2 className="mr-1.5 h-4 w-4" /> Delete
                                        </Button>
                                    )}
                                    <span className="text-xs text-muted-foreground">
                                        {form.channels.length} platform{form.channels.length === 1 ? "" : "s"}
                                        {post && ` · ${posted} posted, ${form.channels.length - posted} waiting`}
                                        {" · "}
                                        {scheduled ? "scheduled" : "draft"}
                                    </span>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <Button variant="outline" onClick={() => void save("DRAFT")} disabled={!!saving}>
                                        {scheduled ? "Unschedule — save as draft" : "Save as draft"}
                                    </Button>
                                    <Button
                                        onClick={() => void save("SCHEDULED")}
                                        disabled={!!saving || !timed}
                                        title={timed ? undefined : "Set a time in Master or on a platform first"}
                                    >
                                        {saving || (scheduled ? "Save & keep scheduled" : "Schedule")}
                                    </Button>
                                </div>
                            </div>
                        </section>}
                        />
                )}
            </div>
            <PostProductPicker open={picking} onOpenChange={setPicking} onPick={pickProduct} />
        </ScrollArea>
    );
}
