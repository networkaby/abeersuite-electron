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

type Form = Omit<PostInput, "link" | "hashtags" | "scheduledAt" | "variants"> & { link: string; hashtags: string; scheduledAt: string; variants: Record<string, CopyForm> };

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
