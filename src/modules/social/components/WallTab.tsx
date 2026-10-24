"use client";

// A person's wall. Reads its own posts when it mounts — the page no longer
// fetches the wall for a visitor who never opens this tab (§7).

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { MessageSquare, Send, Trash2, UserCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import UserAvatar from "@/shared/components/UserAvatar";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { timeAgo, type UserProfile, type WallPost } from "./profileTypes";
import { useValueChange } from "@/shared/hooks/useValueChange";

export default function WallTab({ profile, sessionUserId, focusInput }: {
    profile: UserProfile; sessionUserId: number | undefined; focusInput: boolean;
}) {
    const [posts, setPosts] = useState<WallPost[]>([]);
    const [loading, setLoading] = useState(true);
    const [body, setBody] = useState("");
    const [posting, setPosting] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const readWall = (first: boolean) => {
        axios.get<WallPost[]>(`/api/users/${profile.id}/wall`)
            .then(r => setPosts(r.data))
            .catch(e => {
                if (first && (!axios.isAxiosError(e) || e.response?.status !== 404)) toast.error("Failed to load wall");
            })
            .finally(() => { if (first) setLoading(false); });
    };
    // Another profile's wall: the spinner shows from its first render.
    if (useValueChange(profile.id)) setLoading(true);
    useEffect(() => { readWall(true); }, [profile.id]); // eslint-disable-line react-hooks/exhaustive-deps -- read the wall once per profile
    // Someone else posting on this wall announces `tasks`; only the posts are re-read.
    useRealtimeTopics(["tasks"], () => readWall(false));

    useEffect(() => { if (focusInput) textareaRef.current?.focus(); }, [focusInput]);

    async function handlePost() {
        if (!body.trim()) return;
        setPosting(true);
        try {
            const res = await axios.post<WallPost>(`/api/users/${profile.id}/wall`, { body: body.trim() });
            setPosts(prev => [res.data, ...prev]); setBody("");
        } catch (e) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Failed to post");
        } finally { setPosting(false); }
    }

    async function handleDelete(postId: number) {
        try { await axios.delete(`/api/wall-posts/${postId}`); setPosts(prev => prev.filter(p => p.id !== postId)); }
        catch { toast.error("Failed to delete post"); }
    }

    const canDelete = (post: WallPost) =>
        sessionUserId !== undefined &&
        ((!post.author.isCustomer && sessionUserId === post.author.id) || sessionUserId === profile.id);

    return (
        <div className="space-y-4">
            <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <div className="flex items-start gap-3">
                    <div className="shrink-0 mt-1"><UserCircle size={32} className="text-muted-foreground" /></div>
                    <Textarea
                        ref={textareaRef} value={body} onChange={e => setBody(e.target.value)} rows={3}
                        className="flex-1 resize-none"
                        placeholder={sessionUserId === profile.id ? "Write something on your wall…" : `Write something on ${profile.name.split(" ")[0]}'s wall…`}
                        onKeyDown={e => { if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); handlePost(); } }}
                    />
                </div>
                <div className="flex items-center justify-between">
                    <p className="text-[11px] text-muted-foreground">Shift + Enter to post</p>
                    <Button size="sm" onClick={handlePost} disabled={posting || !body.trim()}>
                        <Send size={13} /> {posting ? "Posting…" : "Post"}
                    </Button>
                </div>
            </div>

            {loading ? (
                <p className="text-center text-sm text-muted-foreground py-8">Loading wall…</p>
            ) : posts.length === 0 ? (
                <div className="border-2 border-dashed border-border bg-card/50 py-12 text-center space-y-1">
                    <MessageSquare size={28} className="mx-auto text-muted-foreground/65" />
                    <p className="text-sm text-muted-foreground">
                        No posts yet. Be the first to write on {profile.name.split(" ")[0]}&apos;s wall!
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {posts.map(post => (
                        <div key={post.id} className="rounded-lg border border-border bg-card p-4">
                            <div className="flex items-start gap-3">
                                <Link href={post.author.href} className="shrink-0">
                                    <UserAvatar avatarUrl={post.author.avatarUrl} name={post.author.name} role={post.author.role} sizePx={40} />
                                </Link>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <Link href={post.author.href} className="text-sm font-semibold text-foreground hover:text-primary transition-colors">
                                            {post.author.name}
                                        </Link>
                                        {post.author.roleBadge ? (
                                            <Badge className={`${post.author.roleBadge.color} text-[10px]`}>{post.author.roleBadge.label}</Badge>
                                        ) : post.author.isCustomer ? (
                                            <Badge variant="outline" className="text-[10px]">Customer</Badge>
                                        ) : null}
                                        <span className="text-[11px] text-muted-foreground ml-auto">{timeAgo(post.createdAt)}</span>
                                        {canDelete(post) && (
                                            <Button onClick={() => handleDelete(post.id)} variant="ghost" size="icon-xs"
                                                className="text-muted-foreground/65 hover:text-destructive" title="Delete">
                                                <Trash2 size={13} />
                                            </Button>
                                        )}
                                    </div>
                                    <p className="text-sm text-foreground mt-1.5 whitespace-pre-wrap leading-relaxed">{post.body}</p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
