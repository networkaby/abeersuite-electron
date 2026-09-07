"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { extractApiError } from "@/shared/lib/api";
import UserAvatar from "@/shared/components/UserAvatar";
import {
    type Actor, type WallItem, type FeedItem,
    joinedDate, PostRow, EmptyPosts,
} from "@/modules/external/portal/social/shared";
import { FriendsPanel } from "@/modules/external/portal/social/FriendsPanel";
import { uploadImageToCloudinary } from "@/shared/lib/uploadToCloudinary";
import {
    Globe2, Users, Send, MessageSquare, Mail, Phone, Cake, Pencil, Newspaper, UserCircle, Upload,
} from "lucide-react";

// ── Types (mirror /api/portal/social) ────────────────────────────────────────
interface Me {
    handle: string; avatarUrl: string | null; coverUrl: string | null; bio: string | null; joinedAt: string;
    name: string; phone: string | null; email: string | null; wallCount: number; friendCount: number;
}
type Overview =
    | { joined: false }
    | { joined: true; me: Me; wall: WallItem[]; feed: FeedItem[]; friends: Actor[] };

type Tab = "wall" | "feed" | "friends" | "about" | "edit";

// ── Join card (not yet opted in) ─────────────────────────────────────────────
function JoinCard({ onJoined }: { onJoined: () => void }) {
    const [nick, setNick] = useState("");
    const [error, setError] = useState("");
    const [joining, setJoining] = useState(false);
    const canJoin = nick.trim().length >= 3;

    async function join() {
        setError(""); setJoining(true);
        try {
            await axios.post("/api/portal/social/join", { handle: nick.trim() });
            toast.success("You've joined social!");
            onJoined();
        } catch (e) {
            setError(extractApiError(e, "Could not join"));
        } finally { setJoining(false); }
    }

    return (
        <Card className="border-border/70">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg"><Globe2 className="size-4 text-primary" /> Before you join</CardTitle>
                <CardDescription>If you join, you will be visible to other customers and staff of Network Service. Choose a nickname to continue.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-1.5">
                    <Label htmlFor="nickname">Nickname</Label>
                    <Input id="nickname" value={nick} onChange={(e) => setNick(e.target.value)} placeholder="Choose your nickname" autoComplete="off" />
                    {error ? <p className="text-xs text-destructive">{error}</p> : null}
                </div>
                <Button type="button" disabled={!canJoin || joining} onClick={() => void join()}>
                    {joining ? "Joining…" : "Join social"}
                </Button>
            </CardContent>
        </Card>
    );
}

// ── Profile header ────────────────────────────────────────────────────────────
function ProfileHeader({ me, onEdit }: { me: Me; onEdit: () => void }) {
    return (
        <div className="relative overflow-hidden rounded-xl border border-border/60 shadow-sm">
            <div
                className="absolute inset-0 bg-cover bg-center"
                style={me.coverUrl ? { backgroundImage: `url("${me.coverUrl}")` } : { background: "linear-gradient(135deg,#7c3aed 0%,#a855f7 100%)" }}
            />
            <div className="absolute inset-0 bg-linear-to-b from-black/20 to-black/50" />
            <div className="relative z-10 px-5 pb-4 pt-20">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div className="flex items-end gap-4">
                        <div className="shrink-0 rounded-full border-4 border-white shadow-lg">
                            <UserAvatar avatarUrl={me.avatarUrl} name={me.name} role={null} sizePx={88} />
                        </div>
                        <div className="pb-1">
                            <h1 className="text-xl font-bold leading-tight text-white">{me.name}</h1>
                            <p className="text-sm text-white/80">@{me.handle}</p>
                        </div>
                    </div>
                    <Button variant="secondary" size="sm" onClick={onEdit} className="self-start sm:self-auto">
                        <Pencil className="size-3.5" /> Edit Profile
                    </Button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/15 pt-2.5 text-xs text-white/85">
                    <span className="flex items-center gap-1.5"><MessageSquare className="size-3" /> {me.wallCount} wall post{me.wallCount !== 1 ? "s" : ""}</span>
                    <span className="text-white/40">·</span>
                    <span className="flex items-center gap-1.5"><Users className="size-3" /> {me.friendCount} friend{me.friendCount !== 1 ? "s" : ""}</span>
                    <span className="text-white/40">·</span>
                    <span>Joined {joinedDate(me.joinedAt)}</span>
                </div>
            </div>
        </div>
    );
}

// ── Edit tab ──────────────────────────────────────────────────────────────────
function EditTab({ me, onSaved }: { me: Me; onSaved: () => void }) {
    const [handle, setHandle] = useState(me.handle);
    const [avatarUrl, setAvatarUrl] = useState(me.avatarUrl ?? "");
    const [coverUrl, setCoverUrl] = useState(me.coverUrl ?? "");
    const [bio, setBio] = useState(me.bio ?? "");
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadingCover, setUploadingCover] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const coverRef = useRef<HTMLInputElement>(null);

    async function uploadFile(file: File | undefined, setBusy: (b: boolean) => void, apply: (url: string) => void) {
        if (!file) return;
        if (!file.type.startsWith("image/")) { toast.error("Please choose an image file"); return; }
        if (file.size > 5 * 1024 * 1024) { toast.error("Image must be under 5 MB"); return; }
        setBusy(true);
        try {
            const url = await uploadImageToCloudinary(file, "/api/portal/upload-signature");
            apply(url);
            toast.success("Photo uploaded");
        } catch {
            toast.error("Upload failed — try again");
        } finally { setBusy(false); }
    }

    async function save() {
        setSaving(true);
        try {
            // The photo is the customer's one profile picture (Person.avatarUrl),
            // shared with My Profile; the rest is social-only.
            await Promise.all([
                axios.patch("/api/portal/social/profile", {
                    handle: handle.trim(),
                    coverUrl: coverUrl.trim() || null,
                    bio: bio.trim() || null,
                }),
                (avatarUrl.trim() || null) !== (me.avatarUrl ?? null)
                    ? axios.patch("/api/portal/me", { avatarUrl: avatarUrl.trim() || null })
                    : Promise.resolve(),
            ]);
            toast.success("Profile saved");
            onSaved();
        } catch (e) {
            toast.error(extractApiError(e, "Failed to save"));
        } finally { setSaving(false); }
    }

    return (
        <Card className="max-w-xl border-border/70">
            <CardContent className="space-y-4 pt-5">
                {/* Cover photo */}
                <div>
                    <input ref={coverRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void uploadFile(f, setUploadingCover, setCoverUrl); }} />
                    <div
                        className="relative h-28 overflow-hidden rounded-lg border border-border bg-cover bg-center"
                        style={coverUrl ? { backgroundImage: `url("${coverUrl}")` } : { background: "linear-gradient(135deg,#7c3aed 0%,#a855f7 100%)" }}
                    >
                        {uploadingCover && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                                <div className="size-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
                            </div>
                        )}
                        <div className="absolute bottom-2 right-2 flex gap-2">
                            <Button type="button" variant="secondary" size="sm" disabled={uploadingCover} onClick={() => coverRef.current?.click()}>
                                <Upload className="size-3.5" /> {uploadingCover ? "Uploading…" : "Cover"}
                            </Button>
                            {coverUrl && <Button type="button" variant="secondary" size="sm" onClick={() => setCoverUrl("")}>Remove</Button>}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="relative shrink-0">
                        <UserAvatar avatarUrl={avatarUrl || null} name={me.name} role={null} sizePx={72} />
                        {uploading && (
                            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
                                <div className="size-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                            </div>
                        )}
                    </div>
                    <div className="flex-1 space-y-2">
                        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void uploadFile(f, setUploading, setAvatarUrl); }} />
                        <div className="flex flex-wrap items-center gap-2">
                            <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                                <Upload className="size-3.5" /> {uploading ? "Uploading…" : "Upload photo"}
                            </Button>
                            {avatarUrl && (
                                <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setAvatarUrl("")}>
                                    Remove
                                </Button>
                            )}
                        </div>
                        <Input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="…or paste an image URL" />
                        <p className="text-[11px] text-muted-foreground">JPG, PNG or WebP · max 5 MB</p>
                    </div>
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="handle">Nickname (@handle)</Label>
                    <Input id="handle" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="yourname" />
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="bio">Bio</Label>
                    <Textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} rows={3} maxLength={500} placeholder="A short intro about yourself…" />
                    <p className="text-right text-[11px] text-muted-foreground">{bio.length}/500</p>
                </div>
                <div className="flex justify-end">
                    <Button size="sm" onClick={() => void save()} disabled={saving || handle.trim().length < 3}>
                        {saving ? "Saving…" : "Save profile"}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PortalSocialPage() {
    const [data, setData] = useState<Overview | null>(null);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<Tab>("wall");
    const [body, setBody] = useState("");
    const [posting, setPosting] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await axios.get<Overview>("/api/portal/social");
            setData(res.data);
        } catch {
            toast.error("Failed to load social");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    async function handlePost() {
        if (!body.trim() || !data || !data.joined) return;
        setPosting(true);
        try {
            const res = await axios.post<FeedItem>("/api/portal/social/post", { body: body.trim() });
            setBody("");
            setData((d) => {
                if (!d || !d.joined) return d;
                return {
                    ...d,
                    wall: [res.data, ...d.wall],
                    feed: [res.data, ...d.feed],
                    me: { ...d.me, wallCount: d.me.wallCount + 1 },
                };
            });
        } catch (e) {
            toast.error(extractApiError(e, "Failed to post"));
        } finally { setPosting(false); }
    }

    const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
        { id: "wall", label: "Wall", icon: MessageSquare },
        { id: "feed", label: "Feed", icon: Newspaper },
        { id: "friends", label: "Friends", icon: Users },
        { id: "about", label: "About", icon: UserCircle },
        { id: "edit", label: "Edit Profile", icon: Pencil },
    ];

    return (
        <main className="px-4 py-6 md:px-6 md:py-8">
            <div className="mx-auto max-w-5xl space-y-5">
                {/* <PortalSectionHeader title="Social" description="Your Network Service community profile." icon={Users} /> */}

                {loading ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                ) : !data || !data.joined ? (
                    <JoinCard onJoined={() => { setLoading(true); void load(); }} />
                ) : (
                    <div className="space-y-5">
                        <ProfileHeader me={data.me} onEdit={() => setTab("edit")} />

                        {/* Tab bar */}
                        <div className="flex flex-wrap gap-1 border-b border-border">
                            {tabs.map((t) => (
                                <Button
                                    key={t.id}
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setTab(t.id)}
                                    className={`rounded-b-none border-b-2 ${tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
                                >
                                    <t.icon className="size-3.5" /> {t.label}
                                </Button>
                            ))}
                        </div>

                        {/* Wall */}
                        {tab === "wall" && (
                            <div className="space-y-4">
                                <Card className="border-border/70">
                                    <CardContent className="space-y-3 pt-4">
                                        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className="resize-none" placeholder="Write something on your wall…" />
                                        <div className="flex justify-end">
                                            <Button size="sm" onClick={() => void handlePost()} disabled={posting || !body.trim()}>
                                                <Send className="size-3.5" /> {posting ? "Posting…" : "Post"}
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                                {data.wall.length === 0
                                    ? <EmptyPosts label="No posts on your wall yet. Say hello!" />
                                    : <div className="space-y-3">{data.wall.map((p) => <PostRow key={p.id} post={p} />)}</div>}
                            </div>
                        )}

                        {/* Feed */}
                        {tab === "feed" && (
                            data.feed.length === 0
                                ? <EmptyPosts label="The community feed is quiet. Be the first to share!" />
                                : <div className="space-y-3">{data.feed.map((p) => <PostRow key={p.id} post={p} ownerContext={p.owner} />)}</div>
                        )}

                        {/* Friends — requests inbox + search + list */}
                        {tab === "friends" && (
                            <FriendsPanel friends={data.friends} onChanged={() => { void load(); }} />
                        )}

                        {/* About */}
                        {tab === "about" && (
                            <div className="max-w-xl space-y-4">
                                <Card className="border-border/70">
                                    <CardContent className="space-y-2 pt-5">
                                        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">About</h3>
                                        <p className="text-sm text-foreground">{data.me.bio || <span className="text-muted-foreground italic">No bio yet — add one from Edit Profile.</span>}</p>
                                    </CardContent>
                                </Card>
                                <Card className="border-border/70">
                                    <CardContent className="space-y-2.5 pt-5">
                                        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Contact</h3>
                                        {data.me.email && <div className="flex items-center gap-2 text-sm"><Mail className="size-3.5 text-muted-foreground" /> {data.me.email}</div>}
                                        {data.me.phone && <div className="flex items-center gap-2 text-sm"><Phone className="size-3.5 text-muted-foreground" /> {data.me.phone}</div>}
                                        <div className="flex items-center gap-2 text-sm"><Cake className="size-3.5 text-muted-foreground" /> Joined {joinedDate(data.me.joinedAt)}</div>
                                    </CardContent>
                                </Card>
                            </div>
                        )}

                        {/* Edit */}
                        {tab === "edit" && <EditTab me={data.me} onSaved={() => { setTab("about"); void load(); }} />}
                    </div>
                )}
            </div>
        </main>
    );
}
