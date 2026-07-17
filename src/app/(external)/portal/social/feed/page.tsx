"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { extractApiError } from "@/shared/lib/api";
import PortalSectionHeader from "@/modules/external/portal/PortalSectionHeader";
import UserAvatar from "@/shared/components/UserAvatar";
import { Users, Send, MessageSquare } from "lucide-react";

interface Actor {
    kind: "USER" | "PERSON";
    id: number;
    name: string;
    avatarUrl: string | null;
    href: string;
    role: string | null;
    roleBadge: { label: string; color: string } | null;
    isCustomer: boolean;
}
interface FeedPost {
    id: number;
    body: string;
    createdAt: string;
    author: Actor;
    owner: Actor;
}
interface Overview {
    profile: { joined: false } | { joined: true; handle: string; avatarUrl: string | null; bio: string | null; joinedAt: string };
    feed: FeedPost[];
    friends: Actor[];
}

function timeAgo(iso: string): string {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function ActorBadge({ actor }: { actor: Actor }) {
    if (actor.roleBadge) return <Badge className={`${actor.roleBadge.color} text-[10px]`}>{actor.roleBadge.label}</Badge>;
    if (actor.isCustomer) return <Badge variant="outline" className="text-[10px]">Customer</Badge>;
    return null;
}

export default function PortalSocialFeedPage() {
    const [loading, setLoading] = useState(true);
    const [joined, setJoined] = useState(false);
    const [feed, setFeed] = useState<FeedPost[]>([]);
    const [friends, setFriends] = useState<Actor[]>([]);
    const [body, setBody] = useState("");
    const [posting, setPosting] = useState(false);

    useEffect(() => {
        axios.get<Overview>("/api/portal/social")
            .then((res) => {
                setJoined(res.data.profile.joined);
                setFeed(res.data.feed);
                setFriends(res.data.friends);
            })
            .catch(() => toast.error("Failed to load social"))
            .finally(() => setLoading(false));
    }, []);

    async function handlePost() {
        if (!body.trim()) return;
        setPosting(true);
        try {
            const res = await axios.post<FeedPost>("/api/portal/social/post", { body: body.trim() });
            setFeed((f) => [res.data, ...f]);
            setBody("");
        } catch (e) {
            toast.error(extractApiError(e, "Failed to post"));
        } finally {
            setPosting(false);
        }
    }

    return (
        <main className="px-4 py-6 md:px-6 md:py-8">
            <div className="mx-auto max-w-5xl space-y-5">
                <PortalSectionHeader
                    title="Social"
                    description="The Network Service community feed."
                    icon={Users}
                />

                {loading ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                ) : !joined ? (
                    <Card className="border-border/70">
                        <CardHeader>
                            <CardTitle className="text-lg">Join social first</CardTitle>
                            <CardDescription>You need to pick a nickname before you can post.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Button asChild><Link href="/portal/social">Go to Join</Link></Button>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
                        {/* Composer + feed */}
                        <div className="space-y-4">
                            <Card className="border-border/70">
                                <CardContent className="space-y-3 pt-4">
                                    <Textarea
                                        value={body}
                                        onChange={(e) => setBody(e.target.value)}
                                        rows={3}
                                        className="resize-none"
                                        placeholder="Share something with the community…"
                                    />
                                    <div className="flex justify-end">
                                        <Button size="sm" onClick={() => void handlePost()} disabled={posting || !body.trim()}>
                                            <Send className="size-3.5" /> {posting ? "Posting…" : "Post"}
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>

                            {feed.length === 0 ? (
                                <div className="rounded-lg border-2 border-dashed border-border/70 bg-card/50 py-12 text-center">
                                    <MessageSquare className="mx-auto size-7 text-muted-foreground/40" />
                                    <p className="mt-1 text-sm text-muted-foreground">No posts yet. Be the first to share!</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {feed.map((post) => {
                                        const onOthersWall = post.owner.kind !== post.author.kind || post.owner.id !== post.author.id;
                                        return (
                                            <Card key={post.id} className="border-border/70">
                                                <CardContent className="pt-4">
                                                    <div className="flex items-start gap-3">
                                                        <UserAvatar avatarUrl={post.author.avatarUrl} name={post.author.name} role={post.author.role} sizePx={40} />
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <span className="text-sm font-semibold">{post.author.name}</span>
                                                                <ActorBadge actor={post.author} />
                                                                {onOthersWall && (
                                                                    <span className="text-xs text-muted-foreground">→ on {post.owner.name}&apos;s wall</span>
                                                                )}
                                                                <span className="ml-auto text-[11px] text-muted-foreground">{timeAgo(post.createdAt)}</span>
                                                            </div>
                                                            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{post.body}</p>
                                                        </div>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Friends — staff are default friends */}
                        <Card className="border-border/70 self-start">
                            <CardHeader>
                                <CardTitle className="text-base">Your friends</CardTitle>
                                <CardDescription>The Network Service team is here to help.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-2.5">
                                {friends.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">No team members yet.</p>
                                ) : friends.map((f) => (
                                    <div key={`${f.kind}-${f.id}`} className="flex items-center gap-2.5 rounded-md border border-border/70 p-2.5">
                                        <UserAvatar avatarUrl={f.avatarUrl} name={f.name} role={f.role} sizePx={32} />
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-medium">{f.name}</p>
                                            {f.roleBadge && <p className="text-xs text-muted-foreground">{f.roleBadge.label}</p>}
                                        </div>
                                        <Badge variant="outline" className="ml-auto text-[10px]">Friend</Badge>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    </div>
                )}
            </div>
        </main>
    );
}
