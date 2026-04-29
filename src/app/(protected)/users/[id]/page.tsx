"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Image from "next/image";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import {
    ArrowLeft, Shield, Mail, Phone, Cake, Building2, Users,
    ShieldCheck, Pencil, GitBranch, Upload, Link2, ExternalLink,
    MessageSquare, Info, Lock, Trash2, PanelRightOpen, PanelRightClose,
    Send, UserCircle, Printer,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format-date";
import type { OrgNode } from "@/app/api/org-chart/route";
import OrgTree from "@/modules/admin/components/OrgTree";

// ── Types ────────────────────────────────────────────────────────────────────

interface Permission {
    id: string; label: string; module: string; description: string | null;
}
interface StaffCard {
    id: number; name: string; title: string | null; role: string;
    avatarUrl: string | null;
    userRole: { label: string; color: string };
}
interface UserProfile {
    id: number; name: string; email: string; title: string | null;
    role: string; scope: string; createdAt: string; managerId: number | null;
    avatarUrl:  string | null;
    phone:      string | null;
    birthday:   string | null;
    bio:        string | null;
    linkedIn:   string | null;
    twitter:    string | null;
    instagram:  string | null;
    facebook:   string | null;
    userRole: { id: string; label: string; color: string; rank: number; permissions: { permission: Permission }[] };
    manager:  StaffCard | null;
    reports:  StaffCard[];
    departments: { id: string; name: string }[];
    branches:    { id: string; name: string }[];
}
interface WallPost {
    id: number;
    body: string;
    createdAt: string;
    author: {
        id: number; name: string; avatarUrl: string | null; role: string;
        userRole: { label: string; color: string };
    };
}

// ── Constants ────────────────────────────────────────────────────────────────

const SCOPE_LABELS: Record<string, string> = {
    OWN: "Own records", TEAM: "Direct reports", DEPARTMENT: "Full department",
    BRANCH: "Full branch", REGION: "Region-wide", ORG: "Entire organisation",
};
const MODULE_ORDER = ["core", "customers", "tickets", "assignments", "service", "admin"];
const AVATAR_COLOR: Record<string, string> = {
    R1: "bg-purple-100 text-purple-700", R2: "bg-blue-100 text-blue-700",
    R3: "bg-green-100 text-green-700",   R4: "bg-orange-100 text-orange-700",
    R5: "bg-pink-100 text-pink-700",
};
const COVER_GRADIENT: Record<string, string> = {
    R1: "linear-gradient(135deg,#7c3aed 0%,#a855f7 100%)",
    R2: "linear-gradient(135deg,#1d4ed8 0%,#3b82f6 100%)",
    R3: "linear-gradient(135deg,#15803d 0%,#22c55e 100%)",
    R4: "linear-gradient(135deg,#c2410c 0%,#f97316 100%)",
    R5: "linear-gradient(135deg,#be185d 0%,#ec4899 100%)",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string) {
    return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}
function avatarBg(role: string) {
    return AVATAR_COLOR[role] ?? "bg-gray-100 text-gray-600";
}
function coverGradient(role: string) {
    return COVER_GRADIENT[role] ?? "linear-gradient(135deg,#334155 0%,#64748b 100%)";
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

// ── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({
    avatarUrl, name, role, sizePx = 64, className = "",
}: { avatarUrl: string | null; name: string; role: string; sizePx?: number; className?: string }) {
    const [err, setErr] = useState(false);
    if (avatarUrl && !err) {
        return (
            <div className={`rounded-full overflow-hidden shrink-0 ${className}`}
                style={{ width: sizePx, height: sizePx }}>
                <Image src={avatarUrl} alt={name} width={sizePx} height={sizePx}
                    className="object-cover w-full h-full" onError={() => setErr(true)} />
            </div>
        );
    }
    return (
        <div className={`flex shrink-0 items-center justify-center rounded-full font-bold ${avatarBg(role)} ${className}`}
            style={{ width: sizePx, height: sizePx, fontSize: sizePx * 0.32 }}>
            {initials(name)}
        </div>
    );
}

// ── Cloudinary upload ─────────────────────────────────────────────────────────

async function uploadToCloudinary(file: File): Promise<string> {
    const { data: sig } = await axios.get<{
        timestamp: number; signature: string; apiKey: string; cloudName: string; folder: string;
    }>("/api/upload-signature");
    const form = new FormData();
    form.append("file", file);
    form.append("api_key",   sig.apiKey);
    form.append("timestamp", String(sig.timestamp));
    form.append("signature", sig.signature);
    form.append("folder",    sig.folder);
    const res = await axios.post<{ secure_url: string }>(
        `https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`, form,
    );
    return res.data.secure_url;
}

// ── ProfileHeader ─────────────────────────────────────────────────────────────

function ProfileHeader({
    profile, isSelf, wallPostCount,
    onWriteOnWall, onEditProfile,
}: {
    profile: UserProfile;
    isSelf: boolean;
    wallPostCount: number;
    onWriteOnWall: () => void;
    onEditProfile: () => void;
}) {
    return (
        <div className="border-2 border-border overflow-hidden mb-1 print:border-0">
            {/* Cover strip */}
            <div className="h-36" style={{ background: coverGradient(profile.role) }} />

            {/* Avatar + name row */}
            <div className="bg-card px-5 pb-4">
                <div className="flex items-end gap-4 -mt-12">
                    {/* Avatar with white ring */}
                    <div className="shrink-0 rounded-full border-4 border-card"
                        style={{ lineHeight: 0 }}>
                        <Avatar avatarUrl={profile.avatarUrl} name={profile.name}
                            role={profile.role} sizePx={96} />
                    </div>

                    {/* Name + actions */}
                    <div className="flex-1 pb-1 flex items-end justify-between gap-4 min-w-0 pt-12">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <h1 className="text-xl font-bold text-foreground leading-tight">
                                    {profile.name}
                                </h1>
                                <Badge className={`${profile.userRole.color} text-xs`}>
                                    {profile.userRole.label}
                                </Badge>
                                {isSelf && (
                                    <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 font-medium">
                                        You
                                    </span>
                                )}
                            </div>
                            {profile.title && (
                                <p className="text-sm text-muted-foreground mt-0.5">
                                    {profile.title}
                                </p>
                            )}
                            <div className="flex flex-wrap gap-1 mt-1.5">
                                {profile.departments.map(d => (
                                    <span key={d.id} className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5">
                                        {d.name}
                                    </span>
                                ))}
                                {profile.branches.map(b => (
                                    <span key={b.id} className="text-[10px] bg-orange-50 text-orange-700 border border-orange-200 px-1.5 py-0.5">
                                        {b.name}
                                    </span>
                                ))}
                            </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 print:hidden">
                            {isSelf ? (
                                <Button variant="outline" size="sm" onClick={onEditProfile}>
                                    <Pencil size={13} /> Edit Profile
                                </Button>
                            ) : (
                                <Button size="sm" onClick={onWriteOnWall}>
                                    <MessageSquare size={13} /> Write on Wall
                                </Button>
                            )}
                            <Button variant="outline" size="sm" onClick={() => window.print()}>
                                <Printer size={13} />
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Stats strip */}
            <div className="bg-muted/30 border-t-2 border-border px-6 py-2 flex items-center gap-4 text-xs text-muted-foreground print:hidden">
                <span className="flex items-center gap-1.5">
                    <Building2 size={11} /> Joined {formatDate(profile.createdAt)}
                </span>
                <span className="text-border">·</span>
                <span className="flex items-center gap-1.5">
                    <Users size={11} /> {profile.reports.length} direct report{profile.reports.length !== 1 ? "s" : ""}
                </span>
                <span className="text-border">·</span>
                <span className="flex items-center gap-1.5">
                    <MessageSquare size={11} /> {wallPostCount} wall post{wallPostCount !== 1 ? "s" : ""}
                </span>
                <span className="text-border">·</span>
                <span>Rank {profile.userRole.rank}</span>
            </div>
        </div>
    );
}

// ── WallTab ───────────────────────────────────────────────────────────────────

function WallTab({
    profile, sessionUserId, posts, loading, focusInput,
    onPost, onDelete,
}: {
    profile: UserProfile;
    sessionUserId: number | undefined;
    posts: WallPost[];
    loading: boolean;
    focusInput: boolean;
    onPost: (post: WallPost) => void;
    onDelete: (id: number) => void;
}) {
    const [body,    setBody]    = useState("");
    const [posting, setPosting] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (focusInput) textareaRef.current?.focus();
    }, [focusInput]);

    async function handlePost() {
        if (!body.trim()) return;
        setPosting(true);
        try {
            const res = await axios.post<WallPost>(`/api/users/${profile.id}/wall`, { body: body.trim() });
            onPost(res.data);
            setBody("");
        } catch (e) {
            const msg = axios.isAxiosError(e) ? e.response?.data?.error : "Failed to post";
            toast.error(msg);
        } finally {
            setPosting(false);
        }
    }

    async function handleDelete(postId: number) {
        try {
            await axios.delete(`/api/wall-posts/${postId}`);
            onDelete(postId);
        } catch {
            toast.error("Failed to delete post");
        }
    }

    const canDeletePost = (post: WallPost) =>
        sessionUserId !== undefined &&
        (sessionUserId === post.author.id || sessionUserId === profile.id);

    return (
        <div className="space-y-4">
            {/* Write box */}
            <div className="border-2 border-border bg-card p-4 space-y-3">
                <div className="flex items-start gap-3">
                    {sessionUserId && (
                        <div className="shrink-0 mt-1">
                            <UserCircle size={32} className="text-muted-foreground" />
                        </div>
                    )}
                    <Textarea
                        ref={textareaRef}
                        value={body}
                        onChange={e => setBody(e.target.value)}
                        placeholder={
                            sessionUserId === profile.id
                                ? "Write something on your wall…"
                                : `Write something on ${profile.name.split(" ")[0]}'s wall…`
                        }
                        rows={3}
                        className="flex-1 resize-none"
                        onKeyDown={e => {
                            if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); handlePost(); }
                        }}
                    />
                </div>
                <div className="flex items-center justify-between">
                    <p className="text-[11px] text-muted-foreground">Shift + Enter to post</p>
                    <Button size="sm" onClick={handlePost} disabled={posting || !body.trim()}>
                        <Send size={13} /> {posting ? "Posting…" : "Post"}
                    </Button>
                </div>
            </div>

            {/* Posts */}
            {loading ? (
                <p className="text-center text-sm text-muted-foreground py-8">Loading wall…</p>
            ) : posts.length === 0 ? (
                <div className="border-2 border-dashed border-border bg-card/50 py-12 text-center space-y-1">
                    <MessageSquare size={28} className="mx-auto text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">
                        No posts yet. Be the first to write on {profile.name.split(" ")[0]}&apos;s wall!
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {posts.map(post => (
                        <div key={post.id} className="border-2 border-border bg-card p-4">
                            <div className="flex items-start gap-3">
                                <Link href={`/users/${post.author.id}`} className="shrink-0">
                                    <Avatar avatarUrl={post.author.avatarUrl} name={post.author.name}
                                        role={post.author.role} sizePx={40} />
                                </Link>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <Link href={`/users/${post.author.id}`}
                                            className="text-sm font-semibold text-foreground hover:text-primary transition-colors">
                                            {post.author.name}
                                        </Link>
                                        <Badge className={`${post.author.userRole.color} text-[10px]`}>
                                            {post.author.userRole.label}
                                        </Badge>
                                        <span className="text-[11px] text-muted-foreground ml-auto">
                                            {timeAgo(post.createdAt)}
                                        </span>
                                        {canDeletePost(post) && (
                                            <button
                                                onClick={() => handleDelete(post.id)}
                                                className="text-muted-foreground/50 hover:text-destructive transition-colors"
                                                title="Delete post"
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        )}
                                    </div>
                                    <p className="text-sm text-foreground mt-1.5 whitespace-pre-wrap leading-relaxed">
                                        {post.body}
                                    </p>
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
        { key: "linkedIn",  label: "LinkedIn",  color: "bg-blue-600",  href: profile.linkedIn },
        { key: "twitter",   label: "Twitter/X", color: "bg-black",     href: profile.twitter },
        { key: "instagram", label: "Instagram", color: "bg-pink-600",  href: profile.instagram },
        { key: "facebook",  label: "Facebook",  color: "bg-blue-700",  href: profile.facebook },
    ].filter(s => s.href);

    return (
        <div className="space-y-4 max-w-xl">
            {/* Bio */}
            {profile.bio && (
                <div className="border-2 border-border bg-card px-5 py-4">
                    <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">About</h3>
                    <p className="text-sm text-foreground leading-relaxed">{profile.bio}</p>
                </div>
            )}

            {/* Contact */}
            <div className="border-2 border-border bg-card px-5 py-4 space-y-2.5">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Contact</h3>
                <div className="flex items-center gap-2 text-sm">
                    <Mail size={14} className="shrink-0 text-muted-foreground" />
                    <a href={`mailto:${profile.email}`} className="text-foreground hover:text-primary transition-colors">
                        {profile.email}
                    </a>
                </div>
                {profile.phone && (
                    <div className="flex items-center gap-2 text-sm">
                        <Phone size={14} className="shrink-0 text-muted-foreground" />
                        <a href={`tel:${profile.phone}`} className="text-foreground hover:text-primary transition-colors">
                            {profile.phone}
                        </a>
                    </div>
                )}
                {profile.birthday && (
                    <div className="flex items-center gap-2 text-sm">
                        <Cake size={14} className="shrink-0 text-muted-foreground" />
                        <span>{formatBirthday(profile.birthday)}</span>
                    </div>
                )}
            </div>

            {/* Organisation */}
            <div className="border-2 border-border bg-card px-5 py-4 space-y-2.5">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Organisation</h3>
                {profile.manager && (
                    <div className="flex items-center gap-2 text-sm">
                        <Users size={14} className="shrink-0 text-muted-foreground" />
                        <span className="text-muted-foreground">Reports to</span>
                        <Link href={`/users/${profile.manager.id}`}
                            className="text-foreground font-medium hover:text-primary transition-colors flex items-center gap-1">
                            {profile.manager.name} <ExternalLink size={10} />
                        </Link>
                    </div>
                )}
                {profile.departments.length > 0 && (
                    <div className="flex items-start gap-2 text-sm">
                        <Building2 size={14} className="shrink-0 text-muted-foreground mt-0.5" />
                        <div className="flex flex-wrap gap-1">
                            {profile.departments.map(d => (
                                <span key={d.id} className="text-[11px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5">
                                    {d.name}
                                </span>
                            ))}
                        </div>
                    </div>
                )}
                {profile.branches.length > 0 && (
                    <div className="flex items-start gap-2 text-sm">
                        <Building2 size={14} className="shrink-0 text-muted-foreground mt-0.5" />
                        <div className="flex flex-wrap gap-1">
                            {profile.branches.map(b => (
                                <span key={b.id} className="text-[11px] bg-orange-50 text-orange-700 border border-orange-200 px-1.5 py-0.5">
                                    {b.name}
                                </span>
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

            {/* Social links */}
            {socials.length > 0 && (
                <div className="border-2 border-border bg-card px-5 py-4">
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
    name:      z.string().min(1, "Name is required"),
    email:     z.string().email("Invalid email"),
    title:     z.string().optional(),
    bio:       z.string().max(500, "Max 500 characters").optional(),
    phone:     z.string().optional(),
    birthday:  z.string().optional(),
    linkedIn:  z.string().optional(),
    twitter:   z.string().optional(),
    instagram: z.string().optional(),
    facebook:  z.string().optional(),
});
type EditForm = z.infer<typeof editSchema>;

function EditProfileTab({ profile, onSaved }: { profile: UserProfile; onSaved: (p: UserProfile) => void }) {
    const [saving,        setSaving]        = useState(false);
    const [uploading,     setUploading]     = useState(false);
    const [avatarPreview, setAvatarPreview] = useState<string | null>(profile.avatarUrl);
    const [avatarUrl,     setAvatarUrl]     = useState<string | null>(profile.avatarUrl);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const { register, handleSubmit, watch, formState: { errors } } = useForm<EditForm>({
        resolver: zodResolver(editSchema),
        defaultValues: {
            name:      profile.name,
            email:     profile.email,
            title:     profile.title     ?? "",
            bio:       profile.bio       ?? "",
            phone:     profile.phone     ?? "",
            birthday:  profile.birthday  ? profile.birthday.slice(0, 10) : "",
            linkedIn:  profile.linkedIn  ?? "",
            twitter:   profile.twitter   ?? "",
            instagram: profile.instagram ?? "",
            facebook:  profile.facebook  ?? "",
        },
    });

    const bioValue = watch("bio") ?? "";

    async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith("image/")) { toast.error("Please select an image file"); return; }
        if (file.size > 5 * 1024 * 1024) { toast.error("Image must be under 5 MB"); return; }
        const localUrl = URL.createObjectURL(file);
        setAvatarPreview(localUrl);
        setUploading(true);
        try {
            const cloudUrl = await uploadToCloudinary(file);
            setAvatarUrl(cloudUrl);
            setAvatarPreview(cloudUrl);
            toast.success("Photo uploaded");
        } catch {
            toast.error("Photo upload failed — check Cloudinary settings");
            setAvatarPreview(profile.avatarUrl);
        } finally {
            setUploading(false);
        }
    }

    const onSubmit = async (data: EditForm) => {
        setSaving(true);
        try {
            const payload = {
                name:      data.name,
                email:     data.email,
                title:     data.title     || null,
                bio:       data.bio       || null,
                phone:     data.phone     || null,
                birthday:  data.birthday  || null,
                linkedIn:  data.linkedIn  || null,
                twitter:   data.twitter   || null,
                instagram: data.instagram || null,
                facebook:  data.facebook  || null,
                avatarUrl: avatarUrl,
            };
            const res = await axios.put<UserProfile>(`/api/users/${profile.id}`, payload);
            toast.success("Profile saved");
            onSaved(res.data);
        } catch (e) {
            const msg = axios.isAxiosError(e) ? e.response?.data?.error : "Failed to save";
            toast.error(msg);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 max-w-xl">
            {/* Photo */}
            <div className="border-2 border-border bg-card p-5 space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Profile Photo</h3>
                <div className="flex items-center gap-5">
                    <div className="relative shrink-0">
                        {avatarPreview ? (
                            <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-border">
                                <Image src={avatarPreview} alt="Preview" width={80} height={80}
                                    className="object-cover w-full h-full" />
                            </div>
                        ) : (
                            <div className={`flex w-20 h-20 items-center justify-center rounded-full border-2 border-border text-2xl font-bold ${avatarBg(profile.role)}`}>
                                {initials(profile.name)}
                            </div>
                        )}
                        {uploading && (
                            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
                                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                            </div>
                        )}
                    </div>
                    <div className="space-y-2">
                        <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                            onChange={handleFileChange} />
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
                    <Input
                        placeholder="https://example.com/photo.jpg"
                        value={avatarUrl ?? ""}
                        onChange={e => { setAvatarUrl(e.target.value || null); setAvatarPreview(e.target.value || null); }}
                    />
                </div>
            </div>

            {/* Identity */}
            <div className="border-2 border-border bg-card p-5 space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Identity</h3>
                <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2 space-y-1.5">
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
                    <div className="col-span-2 space-y-1.5">
                        <Label>Bio <span className="text-muted-foreground font-normal">(optional)</span></Label>
                        <Textarea {...register("bio")} placeholder="A short intro about yourself…" rows={3} />
                        <p className="text-[11px] text-muted-foreground text-right">{bioValue.length}/500</p>
                        {errors.bio && <p className="text-xs text-destructive">{errors.bio.message}</p>}
                    </div>
                </div>
            </div>

            {/* Contact */}
            <div className="border-2 border-border bg-card p-5 space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Contact</h3>
                <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <Label>Phone <span className="text-muted-foreground font-normal">(optional)</span></Label>
                        <Input {...register("phone")} placeholder="+880-xxx-xxx-xxxx" />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Birthday <span className="text-muted-foreground font-normal">(optional)</span></Label>
                        <Input {...register("birthday")} type="date" />
                    </div>
                </div>
            </div>

            {/* Social */}
            <div className="border-2 border-border bg-card p-5 space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Social Media</h3>
                <div className="space-y-3">
                    {([
                        { name: "linkedIn"  as const, label: "LinkedIn",  placeholder: "linkedin.com/in/yourname" },
                        { name: "twitter"   as const, label: "Twitter/X", placeholder: "twitter.com/yourhandle" },
                        { name: "instagram" as const, label: "Instagram", placeholder: "instagram.com/yourhandle" },
                        { name: "facebook"  as const, label: "Facebook",  placeholder: "facebook.com/yourprofile" },
                    ]).map(({ name, label, placeholder }) => (
                        <div key={name} className="flex items-center gap-2">
                            <span className="w-20 shrink-0 text-xs text-muted-foreground font-medium">{label}</span>
                            <Input {...register(name)} placeholder={placeholder} className="flex-1" />
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex justify-end">
                <Button type="submit" disabled={saving || uploading}>
                    {saving ? "Saving…" : "Save Profile"}
                </Button>
            </div>
        </form>
    );
}

// ── SecurityTab ───────────────────────────────────────────────────────────────

const securitySchema = z.object({
    password:        z.string().min(6, "Min 6 characters"),
    confirmPassword: z.string(),
}).refine(d => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
});
type SecurityForm = z.infer<typeof securitySchema>;

function SecurityTab({ profileId }: { profileId: number }) {
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
            const msg = axios.isAxiosError(e) ? e.response?.data?.error : "Failed to change password";
            toast.error(msg);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="max-w-sm">
            <form onSubmit={handleSubmit(onSubmit)} className="border-2 border-border bg-card p-5 space-y-4">
                <div className="flex items-center gap-2 mb-1">
                    <Lock size={14} className="text-muted-foreground" />
                    <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        Change Password
                    </h3>
                </div>
                <p className="text-xs text-muted-foreground">
                    Choose a strong password of at least 6 characters.
                </p>
                <div className="space-y-1.5">
                    <Label>New Password</Label>
                    <Input {...register("password")} type="password" placeholder="Min 6 characters" />
                    {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
                </div>
                <div className="space-y-1.5">
                    <Label>Confirm Password</Label>
                    <Input {...register("confirmPassword")} type="password" placeholder="Repeat new password" />
                    {errors.confirmPassword && (
                        <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
                    )}
                </div>
                <div className="flex justify-end pt-1">
                    <Button type="submit" disabled={saving}>
                        {saving ? "Changing…" : "Change Password"}
                    </Button>
                </div>
            </form>
        </div>
    );
}

// ── PermissionsTab ────────────────────────────────────────────────────────────

function PermissionsTab({ profile }: { profile: UserProfile }) {
    const permissions    = profile.userRole.permissions.map(p => p.permission);
    const byModule       = permissions.reduce<Record<string, Permission[]>>((acc, p) => {
        (acc[p.module] ??= []).push(p); return acc;
    }, {});
    const orderedModules = [
        ...MODULE_ORDER.filter(m => byModule[m]),
        ...Object.keys(byModule).filter(m => !MODULE_ORDER.includes(m)),
    ];
    const hasBypass = permissions.some(p => p.id === "admin:bypass");

    return (
        <div className="space-y-3 max-w-xl">
            <div className="flex items-center gap-2">
                <Shield size={13} className="text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                    Role: <span className="font-semibold text-foreground">{profile.userRole.label}</span>
                    {" · "}{permissions.length} permission{permissions.length !== 1 ? "s" : ""}
                </p>
                {hasBypass && (
                    <span className="text-[10px] bg-destructive/10 text-destructive border border-destructive/20 px-1.5 py-0.5">
                        admin bypass active
                    </span>
                )}
            </div>
            {orderedModules.length === 0
                ? <p className="text-sm text-muted-foreground italic">No permissions granted.</p>
                : orderedModules.map(module => (
                    <div key={module} className="border-2 border-border overflow-hidden">
                        <div className="flex items-center gap-2 bg-muted/40 border-b-2 border-border px-3 py-2">
                            <ShieldCheck size={11} className="text-muted-foreground" />
                            <span className="text-xs font-bold uppercase tracking-wide">{module}</span>
                            <span className="ml-auto text-[11px] text-muted-foreground">{byModule[module].length}</span>
                        </div>
                        <div className="divide-y divide-border">
                            {byModule[module].map(p => (
                                <div key={p.id} className="flex items-start gap-3 px-3 py-2.5">
                                    <div className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${p.id === "admin:bypass" ? "bg-destructive" : "bg-primary"}`} />
                                    <div>
                                        <p className="text-sm font-medium text-foreground">{p.label}</p>
                                        {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                                        <p className="font-mono text-[10px] text-muted-foreground/50 select-all">{p.id}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
        </div>
    );
}

// ── OrgPositionTab ────────────────────────────────────────────────────────────

function OrgPositionTab({ profile }: { profile: UserProfile }) {
    const [roots, setRoots] = useState<OrgNode[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        axios.get<OrgNode[]>("/api/org-chart")
            .then(r => setRoots(r.data))
            .catch(() => toast.error("Failed to load org chart"))
            .finally(() => setLoading(false));
    }, []);

    if (loading) return (
        <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
            Loading org chart…
        </div>
    );
    return <OrgTree roots={roots} highlightId={profile.id} />;
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar({ profile }: { profile: UserProfile }) {
    return (
        <aside className="w-60 shrink-0 space-y-4">
            {/* Mini info */}
            <div className="border-2 border-border bg-card overflow-hidden">
                <div className="bg-muted/40 border-b-2 border-border px-3 py-2">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                        <Info size={11} /> Info
                    </span>
                </div>
                <div className="px-3 py-3 space-y-2.5 text-xs">
                    {profile.manager && (
                        <div>
                            <p className="text-muted-foreground mb-0.5">Reports to</p>
                            <Link href={`/users/${profile.manager.id}`}
                                className="font-medium text-foreground hover:text-primary flex items-center gap-1 transition-colors">
                                <Avatar avatarUrl={profile.manager.avatarUrl} name={profile.manager.name}
                                    role={profile.manager.role} sizePx={18} className="shrink-0" />
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

            {/* Direct reports */}
            {profile.reports.length > 0 && (
                <div className="border-2 border-border bg-card overflow-hidden">
                    <div className="bg-muted/40 border-b-2 border-border px-3 py-2">
                        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                            <Users size={11} /> Team ({profile.reports.length})
                        </span>
                    </div>
                    <div className="p-3 grid grid-cols-3 gap-2">
                        {profile.reports.slice(0, 9).map(r => (
                            <Link key={r.id} href={`/users/${r.id}`}
                                className="flex flex-col items-center gap-1 text-center group">
                                <Avatar avatarUrl={r.avatarUrl} name={r.name} role={r.role} sizePx={40}
                                    className="group-hover:ring-2 group-hover:ring-primary transition-all" />
                                <span className="text-[10px] text-muted-foreground group-hover:text-primary transition-colors leading-tight truncate w-full text-center">
                                    {r.name.split(" ")[0]}
                                </span>
                            </Link>
                        ))}
                    </div>
                    {profile.reports.length > 9 && (
                        <div className="border-t border-border px-3 py-2 text-center">
                            <span className="text-[11px] text-muted-foreground">
                                +{profile.reports.length - 9} more
                            </span>
                        </div>
                    )}
                </div>
            )}
        </aside>
    );
}

// ── Tab definitions ───────────────────────────────────────────────────────────

const TABS = [
    { id: 1 as const, label: "Wall",         icon: MessageSquare, access: "all"         },
    { id: 2 as const, label: "About",        icon: Info,          access: "all"         },
    { id: 3 as const, label: "Edit Profile", icon: Pencil,        access: "self"        },
    { id: 4 as const, label: "Security",     icon: Lock,          access: "self"        },
    { id: 5 as const, label: "Permissions",  icon: Shield,        access: "selfOrAdmin" },
    { id: 6 as const, label: "Org Position", icon: GitBranch,     access: "all"         },
];
type TabId = 1 | 2 | 3 | 4 | 5 | 6;

// ── Page ─────────────────────────────────────────────────────────────────────

export default function UserProfilePage() {
    const { id }             = useParams<{ id: string }>();
    const { data: session }  = useSession();
    const [profile,      setProfile]      = useState<UserProfile | null>(null);
    const [wallPosts,    setWallPosts]    = useState<WallPost[]>([]);
    const [loading,      setLoading]      = useState(true);
    const [wallLoading,  setWallLoading]  = useState(true);
    const [activeTab,    setActiveTab]    = useState<TabId>(1);
    const [sidebarOpen,  setSidebarOpen]  = useState(true);
    const [focusWall,    setFocusWall]    = useState(false);

    const sessionUserId = session?.user
        ? Number((session.user as { id?: string }).id)
        : undefined;
    const isSelf  = sessionUserId !== undefined && sessionUserId === Number(id);
    const isAdmin = Boolean(
        (session?.user as { permissions?: string[] })?.permissions?.includes("users:manage") ||
        (session?.user as { permissions?: string[] })?.permissions?.includes("admin:bypass")
    );

    useEffect(() => {
        setLoading(true);
        setWallLoading(true);
        setActiveTab(1);
        axios.get<UserProfile>(`/api/users/${id}`)
            .then(r => setProfile(r.data))
            .catch(() => toast.error("Failed to load profile"))
            .finally(() => setLoading(false));
        axios.get<WallPost[]>(`/api/users/${id}/wall`)
            .then(r => setWallPosts(r.data))
            .catch(() => toast.error("Failed to load wall"))
            .finally(() => setWallLoading(false));
    }, [id]);

    function handleWriteOnWall() {
        setActiveTab(1);
        setFocusWall(true);
        setTimeout(() => setFocusWall(false), 300);
    }

    const visibleTabs = TABS.filter(t => {
        if (t.access === "all")         return true;
        if (t.access === "self")        return isSelf;
        if (t.access === "selfOrAdmin") return isSelf || isAdmin;
        return false;
    });

    if (loading) return (
        <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
            Loading profile…
        </div>
    );
    if (!profile) return (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
            <p className="text-sm text-muted-foreground">User not found.</p>
            <Button asChild variant="outline" size="sm">
                <Link href="/users"><ArrowLeft size={14} /> Back to Users</Link>
            </Button>
        </div>
    );

    return (
        <div>
            {/* Back nav */}
            <div className="flex items-center gap-2 mb-4 print:hidden">
                <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
                    <Link href="/users"><ArrowLeft size={14} /> All Users</Link>
                </Button>
            </div>

            {/* Profile header */}
            <ProfileHeader
                profile={profile}
                isSelf={isSelf}
                wallPostCount={wallPosts.length}
                onWriteOnWall={handleWriteOnWall}
                onEditProfile={() => setActiveTab(3)}
            />

            {/* Tab bar + sidebar toggle */}
            <div className="flex items-stretch border-b-2 border-border mb-5 print:hidden">
                <div className="flex flex-1">
                    {visibleTabs.map(tab => {
                        const Icon   = tab.icon;
                        const active = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={[
                                    "flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 -mb-0.5 transition-colors whitespace-nowrap",
                                    active
                                        ? "border-primary text-primary"
                                        : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
                                ].join(" ")}
                            >
                                <Icon size={13} /> {tab.label}
                            </button>
                        );
                    })}
                </div>
                {/* Sidebar toggle */}
                <button
                    onClick={() => setSidebarOpen(prev => !prev)}
                    className="flex items-center gap-1.5 px-4 py-3 text-xs text-muted-foreground hover:text-foreground transition-colors border-l-2 border-border shrink-0"
                    title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
                >
                    {sidebarOpen
                        ? <><PanelRightClose size={15} /> <span className="hidden sm:inline">Hide</span></>
                        : <><PanelRightOpen  size={15} /> <span className="hidden sm:inline">Info</span></>
                    }
                </button>
            </div>

            {/* Main layout */}
            <div className="flex gap-5 items-start">
                {/* Tab content */}
                <div className="flex-1 min-w-0">
                    {activeTab === 1 && (
                        <WallTab
                            profile={profile}
                            sessionUserId={sessionUserId}
                            posts={wallPosts}
                            loading={wallLoading}
                            focusInput={focusWall}
                            onPost={post => setWallPosts(prev => [post, ...prev])}
                            onDelete={id => setWallPosts(prev => prev.filter(p => p.id !== id))}
                        />
                    )}
                    {activeTab === 2 && <AboutTab profile={profile} />}
                    {activeTab === 3 && isSelf && (
                        <EditProfileTab
                            profile={profile}
                            onSaved={updated => setProfile(prev => prev ? { ...prev, ...updated } : prev)}
                        />
                    )}
                    {activeTab === 4 && isSelf && <SecurityTab profileId={profile.id} />}
                    {activeTab === 5 && (isSelf || isAdmin) && <PermissionsTab profile={profile} />}
                    {activeTab === 6 && <OrgPositionTab profile={profile} />}
                </div>

                {/* Collapsible sidebar */}
                {sidebarOpen && <Sidebar profile={profile} />}
            </div>
        </div>
    );
}
