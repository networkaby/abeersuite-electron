"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { extractApiError } from "@/shared/lib/api";
import UserAvatar from "@/shared/components/UserAvatar";
import { ArrowLeft, Send, Cake, MessageSquare, Users, UserPlus, Check, Clock } from "lucide-react";
import { type Actor, type WallItem, portalActorHref, joinedDate, PostRow, EmptyPosts } from "@/modules/external/portal/social/shared";

interface ViewActor {
    kind: "USER" | "PERSON"; id: number; name: string; avatarUrl: string | null; coverUrl: string | null;
    role: string | null; roleBadge: { label: string; color: string } | null;
    handle: string | null; bio: string | null; joinedAt: string; isCustomer: boolean;
}
type ViewerStatus = "self" | "friend" | "pending_out" | "pending_in" | "none";
interface ProfileResponse {
    actor: ViewActor; wall: WallItem[]; friends: Actor[];
    wallCount: number; friendCount: number; isSelf: boolean;
    viewerStatus: ViewerStatus; requestId?: number;
}

export default function PortalSocialViewPage() {
    const params = useParams<{ kind: string; id: string }>();
    const kind = params.kind;
    const id = params.id;

    const [data, setData] = useState<ProfileResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [body, setBody] = useState("");
    const [posting, setPosting] = useState(false);
    const [friendBusy, setFriendBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await axios.get<ProfileResponse>(`/api/portal/social/actor/${kind}/${id}`);
            setData(res.data);
        } catch (e) {
            if (axios.isAxiosError(e) && e.response?.status === 404) setNotFound(true);
            else toast.error("Failed to load profile");
        } finally {
            setLoading(false);
        }
    }, [kind, id]);

    useEffect(() => { void load(); }, [load]);

    async function addFriend() {
        if (!data) return;
        setFriendBusy(true);
        try {
            await axios.post("/api/portal/social/friend-request", { personId: data.actor.id });
            setData((d) => (d ? { ...d, viewerStatus: "pending_out" } : d));
            toast.success("Request sent");
        } catch (e) { toast.error(extractApiError(e, "Failed to send request")); }
        finally { setFriendBusy(false); }
    }

    async function acceptFriend() {
        if (!data || data.requestId == null) return;
        setFriendBusy(true);
        try {
            await axios.post(`/api/portal/social/friend-request/${data.requestId}/respond`, { accept: true });
            toast.success("You're now friends");
            void load();
        } catch (e) { toast.error(extractApiError(e, "Failed")); }
        finally { setFriendBusy(false); }
    }

    async function handlePost() {
        if (!body.trim() || !data) return;
        setPosting(true);
        try {
            const res = await axios.post<WallItem>("/api/portal/social/post", {
                body: body.trim(), ownerKind: data.actor.kind, ownerId: data.actor.id,
            });
            setBody("");
            setData((d) => (d ? { ...d, wall: [res.data, ...d.wall], wallCount: d.wallCount + 1 } : d));
        } catch (e) {
            toast.error(extractApiError(e, "Failed to post"));
        } finally { setPosting(false); }
    }

    const firstName = data ? data.actor.name.split(" ")[0] : "";

    return (
        <main className="px-4 py-6 md:px-6 md:py-8">
            <div className="mx-auto max-w-5xl space-y-5">
                <Link href="/portal/social" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary">
                    <ArrowLeft className="size-4" /> Back to Social
                </Link>

                {loading ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                ) : notFound || !data ? (
                    <Card className="border-border/70">
                        <CardContent className="py-10 text-center text-sm text-muted-foreground">This profile isn&apos;t available.</CardContent>
                    </Card>
                ) : (
                    <>
                        {/* Header */}
                        <div className="relative overflow-hidden rounded-xl border border-border/60 shadow-sm">
                            <div
                                className="absolute inset-0 bg-cover bg-center"
                                style={data.actor.coverUrl ? { backgroundImage: `url("${data.actor.coverUrl}")` } : { background: "linear-gradient(135deg,#7c3aed 0%,#a855f7 100%)" }}
                            />
                            <div className="absolute inset-0 bg-linear-to-b from-black/20 to-black/55" />
                            <div className="relative z-10 px-5 pb-4 pt-20">
                                <div className="flex items-end gap-4">
                                    <div className="shrink-0 rounded-full border-4 border-white shadow-lg">
                                        <UserAvatar avatarUrl={data.actor.avatarUrl} name={data.actor.name} role={data.actor.role} sizePx={88} />
                                    </div>
                                    <div className="pb-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h1 className="text-xl font-bold leading-tight text-white">{data.actor.name}</h1>
                                            {data.actor.roleBadge ? (
                                                <Badge className={`${data.actor.roleBadge.color} text-[10px]`}>{data.actor.roleBadge.label}</Badge>
                                            ) : data.actor.isCustomer ? (
                                                <Badge variant="outline" className="border-white/40 text-[10px] text-white/80">Customer</Badge>
                                            ) : null}
                                        </div>
                                        {data.actor.handle && <p className="text-sm text-white/80">@{data.actor.handle}</p>}
                                        {data.actor.kind === "PERSON" && !data.isSelf && (
                                            <div className="mt-2">
                                                {data.viewerStatus === "friend" ? (
                                                    <Badge variant="outline" className="border-white/40 text-[10px] text-white/90"><Check className="mr-1 size-3" /> Friends</Badge>
                                                ) : data.viewerStatus === "pending_out" ? (
                                                    <Badge variant="outline" className="border-white/40 text-[10px] text-white/90"><Clock className="mr-1 size-3" /> Requested</Badge>
                                                ) : data.viewerStatus === "pending_in" ? (
                                                    <Button size="sm" variant="secondary" onClick={() => void acceptFriend()} disabled={friendBusy}><Check className="size-3.5" /> Accept request</Button>
                                                ) : (
                                                    <Button size="sm" variant="secondary" onClick={() => void addFriend()} disabled={friendBusy}><UserPlus className="size-3.5" /> Add friend</Button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/15 pt-2.5 text-xs text-white/85">
                                    <span className="flex items-center gap-1.5"><MessageSquare className="size-3" /> {data.wallCount} post{data.wallCount !== 1 ? "s" : ""}</span>
                                    <span className="text-white/40">·</span>
                                    <span className="flex items-center gap-1.5"><Users className="size-3" /> {data.friendCount} friend{data.friendCount !== 1 ? "s" : ""}</span>
                                    <span className="text-white/40">·</span>
                                    <span className="flex items-center gap-1.5"><Cake className="size-3" /> Joined {joinedDate(data.actor.joinedAt)}</span>
                                </div>
                            </div>
                        </div>

                        {/* Body: left rail (intro + friends) · right (compose + posts) */}
                        <div className="grid gap-5 lg:grid-cols-[1fr_1.7fr]">
                            <div className="space-y-5">
                                {/* Intro */}
                                <Card className="border-border/70">
                                    <CardHeader><CardTitle className="text-base">Intro</CardTitle></CardHeader>
                                    <CardContent className="space-y-2 text-sm">
                                        <p className="text-foreground">{data.actor.bio || <span className="italic text-muted-foreground">No bio yet.</span>}</p>
                                        <p className="flex items-center gap-1.5 text-muted-foreground"><Cake className="size-3.5" /> Joined {joinedDate(data.actor.joinedAt)}</p>
                                    </CardContent>
                                </Card>

                                {/* Friends */}
                                <Card className="border-border/70">
                                    <CardHeader className="flex-row items-center justify-between">
                                        <CardTitle className="text-base">Friends</CardTitle>
                                        <span className="text-xs text-muted-foreground">{data.friendCount}</span>
                                    </CardHeader>
                                    <CardContent>
                                        {data.friends.length === 0 ? (
                                            <p className="text-sm text-muted-foreground">No friends yet.</p>
                                        ) : (
                                            <div className="grid grid-cols-3 gap-3">
                                                {data.friends.slice(0, 9).map((f) => (
                                                    <Link key={`${f.kind}-${f.id}`} href={portalActorHref(f)} className="group text-center">
                                                        <div className="mx-auto w-fit transition-transform group-hover:scale-105">
                                                            <UserAvatar avatarUrl={f.avatarUrl} name={f.name} role={f.role} sizePx={56} />
                                                        </div>
                                                        <p className="mt-1 truncate text-[11px] font-medium group-hover:text-primary">{f.name}</p>
                                                    </Link>
                                                ))}
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Compose + posts */}
                            <div className="space-y-4">
                                <Card className="border-border/70">
                                    <CardContent className="space-y-3 pt-4">
                                        <Textarea
                                            value={body}
                                            onChange={(e) => setBody(e.target.value)}
                                            rows={3}
                                            className="resize-none"
                                            placeholder={data.isSelf ? "Write something on your wall…" : `Write something on ${firstName}'s wall…`}
                                        />
                                        <div className="flex justify-end">
                                            <Button size="sm" onClick={() => void handlePost()} disabled={posting || !body.trim()}>
                                                <Send className="size-3.5" /> {posting ? "Posting…" : "Post"}
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>

                                {data.wall.length === 0
                                    ? <EmptyPosts label={`No posts on ${data.isSelf ? "your" : `${firstName}'s`} wall yet.`} />
                                    : <div className="space-y-3">{data.wall.map((p) => <PostRow key={p.id} post={p} />)}</div>}
                            </div>
                        </div>
                    </>
                )}
            </div>
        </main>
    );
}
