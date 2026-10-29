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
        Object.entries(p.variants).flatMap(([c, v]) => (v ? [[c, { caption: v.caption, scheduledAt: v.scheduledAt ? toLocalInput(v.scheduledAt) : null, photos: v.photos }]] : [])),
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
    const [prePick, setPrePick] = useState<Record<string, File>>({});

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
                if (v.caption === null && v.scheduledAt === null && v.photos === null) delete variants[c];
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

    async function save() {
        if (timed && form.channels.includes("INSTAGRAM") && !hasPhoto("INSTAGRAM")) {
            toast.error("Instagram needs a photo — add one, or untick Instagram, before scheduling.");
            return;
        }
        setSaving("Saving…");
        const variants = Object.fromEntries(
            Object.entries(form.variants)
                .filter(([c]) => (form.channels as string[]).includes(c))
                .map(([c, v]) => [c, { caption: v.caption?.trim() || null, scheduledAt: iso(v.scheduledAt), photos: v.photos }]),
        );
        const body = {
            ...form,
            variants,
            scheduledAt: iso(form.scheduledAt),
            status: form.scheduledAt || Object.values(variants).some((v) => v.scheduledAt) ? "SCHEDULED" : "DRAFT",
        };
        try {
            if (post) {
                const r = await axios.patch<PostRow>(`/api/campaigns/posts/${post.id}`, body);
                setPost(r.data);
                setForm(fromRow(r.data));
                toast.success("Post saved");
            } else {
                // Photos picked here win over the product's own.
                const r = await axios.post<PostRow & { photoNote?: string | null }>("/api/campaigns/posts", {
                    ...body,
                    fromProductId: pending.length ? null : (fromProduct?.id ?? null),
                });
                const id = r.data.id;
                let note = r.data.photoNote ?? null;
                let main = pending.length ? pending[0].type : r.data.mediaKey ? "image/" : null;
                if (pending.length) setSaving("Uploading photos…");
                const keyOf = new Map<File, string>();
                try {
                    for (const [i, f] of pending.entries()) {
                        const row = await uploadPostFile(id, f, i > 0);
                        const k = i === 0 ? row.mediaKey : row.extraMedia[row.extraMedia.length - 1]?.key;
                        if (k) keyOf.set(f, k);
                    }
                } catch (e) {
                    note = extractApiError(e, "A photo did not upload — add it below.");
                    main = null;
                }
                // Channels with a photo of their own keep it; the rest get the main one fitted.
                const picked = form.channels.filter((c) => !cardFiles[c] && prePick[c] && pending.includes(prePick[c]) && keyOf.has(prePick[c]));
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
                        await fitPostPhoto(id, { channels: [c], key: keyOf.get(prePick[c]) });
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
                    }
                }
                if (note) toast.warning(`Post saved. ${note}`);
                else toast.success(main ? "Post saved with its photo — share it below" : "Post saved — add the photo and share it below");
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
            <div className="mx-auto max-w-6xl space-y-5 px-6 pt-4 pb-10">
                <CampaignsHeader
                    icon={SquarePen}
                    title={post ? "Edit post" : "New post"}
                    description="Write the idea once, then shape it per channel — its own words, time and photos. Share gets each one ready."
                />

                {loading ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
                ) : (
                    <>
                        <PostMaterials
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
                        />

                        <PostPlatformCards
                            channels={form.channels}
                            onToggle={(c) => toggle(c as Form["channels"][number])}
                            copies={form.variants}
                            master={{ caption: form.caption, hashtags: form.hashtags, scheduledAt: form.scheduledAt }}
                            post={post}
                            onFit={fit}
                            onPostChanged={setPost}
                            onUpload={cardUpload}
                            cardFiles={cardFiles}
                            onDropCardFile={(c) => setCardFiles(({ [c]: _drop, ...rest }) => rest)}
                            prePick={prePick}
                            onPrePick={(c, f) => setPrePick(({ [c]: _old, ...rest }) => (f ? { ...rest, [c]: f } : rest))}
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
                        />

                        <section className="rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
                            <div className="flex flex-wrap justify-between gap-2">
                                <div>
                                    {post && (
                                        <Button variant="ghost" className="text-destructive" onClick={remove}>
                                            <Trash2 className="mr-1.5 h-4 w-4" /> Delete
                                        </Button>
                                    )}
                                </div>
                                <Button onClick={save} disabled={!!saving}>
                                    {saving || (timed ? "Save & schedule" : "Save")}
                                </Button>
                            </div>
                        </section>

                    </>
                )}
            </div>
            <PostProductPicker open={picking} onOpenChange={setPicking} onPick={pickProduct} />
        </ScrollArea>
    );
}
