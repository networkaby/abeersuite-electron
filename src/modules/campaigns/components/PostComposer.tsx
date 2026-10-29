"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { ImagePlus, Package, SquarePen, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchableSelect } from "@/shared/components/SearchableSelect";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import {
    GOOGLE_BUTTONS,
    GOOGLE_POST_TYPES,
    POST_CAPTION_MAX,
    POST_CHANNELS,
    POST_MEDIA_TYPES,
    checkPostMedia,
    productPostCaption,
    type PostInput,
    type PostProduct,
    type PostRow,
} from "@/modules/campaigns/lib/post";
import CampaignsHeader from "./CampaignsHeader";
import PostSharePanel from "./PostSharePanel";
import PostProductPicker, { loadPostProducts } from "./PostProductPicker";
import PostChannelCopies, { type CopyForm } from "./PostChannelCopies";
import { toLocalInput } from "@/modules/campaigns/lib/campaign";
import { fitPostPhoto, uploadPostFile } from "@/modules/campaigns/lib/postUpload";

type Form = Omit<PostInput, "link" | "scheduledAt" | "variants"> & { link: string; scheduledAt: string; variants: Record<string, CopyForm> };

const blank: Form = { caption: "", link: "", channels: ["WA_CHANNEL", "GOOGLE_BUSINESS"], scheduledAt: "", googleType: "UPDATE", googleButton: "SHOP", campaignId: null, status: "DRAFT", variants: {} };


const fromRow = (p: PostRow): Form => ({
    caption: p.caption,
    link: p.link ?? "",
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

const pill = (on: boolean) =>
    `rounded-lg border px-3 py-1.5 text-sm ${on ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground hover:bg-muted/50"}`;

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
    const photoInput = useRef<HTMLInputElement>(null);
    const previews = useMemo(() => pending.map((f) => URL.createObjectURL(f)), [pending]);
    useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

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
    const google = form.channels.includes("GOOGLE_BUSINESS");

    function addPhotos(files: FileList | null) {
        for (const f of Array.from(files ?? [])) {
            const bad = checkPostMedia(f.type, f.size);
            if (bad) toast.error(`${f.name}: ${bad}`);
            else setPending((list) => [...list, f].slice(0, 10));
        }
    }

    /** After Fit: the post's new photos, and each fitted channel's pick, without touching unsaved words. */
    async function fit(channels?: string[]) {
        if (!post) return;
        try {
            const r = await fitPostPhoto(post.id, channels);
            setPost(r.post);
            setForm((f) => {
                const variants = { ...f.variants };
                for (const c of Object.keys(r.fitted)) {
                    const photos = r.post.variants[c]?.photos ?? null;
                    variants[c] = { ...(variants[c] ?? { caption: null, scheduledAt: null }), photos };
                }
                return { ...f, variants };
            });
            toast.success(Object.keys(r.fitted).length > 1 ? "Photo fitted for each channel" : "Photo fitted");
        } catch (e) {
            toast.error(extractApiError(e, "Could not fit the photo"));
        }
    }

    const hasPhoto = !!post?.mediaKey || pending.length > 0 || !!fromProduct?.imageUrl;
    const timed = !!form.scheduledAt || Object.values(form.variants).some((v) => v.scheduledAt);

    async function save() {
        if (timed && form.channels.includes("INSTAGRAM") && !hasPhoto) {
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
                try {
                    for (const [i, f] of pending.entries()) await uploadPostFile(id, f, i > 0);
                } catch (e) {
                    note = extractApiError(e, "A photo did not upload — add it below.");
                    main = null;
                }
                if (fitOnSave && main?.startsWith("image/") && !note) {
                    setSaving("Fitting photos for each channel…");
                    try {
                        await fitPostPhoto(id);
                    } catch (e) {
                        note = extractApiError(e, "Could not fit the photo — use Fit on each channel.");
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
            <div className="mx-auto max-w-4xl space-y-5 px-6 pt-4 pb-10">
                <CampaignsHeader
                    icon={SquarePen}
                    title={post ? "Edit post" : "New post"}
                    description="Write the idea once, then shape it per channel — its own words, time and photos. Share gets each one ready."
                />

                {loading ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
                ) : (
                    <>
                        <section className="space-y-4 rounded-xl border p-4">
                            {!post && (
                                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 p-2 text-sm">
                                    {fromProduct ? (
                                        <>
                                            <Package className="h-4 w-4 text-muted-foreground" />
                                            <span className="min-w-0 flex-1 truncate">
                                                From <span className="font-medium">{fromProduct.name}</span>
                                                <span className="text-muted-foreground">
                                                    {pending.length ? " — your photos are used instead of its own" : fromProduct.imageUrl ? " — its photo is added when you save" : " — it has no photo; add one below"}
                                                </span>
                                            </span>
                                            <Button variant="ghost" size="sm" onClick={() => setPicking(true)}>
                                                Change
                                            </Button>
                                            <Button variant="ghost" size="icon" aria-label="Not from a product" onClick={() => setFromProduct(null)}>
                                                <X className="h-4 w-4" />
                                            </Button>
                                        </>
                                    ) : (
                                        <>
                                            <span className="flex-1 text-muted-foreground">Selling something on the shop? Start from it — text, link and photo fill in.</span>
                                            <Button variant="outline" size="sm" onClick={() => setPicking(true)}>
                                                <Package className="mr-1.5 h-4 w-4" /> From a product
                                            </Button>
                                        </>
                                    )}
                                </div>
                            )}

                            <div className="space-y-1.5">
                                <Label>Post to</Label>
                                <div className="flex flex-wrap gap-2">
                                    {POST_CHANNELS.map((c) => (
                                        <button
                                            key={c.value}
                                            type="button"
                                            disabled={!c.ready}
                                            aria-pressed={form.channels.includes(c.value as Form["channels"][number])}
                                            onClick={() => toggle(c.value as Form["channels"][number])}
                                            className={`${pill(form.channels.includes(c.value as Form["channels"][number]))} disabled:cursor-not-allowed disabled:opacity-60`}
                                        >
                                            {c.label}
                                            {!c.ready && <span className="ml-1 text-xs">· needs approval</span>}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <div className="flex justify-between">
                                    <Label htmlFor="post-caption">Post — main text</Label>
                                    <span className="text-xs text-muted-foreground">
                                        {form.caption.length}/{POST_CAPTION_MAX}
                                    </span>
                                </div>
                                <Textarea
                                    id="post-caption"
                                    rows={6}
                                    value={form.caption}
                                    maxLength={POST_CAPTION_MAX}
                                    placeholder="New HP 15s laptops in stock — Core i5, 16 GB, 512 GB SSD. Free bag and 1-year shop support."
                                    onChange={(e) => set("caption", e.target.value)}
                                />
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                    <Label htmlFor="post-link">Shop link (optional)</Label>
                                    <Input id="post-link" value={form.link} maxLength={300} placeholder="/shop" onChange={(e) => set("link", e.target.value)} />
                                    <p className="text-xs text-muted-foreground">A page on the shop site; it goes at the end of the post.</p>
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="post-when">When (optional) — main time</Label>
                                    <Input id="post-when" type="datetime-local" value={form.scheduledAt} onChange={(e) => set("scheduledAt", e.target.value)} />
                                    <p className="text-xs text-muted-foreground">With a time it shows on the calendar as Scheduled. A channel can have its own time below; this box then shows the earliest one.</p>
                                </div>
                            </div>

                            {google && (
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div className="space-y-1.5">
                                        <Label>Google post type</Label>
                                        <div className="flex flex-wrap gap-2">
                                            {GOOGLE_POST_TYPES.map((t) => (
                                                <button key={t.value} type="button" className={pill(form.googleType === t.value)} onClick={() => set("googleType", t.value)}>
                                                    {t.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>Google button</Label>
                                        <div className="flex flex-wrap gap-2">
                                            <button type="button" className={pill(form.googleButton === null)} onClick={() => set("googleButton", null)}>
                                                None
                                            </button>
                                            {GOOGLE_BUTTONS.map((b) => (
                                                <button key={b.value} type="button" className={pill(form.googleButton === b.value)} onClick={() => set("googleButton", b.value)}>
                                                    {b.label}
                                                </button>
                                            ))}
                                        </div>
                                        <p className="text-xs text-muted-foreground">Pick the same on Google&apos;s Add update screen; it posts by itself once Google approves our API access.</p>
                                    </div>
                                </div>
                            )}

                            {!post && (
                                <div className="space-y-1.5">
                                    <Label>Photos</Label>
                                    <div className="flex flex-wrap items-center gap-2">
                                        {pending.map((f, i) => (
                                            <div key={previews[i]} className="group relative size-20 overflow-hidden rounded-md border bg-muted" title={f.name}>
                                                {f.type.startsWith("video/") ? (
                                                    <span className="flex size-full items-center justify-center text-xs">Video</span>
                                                ) : (
                                                    // eslint-disable-next-line @next/next/no-img-element -- a local preview of a file not yet uploaded
                                                    <img src={previews[i]} alt={f.name} className="size-full object-cover" />
                                                )}
                                                {i === 0 && <span className="absolute bottom-0 left-0 rounded-tr bg-primary px-1 text-[10px] text-primary-foreground">Main</span>}
                                                <button
                                                    type="button"
                                                    aria-label="Remove this photo"
                                                    onClick={() => setPending((list) => list.filter((_, j) => j !== i))}
                                                    className="absolute top-0 right-0 rounded-bl bg-black/60 p-0.5 text-white"
                                                >
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </div>
                                        ))}
                                        <button
                                            type="button"
                                            onClick={() => photoInput.current?.click()}
                                            className="flex size-20 flex-col items-center justify-center gap-1 rounded-md border border-dashed text-xs text-muted-foreground hover:bg-muted/50"
                                        >
                                            <ImagePlus className="h-5 w-5" />
                                            {pending.length ? "More" : "Add photo"}
                                        </button>
                                        <input
                                            ref={photoInput}
                                            type="file"
                                            multiple
                                            accept={POST_MEDIA_TYPES.join(",")}
                                            className="hidden"
                                            onChange={(e) => {
                                                addPhotos(e.target.files);
                                                e.target.value = "";
                                            }}
                                        />
                                    </div>
                                    <label className="flex items-center gap-2 text-sm">
                                        <input type="checkbox" checked={fitOnSave} onChange={(e) => setFitOnSave(e.target.checked)} />
                                        Fit the main photo for each channel on save (Google 4:3, Facebook 1:1, Status 9:16, Instagram 4:5)
                                    </label>
                                    <p className="text-xs text-muted-foreground">JPG, PNG or WebP, or an MP4 up to 16 MB. The first one is the main photo; they upload when you save.</p>
                                </div>
                            )}

                            <PostChannelCopies
                                channels={form.channels}
                                copies={form.variants}
                                main={{ caption: form.caption, scheduledAt: form.scheduledAt }}
                                post={post}
                                onFit={fit}
                                onChange={(c, copy) =>
                                    setForm((f) => {
                                        const variants = { ...f.variants };
                                        if (copy) variants[c] = copy;
                                        else delete variants[c];
                                        return { ...f, variants };
                                    })
                                }
                            />

                            <div className="space-y-1.5">
                                <Label>Part of a campaign (optional)</Label>
                                <SearchableSelect<number>
                                    value={form.campaignId}
                                    options={campaigns}
                                    onChange={(v) => set("campaignId", v)}
                                    placeholder="— a regular post —"
                                    ariaLabel="Campaign"
                                />
                            </div>

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

                        {post ? (
                            <section className="space-y-2">
                                <h2 className="text-sm font-semibold">Photo &amp; share</h2>
                                <PostSharePanel post={post} onChanged={setPost} />
                            </section>
                        ) : (
                            <p className="text-xs text-muted-foreground">After saving, each channel&apos;s Share and Post buttons appear here.</p>
                        )}
                    </>
                )}
            </div>
            <PostProductPicker open={picking} onOpenChange={setPicking} onPick={pickProduct} />
        </ScrollArea>
    );
}
