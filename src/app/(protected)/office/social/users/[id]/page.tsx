"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Image from "next/image";
import { imageLoaderFor } from "@/shared/lib/cloudinaryImage";
import Link from "next/link";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import {
    ArrowLeft, Mail, Phone, Cake, Building2, Users,
    Pencil, GitBranch, Upload, Link2, ExternalLink,
    MessageSquare, Info, Lock, Trash2, PanelRightOpen, PanelRightClose, Home,
    Send, UserCircle, Printer, Activity, IdCard, Receipt, CreditCard,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatTimeOnly } from "@/shared/lib/format/formatDate";
import type { OrgStructure } from "@/shared/types/orgChart";
import StructureTree from "@/modules/admin/components/StructureTree";
import UserAvatar from "@/shared/components/UserAvatar";
import { uploadImageToCloudinary as uploadToCloudinary } from "@/shared/lib/uploadToCloudinary";
import { hasModuleNavAccess, hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import StaffPersonalForm from "@/modules/hr/components/StaffPersonalForm";
import StaffPayslips from "@/modules/hr/components/StaffPayslips";
import StaffIdCardTab from "@/modules/hr/components/StaffIdCardTab";

// ── Types ────────────────────────────────────────────────────────────────────

interface Permission {
    id: string; label: string; module: string; description: string | null;
}
interface StaffCard {
    id: number; name: string; title: string | null; role: string | null;
    avatarUrl: string | null;
    userRole: { label: string; color: string } | null;
}
interface UserProfile {
    id: number; name: string; email: string; title: string | null;
    role: string | null; scope: string; createdAt: string; managerId: number | null;
    avatarUrl: string | null;
    coverUrl: string | null;
    phone: string | null;
    birthday: string | null;
    bio: string | null;
    linkedIn: string | null;
    twitter: string | null;
    instagram: string | null;
    facebook: string | null;
    userRole: { id: string; label: string; color: string; rank: number; permissions: { permission: Permission }[] } | null;
    manager: StaffCard | null;
    reports: StaffCard[];
    departments: { id: string; name: string }[];
    branches: { id: string; name: string }[];
}
interface WallPost {
    id: number; body: string; createdAt: string;
    // Resolved SocialActor — author may be a staff User or a customer Person.
    author: {
        kind: "USER" | "PERSON"; id: number; name: string; avatarUrl: string | null;
        href: string; role: string | null;
        roleBadge: { label: string; color: string } | null;
        isCustomer: boolean;
    };
}
interface UserActivity {
    id: string;
    type: "ticket_created" | "ticket_updated" | "wall_post" | "user_joined" | "login_untracked" | "logout_untracked";
    title: string;
    description: string;
    createdAt: string;
    meta?: { ticketId?: number; wallUserId?: number; wallUserName?: string };
}

// ── Constants ────────────────────────────────────────────────────────────────

const SCOPE_LABELS: Record<string, string> = {
    OWN: "Own records", TEAM: "Direct reports", DEPARTMENT: "Full department",
    BRANCH: "Full branch", REGION: "Region-wide", ORG: "Entire organisation",
};
const COVER_GRADIENT: Record<string, string> = {
    R1: "linear-gradient(135deg,#7c3aed 0%,#a855f7 100%)",
    R2: "linear-gradient(135deg,#1d4ed8 0%,#3b82f6 100%)",
    R3: "linear-gradient(135deg,#15803d 0%,#22c55e 100%)",
    R4: "linear-gradient(135deg,#c2410c 0%,#f97316 100%)",
    R5: "linear-gradient(135deg,#be185d 0%,#ec4899 100%)",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function coverBg(role: string | null) {
    return COVER_GRADIENT[role ?? ""] ?? "linear-gradient(135deg,#334155 0%,#64748b 100%)";
}
function formatBirthday(iso: string) {
    return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
}
function ensureUrl(url: string) {
    return url.startsWith("http") ? url : `https://${url}`;
}
function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}


// ── ProfileHeader ─────────────────────────────────────────────────────────────

function ProfileHeader({
    profile, isSelf, wallPostCount, onWriteOnWall, onEditProfile,
}: {
    profile: UserProfile; isSelf: boolean; wallPostCount: number;
    onWriteOnWall: () => void; onEditProfile: () => void;
}) {
    return (
        // <div className="relative border border-border overflow-hidden mb-1 print:border-0">
        //     {/* Cover */}
        //     <div className="absolute inset-0 overflow-hidden print:hidden">
        //         {profile.coverUrl ? (
        //             <Image src={profile.coverUrl} alt="Cover" fill className="object-cover" />
        //         ) : (
        //             <div className="absolute inset-0" style={{ background: coverBg(profile.role) }} />
        //         )}
        //     </div>

        //     <div className="relative z-10 pt-20 sm:pt-28">
        //         {/* Avatar + name */}
        //         {/* <div className="bg-card px-4 sm:px-5 pb-4"> */}
        //         <div className="bg-transparent px-4 sm:px-5 pb-4">

        //             <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-4 -mt-10 sm:-mt-12">
        //                 {/* Avatar ring */}
        //                 <div className="shrink-0 rounded-full border-4 border-card self-start" style={{ lineHeight: 0 }}>
        //                     <UserAvatar avatarUrl={profile.avatarUrl} name={profile.name} role={profile.role} sizePx={88} />
        //                 </div>

        //                 {/* Name block */}
        //                 <div className="flex-1 flex flex-col sm:flex-row sm:items-end justify-between gap-3 sm:gap-4 min-w-0 sm:pb-1 pt-2 sm:pt-12">
        //                     <div className="min-w-0">
        //                         <div className="flex items-center gap-2 flex-wrap">
        //                             <h1 className="text-xl font-bold text-foreground leading-tight">{profile.name}</h1>
        //                             <Badge className={`${profile.userRole.color} text-xs`}>{profile.userRole.label}</Badge>
        //                             {isSelf && (
        //                                 <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 font-medium">You</span>
        //                             )}
        //                         </div>
        //                         {profile.title && <p className="text-sm text-muted-foreground mt-0.5">{profile.title}</p>}
        //                         <div className="flex flex-wrap gap-1 mt-1.5">
        //                             {profile.departments.map(d => (
        //                                 <span key={d.id} className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5">{d.name}</span>
        //                             ))}
        //                             {profile.branches.map(b => (
        //                                 <span key={b.id} className="text-[10px] bg-orange-50 text-orange-700 border border-orange-200 px-1.5 py-0.5">{b.name}</span>
        //                             ))}
        //                         </div>
        //                     </div>
        //                     <div className="flex items-center gap-2 shrink-0 print:hidden">
        //                         {isSelf ? (
        //                             <Button variant="outline" size="sm" onClick={onEditProfile}>
        //                                 <Pencil size={13} /> Edit Profile
        //                             </Button>
        //                         ) : (
        //                             <Button size="sm" onClick={onWriteOnWall}>
        //                                 <MessageSquare size={13} /> Write on Wall
        //                             </Button>
        //                         )}
        //                         <Button variant="outline" size="sm" onClick={() => window.print()} title="Print">
        //                             <Printer size={13} />
        //                         </Button>
        //                     </div>
        //                 </div>
        //             </div>
        //         </div>
        //         {/* <div className="bg-card/70 backdrop-blur-md px-4 sm:px-5 pb-4"> */}
        //         {/* Stats strip */}
        //         <div className="bg-muted/30 backdrop-blur-md  border-t-2 border-border px-4 sm:px-6 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground print:hidden">
        //             <span className="flex items-center gap-1.5"><Building2 size={11} /> Joined {formatDate(profile.createdAt)}</span>
        //             <span className="text-border hidden sm:inline">·</span>
        //             <span className="flex items-center gap-1.5"><Users size={11} /> {profile.reports.length} direct report{profile.reports.length !== 1 ? "s" : ""}</span>
        //             <span className="text-border hidden sm:inline">·</span>
        //             <span className="flex items-center gap-1.5"><MessageSquare size={11} /> {wallPostCount} wall post{wallPostCount !== 1 ? "s" : ""}</span>
        //             <span className="text-border hidden sm:inline">·</span>
        //             <span>Rank {profile.userRole.rank}</span>
        //         </div>
        //     </div>
        // </div>

        // **************** NEW CODE ****************

        <div className="relative border border-border/50 rounded-xl overflow-hidden mb-2 shadow-sm hover:shadow-md transition print:border-0">

            {/* Cover */}
            <div className="absolute inset-0 overflow-hidden print:hidden">
                {profile.coverUrl ? (
                    <Image src={profile.coverUrl} alt="Cover" fill className="object-cover" loader={imageLoaderFor(profile.coverUrl)} />
                ) : (
                    <div className="absolute inset-0" style={{ background: coverBg(profile.role) }} />
                )}

                {/* Overlay for readability */}
                <div className="absolute inset-0 bg-linear-to-b from-black/30 via-black/20 to-black/60" />
            </div>

            <div className="relative z-10 pt-20 sm:pt-28">

                {/* Header Glass */}
                <div className="bg-white/10 dark:bg-black/20 backdrop-blur-md px-4 sm:px-5 pb-4 rounded-b-xl border border-white/10">

                    <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-4 -mt-10 sm:-mt-12">

                        {/* Avatar */}
                        <div className="shrink-0 rounded-full border-4 border-white shadow-lg ring-2 ring-black/10 self-start">
                            <UserAvatar
                                avatarUrl={profile.avatarUrl}
                                name={profile.name}
                                role={profile.role}
                                sizePx={88}
                            />
                        </div>

                        {/* Name + Actions */}
                        <div className="flex-1 flex flex-col sm:flex-row sm:items-end justify-between gap-3 sm:gap-4 min-w-0 sm:pb-1 pt-2 sm:pt-8">

                            {/* Name block */}
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <h1 className="text-xl font-bold text-white leading-tight">
                                        {profile.name}
                                    </h1>

                                    {profile.userRole ? (
                                        <Badge className={`${profile.userRole.color} text-xs`}>
                                            {profile.userRole.label}
                                        </Badge>
                                    ) : (
                                        <Badge variant="outline" className="text-xs text-white/70 border-white/30">
                                            No role assigned
                                        </Badge>
                                    )}

                                    {isSelf && (
                                        <span className="text-[10px] bg-primary/20 text-primary border border-primary/30 px-1.5 py-0.5 font-medium rounded">
                                            You
                                        </span>
                                    )}
                                </div>

                                {profile.title && (
                                    <p className="text-sm text-white/80 mt-0.5">
                                        {profile.title}
                                    </p>
                                )}

                                {/* Tags */}
                                <div className="flex flex-wrap gap-1 mt-1.5">
                                    {profile.departments.map(d => (
                                        <span
                                            key={d.id}
                                            className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-200 border border-blue-500/20"
                                        >
                                            {d.name}
                                        </span>
                                    ))}
                                    {profile.branches.map(b => (
                                        <span
                                            key={b.id}
                                            className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-200 border border-orange-500/20"
                                        >
                                            {b.name}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-2 shrink-0 print:hidden">
                                {isSelf ? (
                                    <Button variant="secondary" size="sm" onClick={onEditProfile}>
                                        <Pencil size={13} /> Edit Profile
                                    </Button>
                                ) : (
                                    <Button size="sm" onClick={onWriteOnWall}>
                                        <MessageSquare size={13} /> Write on Wall
                                    </Button>
                                )}

                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => window.print()}
                                    title="Print"
                                >
                                    <Printer size={13} />
                                </Button>
                            </div>

                        </div>
                    </div>
                </div>

                {/* Stats */}
                <div className="bg-white/10 dark:bg-black/20 backdrop-blur-md border-t border-white/10 px-4 sm:px-6 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/80 print:hidden">

                    <span className="flex items-center gap-1.5">
                        <Building2 size={11} /> Joined {formatDate(profile.createdAt)}
                    </span>

                    <span className="hidden sm:inline text-white/40">·</span>

                    <span className="flex items-center gap-1.5">
                        <Users size={11} /> {profile.reports.length} direct report
                        {profile.reports.length !== 1 ? "s" : ""}
                    </span>

                    <span className="hidden sm:inline text-white/40">·</span>

                    <span className="flex items-center gap-1.5">
                        <MessageSquare size={11} /> {wallPostCount} wall post
                        {wallPostCount !== 1 ? "s" : ""}
                    </span>

                    {profile.userRole && (
                        <>
                            <span className="hidden sm:inline text-white/40">·</span>
                            <span>Rank {profile.userRole.rank}</span>
                        </>
                    )}
                </div>

            </div>
        </div>

        //********************************** */


    );
}

// ── WallTab ───────────────────────────────────────────────────────────────────

function WallTab({
    profile, sessionUserId, posts, loading, focusInput, onPost, onDelete,
}: {
    profile: UserProfile; sessionUserId: number | undefined;
    posts: WallPost[]; loading: boolean; focusInput: boolean;
    onPost: (p: WallPost) => void; onDelete: (id: number) => void;
}) {
    const [body, setBody] = useState("");
    const [posting, setPosting] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => { if (focusInput) textareaRef.current?.focus(); }, [focusInput]);

    async function handlePost() {
        if (!body.trim()) return;
        setPosting(true);
        try {
            const res = await axios.post<WallPost>(`/api/users/${profile.id}/wall`, { body: body.trim() });
            onPost(res.data); setBody("");
        } catch (e) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Failed to post");
        } finally { setPosting(false); }
    }

    async function handleDelete(postId: number) {
        try { await axios.delete(`/api/wall-posts/${postId}`); onDelete(postId); }
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
                                        <Link href={post.author.href}
                                            className="text-sm font-semibold text-foreground hover:text-primary transition-colors">
                                            {post.author.name}
                                        </Link>
                                        {post.author.roleBadge ? (
                                            <Badge className={`${post.author.roleBadge.color} text-[10px]`}>{post.author.roleBadge.label}</Badge>
                                        ) : post.author.isCustomer ? (
                                            <Badge variant="outline" className="text-[10px]">Customer</Badge>
                                        ) : null}
                                        <span className="text-[11px] text-muted-foreground ml-auto">{timeAgo(post.createdAt)}</span>
                                        {canDelete(post) && (
                                            <Button
                                                onClick={() => handleDelete(post.id)}
                                                variant="ghost"
                                                size="icon-xs"
                                                className="text-muted-foreground/65 hover:text-destructive"
                                                title="Delete"
                                            >
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

// ── AboutTab ──────────────────────────────────────────────────────────────────

function AboutTab({ profile }: { profile: UserProfile }) {
    const socials = [
        { key: "linkedIn", label: "LinkedIn", color: "bg-blue-600", href: profile.linkedIn },
        { key: "twitter", label: "Twitter/X", color: "bg-black", href: profile.twitter },
        { key: "instagram", label: "Instagram", color: "bg-pink-600", href: profile.instagram },
        { key: "facebook", label: "Facebook", color: "bg-blue-700", href: profile.facebook },
    ].filter(s => s.href);

    return (
        <div className="space-y-4 max-w-xl">
            {profile.bio && (
                <div className="rounded-lg border border-border bg-card px-5 py-4">
                    <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">About</h3>
                    <p className="text-sm text-foreground leading-relaxed">{profile.bio}</p>
                </div>
            )}
            <div className="rounded-lg border border-border bg-card px-5 py-4 space-y-2.5">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Contact</h3>
                <div className="flex items-center gap-2 text-sm">
                    <Mail size={14} className="shrink-0 text-muted-foreground" />
                    <a href={`mailto:${profile.email}`} className="text-foreground hover:text-primary transition-colors">{profile.email}</a>
                </div>
                {profile.phone && (
                    <div className="flex items-center gap-2 text-sm">
                        <Phone size={14} className="shrink-0 text-muted-foreground" />
                        <a href={`tel:${profile.phone}`} className="text-foreground hover:text-primary transition-colors">{profile.phone}</a>
                    </div>
                )}
                {profile.birthday && (
                    <div className="flex items-center gap-2 text-sm">
                        <Cake size={14} className="shrink-0 text-muted-foreground" />
                        <span>{formatBirthday(profile.birthday)}</span>
                    </div>
                )}
            </div>
            <div className="rounded-lg border border-border bg-card px-5 py-4 space-y-2.5">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Organisation</h3>
                {profile.manager && (
                    <div className="flex items-center gap-2 text-sm">
                        <Users size={14} className="shrink-0 text-muted-foreground" />
                        <span className="text-muted-foreground">Reports to</span>
                        <Link href={`/office/social/users/${profile.manager.id}`}
                            className="font-medium hover:text-primary transition-colors flex items-center gap-1">
                            <UserAvatar avatarUrl={profile.manager.avatarUrl} name={profile.manager.name} role={profile.manager.role} sizePx={18} />
                            {profile.manager.name} <ExternalLink size={10} />
                        </Link>
                    </div>
                )}
                {profile.departments.length > 0 && (
                    <div className="flex items-start gap-2 text-sm">
                        <Building2 size={14} className="shrink-0 text-muted-foreground mt-0.5" />
                        <div className="flex flex-wrap gap-1">
                            {profile.departments.map(d => (
                                <span key={d.id} className="text-[11px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5">{d.name}</span>
                            ))}
                        </div>
                    </div>
                )}
                {profile.branches.length > 0 && (
                    <div className="flex items-start gap-2 text-sm">
                        <Building2 size={14} className="shrink-0 text-muted-foreground mt-0.5" />
                        <div className="flex flex-wrap gap-1">
                            {profile.branches.map(b => (
                                <span key={b.id} className="text-[11px] bg-orange-50 text-orange-700 border border-orange-200 px-1.5 py-0.5">{b.name}</span>
                            ))}
                        </div>
                    </div>
                )}
                <div className="flex items-center gap-2 text-sm">
                    <Building2 size={14} className="shrink-0 text-muted-foreground" />
                    <span className="text-muted-foreground">Scope:</span>
                    <span className="font-medium">{SCOPE_LABELS[profile.scope] ?? profile.scope}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                    <Building2 size={14} className="shrink-0 text-muted-foreground" />
                    <span className="text-muted-foreground">Member since</span>
                    <span className="font-medium">{formatDate(profile.createdAt)}</span>
                </div>
            </div>
            {socials.length > 0 && (
                <div className="rounded-lg border border-border bg-card px-5 py-4">
                    <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Social</h3>
                    <div className="flex flex-wrap gap-2">
                        {socials.map(({ key, label, color, href }) => (
                            <a key={key} href={ensureUrl(href!)} target="_blank" rel="noopener noreferrer"
                                className={`flex items-center gap-1.5 text-xs text-white px-3 py-1.5 ${color} hover:opacity-90 transition-opacity`}>
                                <ExternalLink size={11} /> {label}
                            </a>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// ── EditProfileTab ────────────────────────────────────────────────────────────

const editSchema = z.object({
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Invalid email"),
    title: z.string().optional(),
    bio: z.string().max(500, "Max 500 characters").optional(),
    phone: z.string().optional(),
    birthday: z.string().optional(),
    linkedIn: z.string().optional(),
    twitter: z.string().optional(),
    instagram: z.string().optional(),
    facebook: z.string().optional(),
});
type EditForm = z.infer<typeof editSchema>;

function EditProfileTab({ profile, onSaved }: { profile: UserProfile; onSaved: (p: UserProfile) => void }) {
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [coverUploading, setCoverUploading] = useState(false);
    const [avatarPreview, setAvatarPreview] = useState<string | null>(profile.avatarUrl);
    const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatarUrl);
    const [coverPreview, setCoverPreview] = useState<string | null>(profile.coverUrl);
    const [coverUrl, setCoverUrl] = useState<string | null>(profile.coverUrl);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const coverInputRef = useRef<HTMLInputElement>(null);

    const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<EditForm>({
        resolver: zodResolver(editSchema),
        defaultValues: {
            name: profile.name,
            email: profile.email,
            title: profile.title ?? "",
            bio: profile.bio ?? "",
            phone: profile.phone ?? "",
            birthday: profile.birthday ? profile.birthday.slice(0, 10) : "",
            linkedIn: profile.linkedIn ?? "",
            twitter: profile.twitter ?? "",
            instagram: profile.instagram ?? "",
            facebook: profile.facebook ?? "",
        },
    });

    const bioValue = watch("bio") ?? "";

    async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>, type: "avatar" | "cover") {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith("image/")) { toast.error("Please select an image file"); return; }
        if (file.size > 5 * 1024 * 1024) { toast.error("Image must be under 5 MB"); return; }
        const localUrl = URL.createObjectURL(file);
        if (type === "avatar") { setAvatarPreview(localUrl); setUploading(true); }
        else { setCoverPreview(localUrl); setCoverUploading(true); }
        try {
            const cloudUrl = await uploadToCloudinary(file);
            if (type === "avatar") { setAvatarUrl(cloudUrl); setAvatarPreview(cloudUrl); toast.success("Photo uploaded"); }
            else { setCoverUrl(cloudUrl); setCoverPreview(cloudUrl); toast.success("Cover uploaded"); }
        } catch {
            toast.error("Upload failed — check Cloudinary settings");
            if (type === "avatar") setAvatarPreview(profile.avatarUrl);
            else setCoverPreview(profile.coverUrl);
        } finally {
            if (type === "avatar") setUploading(false);
            else setCoverUploading(false);
        }
    }

    const onSubmit = async (data: EditForm) => {
        setSaving(true);
        try {
            const res = await axios.put<UserProfile>(`/api/users/${profile.id}`, {
                name: data.name, email: data.email, title: data.title || null,
                bio: data.bio || null, phone: data.phone || null, birthday: data.birthday || null,
                linkedIn: data.linkedIn || null, twitter: data.twitter || null,
                instagram: data.instagram || null, facebook: data.facebook || null,
                avatarUrl, coverUrl,
            });
            toast.success("Profile saved");
            onSaved(res.data);
        } catch (e) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Failed to save");
        } finally { setSaving(false); }
    };

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 max-w-xl">

            {/* Cover photo */}
            <div className="rounded-lg border border-border bg-card p-5 space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Cover Photo</h3>
                <div className="relative h-28 overflow-hidden rounded-sm border border-border">
                    {coverPreview
                        ? <Image src={coverPreview} alt="Cover" fill className="object-cover" loader={imageLoaderFor(coverPreview)} />
                        : <div className="absolute inset-0" style={{ background: "linear-gradient(135deg,#334155,#64748b)" }} />
                    }
                    {coverUploading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        </div>
                    )}
                    <div className="absolute bottom-2 right-2 flex gap-2">
                        <input ref={coverInputRef} type="file" accept="image/*" className="hidden"
                            onChange={e => handleFileChange(e, "cover")} />
                        <Button type="button" size="sm" variant="outline"
                            className="bg-white/90 text-xs h-7 px-2" disabled={coverUploading}
                            onClick={() => coverInputRef.current?.click()}>
                            <Upload size={12} /> {coverUploading ? "Uploading…" : "Change Cover"}
                        </Button>
                        {coverUrl && (
                            <Button type="button" size="sm" variant="outline"
                                className="bg-white/90 text-destructive text-xs h-7 px-2"
                                onClick={() => { setCoverUrl(null); setCoverPreview(null); }}>
                                Remove
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            {/* Profile photo */}
            <div className="rounded-lg border border-border bg-card p-5 space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Profile Photo</h3>
                <div className="flex items-center gap-5">
                    <div className="relative shrink-0">
                        <UserAvatar avatarUrl={avatarPreview} name={profile.name} role={profile.role} sizePx={80} />
                        {uploading && (
                            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
                                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                            </div>
                        )}
                    </div>
                    <div className="space-y-2">
                        <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                            onChange={e => handleFileChange(e, "avatar")} />
                        <Button type="button" variant="outline" size="sm" disabled={uploading}
                            onClick={() => fileInputRef.current?.click()}>
                            <Upload size={13} /> {uploading ? "Uploading…" : "Upload Photo"}
                        </Button>
                        {avatarUrl && (
                            <Button type="button" variant="ghost" size="sm"
                                className="text-destructive hover:text-destructive text-xs"
                                onClick={() => { setAvatarUrl(null); setAvatarPreview(null); }}>
                                Remove photo
                            </Button>
                        )}
                        <p className="text-[11px] text-muted-foreground">JPG, PNG or WebP · max 5 MB</p>
                    </div>
                </div>
                <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5"><Link2 size={12} /> Or paste a photo URL</Label>
                    <Input placeholder="https://example.com/photo.jpg" value={avatarUrl ?? ""}
                        onChange={e => { setAvatarUrl(e.target.value || null); setAvatarPreview(e.target.value || null); }} />
                </div>
            </div>

            {/* Identity */}
            <div className="rounded-lg border border-border bg-card p-5 space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Identity</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2 space-y-1.5">
                        <Label>Full Name</Label>
                        <Input {...register("name")} />
                        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
                    </div>
                    <div className="space-y-1.5">
                        <Label>Email</Label>
                        <Input {...register("email")} />
                        {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
                    </div>
                    <div className="space-y-1.5">
                        <Label>Job Title <span className="text-muted-foreground font-normal">(optional)</span></Label>
                        <Input {...register("title")} placeholder="e.g. Senior Technician" />
                    </div>
                    <div className="sm:col-span-2 space-y-1.5">
                        <Label>Bio <span className="text-muted-foreground font-normal">(optional)</span></Label>
                        <Textarea {...register("bio")} placeholder="A short intro about yourself…" rows={3} />
                        <p className="text-[11px] text-muted-foreground text-right">{bioValue.length}/500</p>
                        {errors.bio && <p className="text-xs text-destructive">{errors.bio.message}</p>}
                    </div>
                </div>
            </div>

            {/* Contact */}
            <div className="rounded-lg border border-border bg-card p-5 space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Contact</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <Label>Phone <span className="text-muted-foreground font-normal">(optional)</span></Label>
                        <Input {...register("phone")} placeholder="+880-xxx-xxx-xxxx" />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Birthday <span className="text-muted-foreground font-normal">(optional)</span></Label>
                        <TallyDateInput
                            value={watch("birthday") ?? ""}
                            onValueChange={(iso) => setValue("birthday", iso, { shouldValidate: true })}
                        />
                    </div>
                </div>
            </div>

            {/* Social */}
            <div className="rounded-lg border border-border bg-card p-5 space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Social Media</h3>
                <div className="space-y-3">
                    {([
                        { name: "linkedIn" as const, label: "LinkedIn", placeholder: "linkedin.com/in/yourname" },
                        { name: "twitter" as const, label: "Twitter/X", placeholder: "twitter.com/yourhandle" },
                        { name: "instagram" as const, label: "Instagram", placeholder: "instagram.com/yourhandle" },
                        { name: "facebook" as const, label: "Facebook", placeholder: "facebook.com/yourprofile" },
                    ]).map(({ name, label, placeholder }) => (
                        <div key={name} className="flex items-center gap-2">
                            <span className="w-20 shrink-0 text-xs text-muted-foreground font-medium">{label}</span>
                            <Input {...register(name)} placeholder={placeholder} className="flex-1" />
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex justify-end">
                <Button type="submit" disabled={saving || uploading || coverUploading}>
                    {saving ? "Saving…" : "Save Profile"}
                </Button>
            </div>
        </form>
    );
}

// ── SecurityTab ───────────────────────────────────────────────────────────────

const securitySchema = z.object({
    password: z.string().min(6, "Min 6 characters"),
    confirmPassword: z.string(),
}).refine(d => d.password === d.confirmPassword, { message: "Passwords do not match", path: ["confirmPassword"] });
type SecurityForm = z.infer<typeof securitySchema>;

/** Password and forwarding for the person or an admin (`users:edit`); the counter PIN
 *  only ever for the person themselves — its route has no id to aim elsewhere. */
function SecurityTab({ profileId, isSelf }: { profileId: number; isSelf: boolean }) {
    const [saving, setSaving] = useState(false);
    const { register, handleSubmit, reset, formState: { errors } } = useForm<SecurityForm>({
        resolver: zodResolver(securitySchema),
        defaultValues: { password: "", confirmPassword: "" },
    });

    const onSubmit = async (data: SecurityForm) => {
        setSaving(true);
        try {
            await axios.patch(`/api/users/${profileId}/password`, { password: data.password });
            toast.success("Password changed successfully");
            reset();
        } catch (e) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Failed to change password");
        } finally { setSaving(false); }
    };

    return (
        <div className="max-w-sm">
            <form onSubmit={handleSubmit(onSubmit)} className="rounded-lg border border-border bg-card p-5 space-y-4">
                <div className="flex items-center gap-2 mb-1">
                    <Lock size={14} className="text-muted-foreground" />
                    <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Change Password</h3>
                </div>
                <p className="text-xs text-muted-foreground">Choose a strong password of at least 6 characters.</p>
                <div className="space-y-1.5">
                    <Label>New Password</Label>
                    <Input {...register("password")} type="password" placeholder="Min 6 characters" />
                    {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
                </div>
                <div className="space-y-1.5">
                    <Label>Confirm Password</Label>
                    <Input {...register("confirmPassword")} type="password" placeholder="Repeat new password" />
                    {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>}
                </div>
                <div className="flex justify-end pt-1">
                    <Button type="submit" disabled={saving}>{saving ? "Changing…" : "Change Password"}</Button>
                </div>
            </form>
            <ForwardEmailCard userId={profileId} isSelf={isSelf} />
            {isSelf && <CounterPinCard />}
        </div>
    );
}

type Forwarding = { address: string; forwardTo: string | null; verified: boolean; enabled: boolean; catchAll: string | null };

/** Where a staff address forwards — Cloudflare Email Routing. Until it is set, the
 *  catch-all takes the mail, so "Forgot password" codes reach the office, not the person. */
function ForwardEmailCard({ userId, isSelf }: { userId: number; isSelf: boolean }) {
    const [state, setState] = useState<Forwarding | null>(null);
    const [unavailable, setUnavailable] = useState("");
    const [forwardTo, setForwardTo] = useState("");
    const [busy, setBusy] = useState(false);

    const load = async () => {
        try {
            const { data } = await axios.get<Forwarding>(`/api/users/${userId}/forward-email`);
            setState(data); setUnavailable("");
            setForwardTo(f => f || data.forwardTo || "");
        } catch (e) {
            setUnavailable(axios.isAxiosError(e) ? e.response?.data?.error ?? "Could not reach the office" : "Could not read your forwarding");
        }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the profile changes
    useEffect(() => { void load(); }, [userId]);

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            const { data } = await axios.put<Forwarding>(`/api/users/${userId}/forward-email`, { forwardTo });
            setState(data);
            toast.success(data.verified ? "Forwarding saved" : "Saved — open Cloudflare's email in that inbox and click Verify");
        } catch (e) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error ?? "Could not reach the office" : "Could not save your forwarding");
        } finally { setBusy(false); }
    };

    const status = !state?.forwardTo
        ? (state?.catchAll ? `Not set — going to catch-all (${state.catchAll})` : "Not set")
        : !state.verified ? "Waiting for verify"
        : state.enabled ? "Active" : "Turned off";

    return (
        <form onSubmit={save} className="mt-4 rounded-lg border border-border bg-card p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
                <Mail size={14} className="text-muted-foreground" />
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Forward Email</h3>
            </div>
            {unavailable ? (
                <p className="text-xs text-muted-foreground">{unavailable}</p>
            ) : (
                <>
                    <p className="text-xs text-muted-foreground">
                        Mail to <span className="font-medium text-foreground">{state?.address ?? (isSelf ? "your staff address" : "this staff address")}</span> goes
                        to this inbox — needed for Forgot password.
                    </p>
                    <div className="space-y-1.5">
                        <Label>Personal email</Label>
                        <Input type="email" autoComplete="email" value={forwardTo} onChange={e => setForwardTo(e.target.value)} placeholder="you@gmail.com" />
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1">
                        <button type="button" className="text-xs text-muted-foreground underline" onClick={() => void load()}>
                            {state ? status : "Loading…"}
                        </button>
                        <Button type="submit" disabled={busy || !state || !forwardTo.trim()}>{busy ? "Saving…" : "Save"}</Button>
                    </div>
                </>
            )}
        </form>
    );
}

/** Your own counter PIN — `/api/me/counter-pin` has no user id, so this only ever
 *  touches the signed-in person. Setting works only on a counter (the route says so
 *  when it is not); removing from all counters works anywhere. Both need the line up. */
function CounterPinCard() {
    const [pin, setPin] = useState("");
    const [pinAgain, setPinAgain] = useState("");
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const digits = (v: string) => v.replace(/\D/g, "").slice(0, 6);

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        if (pin !== pinAgain) { toast.error("The two PINs are not the same."); return; }
        setBusy(true);
        try {
            await axios.put("/api/me/counter-pin", { pin, password });
            toast.success("PIN saved for this counter");
            setPin(""); setPinAgain(""); setPassword("");
        } catch (e) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error ?? "Could not reach the office" : "Could not save your PIN");
        } finally { setBusy(false); }
    };

    const remove = async (scope: "counter" | "all") => {
        const where = scope === "all" ? "every counter" : "this counter";
        if (!confirm(`Remove your PIN from ${where}? You will sign in with your password there.`)) return;
        setBusy(true);
        try {
            await axios.delete(`/api/me/counter-pin?scope=${scope}`);
            toast.success(`PIN removed from ${where}`);
        } catch (e) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error ?? "Could not reach the office" : "Could not remove your PIN");
        } finally { setBusy(false); }
    };

    return (
        <form onSubmit={save} className="mt-4 rounded-lg border border-border bg-card p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
                <Lock size={14} className="text-muted-foreground" />
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Counter PIN</h3>
            </div>
            <p className="text-xs text-muted-foreground">Six digits to sign in on this counter. Saved only for the counter you are on.</p>
            <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                    <Label>New PIN</Label>
                    <Input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={e => setPin(digits(e.target.value))} placeholder="6 digits" />
                </div>
                <div className="space-y-1.5">
                    <Label>Confirm PIN</Label>
                    <Input type="password" inputMode="numeric" autoComplete="off" value={pinAgain} onChange={e => setPinAgain(digits(e.target.value))} placeholder="Repeat" />
                </div>
            </div>
            <div className="space-y-1.5">
                <Label>Your Password</Label>
                <Input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Needed to set a PIN" />
            </div>
            <div className="flex justify-end pt-1">
                <Button type="submit" disabled={busy || pin.length !== 6 || !password}>{busy ? "Saving…" : "Set PIN"}</Button>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
                <span className="mr-auto text-xs text-muted-foreground">Remove PIN</span>
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => remove("counter")}>This counter</Button>
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => remove("all")}>All counters</Button>
            </div>
        </form>
    );
}

// ── OrgPositionTab ────────────────────────────────────────────────────────────

// ── FriendsTab ────────────────────────────────────────────────────────────────
// A staff member's friends = the joined customers (implicit model). Cards link to
// the office customer profile (the portal profile is customer-gated).
interface SocialFriend {
    kind: "USER" | "PERSON"; id: number; name: string; avatarUrl: string | null;
    role: string | null; roleBadge: { label: string; color: string } | null; isCustomer: boolean;
}
function FriendsTab({ userId }: { userId: number }) {
    const [friends, setFriends] = useState<SocialFriend[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        axios.get<SocialFriend[]>(`/api/users/${userId}/friends`)
            .then((r) => setFriends(r.data))
            .catch(() => toast.error("Failed to load friends"))
            .finally(() => setLoading(false));
    }, [userId]);

    if (loading) return <p className="py-8 text-center text-sm text-muted-foreground">Loading friends…</p>;
    if (friends.length === 0) {
        return (
            <div className="border-2 border-dashed border-border bg-card/50 py-12 text-center">
                <Users size={28} className="mx-auto text-muted-foreground/65" />
                <p className="mt-1 text-sm text-muted-foreground">No friends yet.</p>
            </div>
        );
    }
    return (
        <div className="max-w-3xl">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{friends.length} friend{friends.length !== 1 ? "s" : ""}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {friends.map((f) => (
                    <Link
                        key={`${f.kind}-${f.id}`}
                        href={f.kind === "USER" ? `/office/social/users/${f.id}` : `/office/customers/all?personId=${f.id}`}
                        className="flex items-center gap-2.5 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/50"
                    >
                        <UserAvatar avatarUrl={f.avatarUrl} name={f.name} role={f.role} sizePx={36} />
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{f.name}</p>
                            <p className="text-[11px] text-muted-foreground">{f.isCustomer ? "Customer" : (f.roleBadge?.label ?? "Staff")}</p>
                        </div>
                    </Link>
                ))}
            </div>
        </div>
    );
}

function OrgPositionTab() {
    const [structure, setStructure] = useState<OrgStructure | null>(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        axios.get<OrgStructure>("/api/positions/structure")
            .then(r => setStructure(r.data))
            .catch(() => toast.error("Failed to load org chart"))
            .finally(() => setLoading(false));
    }, []);
    if (loading) return <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">Loading org chart…</div>;
    if (!structure || (structure.orgWidePositions.length === 0 && structure.branches.every(b => b.deptGroups.length === 0)))
        return <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">No positions defined yet.</div>;
    return <StructureTree structure={structure} />;
}

function ActivityTimelineTab({
    profileId, items, loading, period, onPeriodChange,
}: {
    profileId: number;
    items: UserActivity[];
    loading: boolean;
    period: "today" | "7d" | "30d";
    onPeriodChange: (period: "today" | "7d" | "30d") => void;
}) {
    const periodButtons: { id: "today" | "7d" | "30d"; label: string }[] = [
        { id: "today", label: "Today" },
        { id: "7d", label: "Last 7 days" },
        { id: "30d", label: "Last 30 days" },
    ];
    const eventTone: Record<UserActivity["type"], string> = {
        ticket_created: "bg-emerald-100 text-emerald-700 border-emerald-200",
        ticket_updated: "bg-blue-100 text-blue-700 border-blue-200",
        wall_post: "bg-violet-100 text-violet-700 border-violet-200",
        user_joined: "bg-slate-100 text-slate-700 border-slate-200",
        login_untracked: "bg-amber-100 text-amber-700 border-amber-200",
        logout_untracked: "bg-amber-100 text-amber-700 border-amber-200",
    };

    if (loading) return <p className="text-center text-sm text-muted-foreground py-8">Loading activity timeline…</p>;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                {periodButtons.map((button) => (
                    <Button
                        key={button.id}
                        type="button"
                        size="sm"
                        variant={period === button.id ? "default" : "outline"}
                        onClick={() => onPeriodChange(button.id)}
                    >
                        {button.label}
                    </Button>
                ))}
            </div>

            {items.length === 0 ? (
                <div className="border-2 border-dashed border-border bg-card/50 py-12 text-center space-y-1">
                    <Activity size={28} className="mx-auto text-muted-foreground/65" />
                    <p className="text-sm text-muted-foreground">No tracked activity in this time range.</p>
                </div>
            ) : (
                <div className="rounded-lg border border-border bg-card divide-y divide-border">
                    {items.map((item) => (
                        <div key={item.id} className="px-4 py-3.5">
                            <div className="flex items-start gap-3">
                                <div className="mt-0.5 h-2 w-2 rounded-full bg-primary shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <p className="text-sm font-medium text-foreground">{item.title}</p>
                                        <span className={`text-[10px] border px-1.5 py-0.5 ${eventTone[item.type]}`}>
                                            {item.type.replaceAll("_", " ")}
                                        </span>
                                        <span className="ml-auto text-[11px] text-muted-foreground">
                                            {timeAgo(item.createdAt)} ({formatTimeOnly(item.createdAt)})
                                        </span>
                                    </div>
                                    <p className="text-sm text-muted-foreground mt-1">{item.description}</p>
                                    {item.meta?.ticketId && (
                                        <Link href={`/office/repairing/tickets/${item.meta.ticketId}`} className="text-xs text-primary hover:underline mt-1 inline-block">
                                            Open ticket #{item.meta.ticketId}
                                        </Link>
                                    )}
                                    {item.meta?.wallUserId && item.meta.wallUserId !== profileId && (
                                        <Link href={`/office/social/users/${item.meta.wallUserId}`} className="text-xs text-primary hover:underline mt-1 inline-block">
                                            Open {item.meta.wallUserName ?? "user"} profile
                                        </Link>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function ProfileSidebar({ profile }: { profile: UserProfile }) {
    return (
        <aside className="w-56 shrink-0 space-y-4">
            <div className="overflow-hidden rounded-lg border border-border bg-card">
                <div className="border-b border-border bg-muted/40 px-3 py-2">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                        <Info size={11} /> Info
                    </span>
                </div>
                <div className="px-3 py-3 space-y-2.5 text-xs">
                    {profile.manager && (
                        <div>
                            <p className="text-muted-foreground mb-0.5">Reports to</p>
                            <Link href={`/office/social/users/${profile.manager.id}`}
                                className="font-medium text-foreground hover:text-primary flex items-center gap-1.5 transition-colors">
                                <UserAvatar avatarUrl={profile.manager.avatarUrl} name={profile.manager.name} role={profile.manager.role} sizePx={18} />
                                {profile.manager.name}
                            </Link>
                        </div>
                    )}
                    {profile.departments.length > 0 && (
                        <div>
                            <p className="text-muted-foreground mb-0.5">Department</p>
                            <p className="font-medium text-foreground">{profile.departments.map(d => d.name).join(", ")}</p>
                        </div>
                    )}
                    {profile.branches.length > 0 && (
                        <div>
                            <p className="text-muted-foreground mb-0.5">Branch</p>
                            <p className="font-medium text-foreground">{profile.branches.map(b => b.name).join(", ")}</p>
                        </div>
                    )}
                    <div>
                        <p className="text-muted-foreground mb-0.5">Member since</p>
                        <p className="font-medium text-foreground">{formatDate(profile.createdAt)}</p>
                    </div>
                    <div>
                        <p className="text-muted-foreground mb-0.5">Scope</p>
                        <p className="font-medium text-foreground">{SCOPE_LABELS[profile.scope] ?? profile.scope}</p>
                    </div>
                </div>
            </div>

            {profile.reports.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                    <div className="border-b border-border bg-muted/40 px-3 py-2">
                        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                            <Users size={11} /> Team ({profile.reports.length})
                        </span>
                    </div>
                    <div className="p-3 grid grid-cols-3 gap-2">
                        {profile.reports.slice(0, 9).map(r => (
                            <Link key={r.id} href={`/office/social/users/${r.id}`}
                                className="flex flex-col items-center gap-1 text-center group">
                                <UserAvatar avatarUrl={r.avatarUrl} name={r.name} role={r.role} sizePx={40}
                                    className="group-hover:ring-2 group-hover:ring-primary transition-all" />
                                <span className="text-[10px] text-muted-foreground group-hover:text-primary transition-colors leading-tight truncate w-full text-center">
                                    {r.name.split(" ")[0]}
                                </span>
                            </Link>
                        ))}
                    </div>
                    {profile.reports.length > 9 && (
                        <div className="border-t border-border px-3 py-2 text-center">
                            <span className="text-[11px] text-muted-foreground">+{profile.reports.length - 9} more</span>
                        </div>
                    )}
                </div>
            )}
        </aside>
    );
}

// ── Tab definitions ───────────────────────────────────────────────────────────

const TABS = [
    { id: 1 as const, label: "Wall", icon: MessageSquare, access: "all" },
    { id: 2 as const, label: "About", icon: Info, access: "all" },
    { id: 3 as const, label: "Activity Timeline", icon: Activity, access: "all" },
    { id: 4 as const, label: "Edit Profile", icon: Pencil, access: "self" },
    { id: 5 as const, label: "Security", icon: Lock, access: "selfOrAdmin" },
    // { id: 6 as const, label: "Permissions", icon: Shield, access: "selfOrAdmin" },
    { id: 6 as const, label: "Org Position", icon: GitBranch, access: "all" },
    { id: 7 as const, label: "Friends", icon: Users, access: "all" },
    // HR & People — the details HR keeps on file that the person knows best.
    { id: 8 as const, label: "Personal & Bank", icon: IdCard, access: "selfOrAdmin" },
    // What they were paid, per period. Not default-open like the rest of the
    // profile: pay is the person's own business and HR's, so the API refuses
    // anyone else even if this tab were somehow reached.
    { id: 9 as const, label: "Salary Slips", icon: Receipt, access: "selfOrAdmin" },
    // The printable staff identity card. Open to everyone who can see the
    // profile, exactly like the HR staff profile's own "Identity" tab — it
    // carries nothing the About tab does not already show.
    { id: 10 as const, label: "ID Card", icon: CreditCard, access: "all" },
];
type TabId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

// ── Page ─────────────────────────────────────────────────────────────────────

export default function UserProfilePage() {
    const { id } = useParams<{ id: string }>();
    const { data: session } = useSession();
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [wallPosts, setWallPosts] = useState<WallPost[]>([]);
    const [activityItems, setActivityItems] = useState<UserActivity[]>([]);
    const [loading, setLoading] = useState(true);
    const [wallLoading, setWallLoading] = useState(true);
    const [activityLoading, setActivityLoading] = useState(true);
    const [activityPeriod, setActivityPeriod] = useState<"today" | "7d" | "30d">("today");
    const [activeTab, setActiveTab] = useState<TabId>(1);
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [focusWall, setFocusWall] = useState(false);

    const sessionUserId = session?.user ? Number((session.user as { id?: string }).id) : undefined;
    const isSelf = sessionUserId !== undefined && sessionUserId === Number(id);
    const isAdmin = Boolean(
        (session?.user as { permissions?: string[] })?.permissions?.includes("users:edit") ||
        (session?.user as { permissions?: string[] })?.permissions?.includes("admin:bypass")
    );
    // HR & People: who may change the personal / bank section (self, or the HR
    // grant), and who may follow the link into the HR profile (the HR sidebar link).
    const sessionPermissions = (session?.user as { permissions?: string[] })?.permissions ?? [];
    const canEditHr = hasPermissionWithScope(sessionPermissions, PERMISSIONS.HR_STAFF_EDIT);
    const canOpenHr = hasModuleNavAccess(sessionPermissions, "hr");

    useEffect(() => {
        const loadProfileAndWall = async () => {
            setLoading(true);
            setWallLoading(true);
            setActiveTab(1);

            const profilePromise = axios.get<UserProfile>(`/api/users/${id}`)
                .then(r => setProfile(r.data))
                .catch(e => {
                    if (!axios.isAxiosError(e) || e.response?.status !== 404) {
                        toast.error("Failed to load profile");
                    }
                })
                .finally(() => setLoading(false));

            const wallPromise = axios.get<WallPost[]>(`/api/users/${id}/wall`)
                .then(r => setWallPosts(r.data))
                .catch(e => {
                    if (!axios.isAxiosError(e) || e.response?.status !== 404) {
                        toast.error("Failed to load wall");
                    }
                })
                .finally(() => setWallLoading(false));

            await Promise.all([profilePromise, wallPromise]);
        };

        void loadProfileAndWall();
    }, [id]);

    // Someone else posting on this wall announces `tasks`. Only the wall is
    // re-read — rerunning the block above would reset the open tab and flash
    // the whole profile through its loading state for a single new post.
    useRealtimeTopics(["tasks"], () => {
        axios.get<WallPost[]>(`/api/users/${id}/wall`)
            .then((r) => setWallPosts(r.data))
            .catch(() => { /* keep the posts already shown */ });
    });

    useEffect(() => {
        const loadActivity = async () => {
            setActivityLoading(true);
            try {
                const response = await axios.get<{ items: UserActivity[] }>(`/api/users/${id}/activity`, {
                    params: { period: activityPeriod, limit: 120 },
                });
                setActivityItems(response.data.items);
            } catch (e) {
                if (!axios.isAxiosError(e) || e.response?.status !== 404) {
                    toast.error("Failed to load activity timeline");
                }
            } finally {
                setActivityLoading(false);
            }
        };
        void loadActivity();
    }, [id, activityPeriod]);

    function handleWriteOnWall() {
        setActiveTab(1);
        setFocusWall(true); setTimeout(() => setFocusWall(false), 300);
    }

    const visibleTabs = TABS.filter(t => {
        if (t.access === "all") return true;
        if (t.access === "self") return isSelf;
        if (t.access === "selfOrAdmin") return isSelf || isAdmin;
        return false;
    });

    if (loading) return <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">Loading profile…</div>;
    if (!profile) return (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
            <p className="text-sm text-muted-foreground">User not found.</p>
            <Button asChild variant="outline" size="sm">
                <Link href="/office/admin/users"><ArrowLeft size={14} /> Back to Users</Link>
            </Button>
        </div>
    );

    return (
        <ScrollArea className="h-full" type="always">
        <div className="p-4">
            {/* Back nav */}
            <div className="flex items-center gap-2 mb-4 print:hidden">
                <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
                    <Link href="/office/admin/users"><ArrowLeft size={14} /> All Users</Link>
                </Button>
            </div>

            {/* Profile header */}
            <ProfileHeader
                profile={profile} isSelf={isSelf} wallPostCount={wallPosts.length}
                onWriteOnWall={handleWriteOnWall}
                onEditProfile={() => setActiveTab(4)}
            />

            {/* Tab bar */}
            <div className="print:hidden">
                <div className="mb-5 flex items-start border-b border-border">
                    {/* Wrapping tab list — every tab stays visible, no sideways scroll */}
                    <div className="flex flex-1 flex-wrap">
                        {sessionUserId !== undefined && !isSelf && (
                            <Button asChild variant="ghost"
                                className="h-auto flex items-center gap-1.5 rounded-none px-2.5 py-2.5 text-sm font-medium border-b-2 border-transparent text-muted-foreground hover:text-foreground hover:border-border whitespace-nowrap shrink-0"
                                title="My profile">
                                <Link href={`/office/social/users/${sessionUserId}`}>
                                    <Home size={13} />
                                    <span>Home</span>
                                </Link>
                            </Button>
                        )}
                        {visibleTabs.map(tab => {
                            const Icon = tab.icon;
                            const active = activeTab === tab.id;
                            return (
                                <Button key={tab.id} onClick={() => setActiveTab(tab.id)} variant="ghost"
                                    className={[
                                        "h-auto flex items-center gap-1.5 rounded-none px-2.5 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0",
                                        active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
                                    ].join(" ")}>
                                    <Icon size={13} />
                                    <span>{tab.label}</span>
                                </Button>
                            );
                        })}
                    </div>
                    {/* Sidebar toggle */}
                    <div className="flex items-stretch shrink-0 self-start border-l border-border">
                        <Button onClick={() => setSidebarOpen(prev => !prev)} variant="ghost"
                            className="h-auto rounded-none px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground"
                            title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}>
                            {sidebarOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
                            <span className="hidden sm:inline">{sidebarOpen ? "Hide" : "Info"}</span>
                        </Button>
                    </div>
                </div>
            </div>

            {/* Main layout */}
            <div className="flex gap-5 items-start">
                <div className="flex-1 min-w-0">
                    {activeTab === 1 && (
                        <WallTab
                            profile={profile} sessionUserId={sessionUserId}
                            posts={wallPosts} loading={wallLoading} focusInput={focusWall}
                            onPost={post => setWallPosts(prev => [post, ...prev])}
                            onDelete={postId => setWallPosts(prev => prev.filter(p => p.id !== postId))}
                        />
                    )}
                    {activeTab === 2 && <AboutTab profile={profile} />}
                    {activeTab === 3 && (
                        <ActivityTimelineTab
                            profileId={profile.id}
                            items={activityItems}
                            loading={activityLoading}
                            period={activityPeriod}
                            onPeriodChange={setActivityPeriod}
                        />
                    )}
                    {activeTab === 4 && isSelf && (
                        <EditProfileTab profile={profile}
                            onSaved={updated => setProfile(prev => prev ? { ...prev, ...updated } : prev)} />
                    )}
                    {activeTab === 5 && (isSelf || isAdmin) && <SecurityTab profileId={profile.id} isSelf={isSelf} />}
                    {activeTab === 6 && <OrgPositionTab />}
                    {activeTab === 7 && <FriendsTab userId={profile.id} />}
                    {activeTab === 8 && (isSelf || isAdmin) && (
                        <StaffPersonalForm
                            userId={profile.id}
                            canEdit={isSelf || canEditHr}
                            hrHref={canOpenHr ? `/office/hr/staff?user=${profile.id}` : null}
                        />
                    )}
                    {activeTab === 9 && (isSelf || isAdmin) && <StaffPayslips userId={profile.id} />}
                    {activeTab === 10 && <StaffIdCardTab userId={profile.id} />}
                </div>

                {/* Collapsible sidebar — hidden on small screens */}
                {sidebarOpen && (
                    <div className="hidden lg:block">
                        <ProfileSidebar profile={profile} />
                    </div>
                )}
            </div>
        </div>
        </ScrollArea>
    );
}
