"use client";

import { useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Heart, MessageCircle, MessageSquare, Send } from "lucide-react";
import UserAvatar from "@/shared/components/UserAvatar";
import { extractApiError } from "@/shared/lib/api";

// Shared types + presentational bits for the portal social surfaces (profile
// page, feed, and the profile viewer) so the three never drift.

export interface Actor {
    kind: "USER" | "PERSON";
    id: number;
    name: string;
    avatarUrl: string | null;
    href: string;
    role: string | null;
    roleBadge: { label: string; color: string } | null;
    isCustomer: boolean;
}
export interface Comment { id: number; body: string; createdAt: string; author: Actor }
export interface WallItem {
    id: number; body: string; createdAt: string; author: Actor;
    likeCount: number; likedByMe: boolean; commentCount: number;
}
export interface FeedItem extends WallItem { owner: Actor }

// Portal-local profile link (the resolver's `href` is office-oriented; inside the
// portal every actor — staff or customer — opens the portal viewer instead).
export function portalActorHref(a: { kind: "USER" | "PERSON"; id: number }): string {
    return `/portal/social/view/${a.kind.toLowerCase()}/${a.id}`;
}

export function timeAgo(iso: string): string {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
export function joinedDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

export function ActorBadge({ actor }: { actor: Actor }) {
    if (actor.roleBadge) return <Badge className={`${actor.roleBadge.color} text-[10px]`}>{actor.roleBadge.label}</Badge>;
    if (actor.isCustomer) return <Badge variant="outline" className="text-[10px]">Customer</Badge>;
    return null;
}

// A social post card with a Facebook/X-style interaction bar (Like + Comment)
// and a lazy-loaded, inline comment thread.
export function PostRow({ post, ownerContext }: { post: WallItem; ownerContext?: Actor }) {
    const onOthersWall = ownerContext && (ownerContext.kind !== post.author.kind || ownerContext.id !== post.author.id);

    const [liked, setLiked] = useState(post.likedByMe);
    const [likeCount, setLikeCount] = useState(post.likeCount);
    const [liking, setLiking] = useState(false);

    const [showComments, setShowComments] = useState(false);
    const [comments, setComments] = useState<Comment[] | null>(null);
    const [commentCount, setCommentCount] = useState(post.commentCount);
    const [commentBody, setCommentBody] = useState("");
    const [loadingComments, setLoadingComments] = useState(false);
    const [posting, setPosting] = useState(false);

    async function toggleLike() {
        if (liking) return;
        setLiking(true);
        // Optimistic
        const next = !liked;
        setLiked(next);
        setLikeCount((c) => c + (next ? 1 : -1));
        try {
            const res = await axios.post<{ liked: boolean; likeCount: number }>("/api/portal/social/like", { postId: post.id });
            setLiked(res.data.liked);
            setLikeCount(res.data.likeCount);
        } catch (e) {
            setLiked(!next);
            setLikeCount((c) => c + (next ? -1 : 1));
            toast.error(extractApiError(e, "Failed to like"));
        } finally { setLiking(false); }
    }

    async function openComments() {
        const next = !showComments;
        setShowComments(next);
        if (next && comments === null) {
            setLoadingComments(true);
            try {
                const res = await axios.get<Comment[]>(`/api/portal/social/post/${post.id}/comments`);
                setComments(res.data);
            } catch {
                toast.error("Failed to load comments");
            } finally { setLoadingComments(false); }
        }
    }

    async function addComment() {
        if (!commentBody.trim()) return;
        setPosting(true);
        try {
            const res = await axios.post<Comment>(`/api/portal/social/post/${post.id}/comments`, { body: commentBody.trim() });
            setComments((c) => [...(c ?? []), res.data]);
            setCommentCount((c) => c + 1);
            setCommentBody("");
        } catch (e) {
            toast.error(extractApiError(e, "Failed to comment"));
        } finally { setPosting(false); }
    }

    return (
        <Card className="border-border/70">
            <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                    <Link href={portalActorHref(post.author)} className="shrink-0">
                        <UserAvatar avatarUrl={post.author.avatarUrl} name={post.author.name} role={post.author.role} sizePx={40} />
                    </Link>
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <Link href={portalActorHref(post.author)} className="text-sm font-semibold hover:text-primary">
                                {post.author.name}
                            </Link>
                            <ActorBadge actor={post.author} />
                            {onOthersWall && (
                                <Link href={portalActorHref(ownerContext!)} className="text-xs text-muted-foreground hover:text-primary">
                                    → on {ownerContext!.name}&apos;s wall
                                </Link>
                            )}
                            <span className="ml-auto text-[11px] text-muted-foreground">{timeAgo(post.createdAt)}</span>
                        </div>
                        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{post.body}</p>

                        {/* Interaction bar */}
                        <div className="mt-2.5 flex items-center gap-1 border-t border-border/60 pt-2">
                            <Button type="button" variant="ghost" size="sm" onClick={() => void toggleLike()} className={liked ? "text-rose-600" : "text-muted-foreground"}>
                                <Heart className={`size-4 ${liked ? "fill-current" : ""}`} /> {likeCount > 0 ? likeCount : ""} Like
                            </Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => void openComments()} className="text-muted-foreground">
                                <MessageCircle className="size-4" /> {commentCount > 0 ? commentCount : ""} Comment
                            </Button>
                        </div>

                        {/* Comment thread */}
                        {showComments && (
                            <div className="mt-2 space-y-2.5">
                                {loadingComments ? (
                                    <p className="text-xs text-muted-foreground">Loading comments…</p>
                                ) : (comments ?? []).length === 0 ? (
                                    <p className="text-xs text-muted-foreground">No comments yet. Start the conversation.</p>
                                ) : (comments ?? []).map((c) => (
                                    <div key={c.id} className="flex items-start gap-2">
                                        <UserAvatar avatarUrl={c.author.avatarUrl} name={c.author.name} role={c.author.role} sizePx={26} />
                                        <div className="min-w-0 flex-1 rounded-lg bg-muted/50 px-3 py-1.5">
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-xs font-semibold">{c.author.name}</span>
                                                <span className="text-[10px] text-muted-foreground">{timeAgo(c.createdAt)}</span>
                                            </div>
                                            <p className="whitespace-pre-wrap text-sm text-foreground">{c.body}</p>
                                        </div>
                                    </div>
                                ))}
                                <div className="flex items-center gap-2">
                                    <Input
                                        value={commentBody}
                                        onChange={(e) => setCommentBody(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void addComment(); } }}
                                        placeholder="Write a comment…"
                                        className="h-9"
                                    />
                                    <Button size="sm" onClick={() => void addComment()} disabled={posting || !commentBody.trim()}>
                                        <Send className="size-3.5" />
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

export function EmptyPosts({ label }: { label: string }) {
    return (
        <div className="rounded-lg border-2 border-dashed border-border/70 bg-card/50 py-12 text-center">
            <MessageSquare className="mx-auto size-7 text-muted-foreground/65" />
            <p className="mt-1 text-sm text-muted-foreground">{label}</p>
        </div>
    );
}
