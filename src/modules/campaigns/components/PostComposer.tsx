"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { SquarePen, Trash2 } from "lucide-react";
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
    type PostInput,
    type PostRow,
} from "@/modules/campaigns/lib/post";
import CampaignsHeader from "./CampaignsHeader";
import PostSharePanel from "./PostSharePanel";

type Form = Omit<PostInput, "link" | "scheduledAt"> & { link: string; scheduledAt: string };

const blank: Form = { caption: "", link: "", channels: ["WA_CHANNEL", "GOOGLE_BUSINESS"], scheduledAt: "", googleType: "UPDATE", googleButton: "SHOP", campaignId: null, status: "DRAFT" };

/** ISO → the "YYYY-MM-DDTHH:mm" a datetime-local box shows, in this PC's time. */
const toLocalInput = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const fromRow = (p: PostRow): Form => ({
    caption: p.caption,
    link: p.link ?? "",
    channels: p.channels as Form["channels"],
    scheduledAt: toLocalInput(p.scheduledAt),
    googleType: p.googleType,
    googleButton: p.googleButton,
    campaignId: p.campaignId,
    status: p.status === "SCHEDULED" ? "SCHEDULED" : "DRAFT",
});

const pill = (on: boolean) =>
    `rounded-lg border px-3 py-1.5 text-sm ${on ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground hover:bg-muted/50"}`;

/**
 * Write one post for several channels. Save first; then the photo and the
 * per-channel Share / Done appear below. A time puts it on the calendar as
 * Scheduled; no time keeps it a draft to share whenever.
 */
export default function PostComposer({ postId, startAt = null }: { postId: number | null; startAt?: string | null }) {
    const router = useRouter();
    const [post, setPost] = useState<PostRow | null>(null);
    const [form, setForm] = useState<Form>(() => ({ ...blank, scheduledAt: toLocalInput(startAt) }));
    const [campaigns, setCampaigns] = useState<{ value: number; label: string }[]>([]);
    const [loading, setLoading] = useState(postId !== null);
    const [saving, setSaving] = useState(false);

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

    const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
    const toggle = (v: Form["channels"][number]) =>
        set("channels", form.channels.includes(v) ? form.channels.filter((c) => c !== v) : [...form.channels, v]);
    const google = form.channels.includes("GOOGLE_BUSINESS");

    async function save() {
        setSaving(true);
        const body = {
            ...form,
            scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
            status: form.scheduledAt ? "SCHEDULED" : "DRAFT",
        };
        try {
            if (post) {
                const r = await axios.patch<PostRow>(`/api/campaigns/posts/${post.id}`, body);
                setPost(r.data);
                toast.success("Post saved");
            } else {
                const r = await axios.post<PostRow>("/api/campaigns/posts", body);
                toast.success("Post saved — add the photo and share it below");
                router.replace(`/office/campaigns/posts/${r.data.id}`);
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
                    description="Write once for every channel. WhatsApp and Google are shared by hand for now — Share gets everything ready."
                />

                {loading ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
                ) : (
                    <>
                        <section className="space-y-4 rounded-xl border p-4">
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
                                    <Label htmlFor="post-caption">Post</Label>
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
                                    <Label htmlFor="post-when">When (optional)</Label>
                                    <Input id="post-when" type="datetime-local" value={form.scheduledAt} onChange={(e) => set("scheduledAt", e.target.value)} />
                                    <p className="text-xs text-muted-foreground">With a time it shows on the calendar as Scheduled. Empty = a draft to share any time.</p>
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
                                <Button onClick={save} disabled={saving}>
                                    {saving ? "Saving…" : form.scheduledAt ? "Save & schedule" : "Save"}
                                </Button>
                            </div>
                        </section>

                        {post ? (
                            <section className="space-y-2">
                                <h2 className="text-sm font-semibold">Photo &amp; share</h2>
                                <PostSharePanel post={post} onChanged={setPost} />
                            </section>
                        ) : (
                            <p className="text-xs text-muted-foreground">Save the post first, then add the photo and share it.</p>
                        )}
                    </>
                )}
            </div>
        </ScrollArea>
    );
}
