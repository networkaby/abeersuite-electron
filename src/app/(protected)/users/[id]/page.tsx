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
    ArrowLeft, Printer, Shield, Mail, Phone, Cake,
    Building2, Users, ShieldCheck, CreditCard, Pencil,
    GitBranch, Upload, Link2, ExternalLink,
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
const TABS = [
    { id: 1, label: "Profile",         icon: CreditCard },
    { id: 2, label: "Edit & Security", icon: Pencil },
    { id: 3, label: "Org Position",    icon: GitBranch },
] as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string) {
    return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}
function avatarBg(role: string) {
    return AVATAR_COLOR[role] ?? "bg-gray-100 text-gray-600";
}
function formatBirthday(iso: string) {
    return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
}
function ensureUrl(url: string) {
    return url.startsWith("http") ? url : `https://${url}`;
}

// ── Avatar component ─────────────────────────────────────────────────────────

function Avatar({
    avatarUrl, name, role, sizePx = 64, className = "",
}: { avatarUrl: string | null; name: string; role: string; sizePx?: number; className?: string }) {
    const [err, setErr] = useState(false);
    if (avatarUrl && !err) {
        return (
            <div className={`rounded-full overflow-hidden shrink-0 ${className}`} style={{ width: sizePx, height: sizePx }}>
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

// ── Cloudinary upload helper ──────────────────────────────────────────────────

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
        `https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`,
        form,
    );
    return res.data.secure_url;
}

// ── Tab 1 — Public Profile ───────────────────────────────────────────────────

function ProfileTab({ profile }: { profile: UserProfile }) {
    const permissions   = profile.userRole.permissions.map(p => p.permission);
    const byModule      = permissions.reduce<Record<string, Permission[]>>((acc, p) => {
        (acc[p.module] ??= []).push(p); return acc;
    }, {});
    const orderedModules = [
        ...MODULE_ORDER.filter(m => byModule[m]),
        ...Object.keys(byModule).filter(m => !MODULE_ORDER.includes(m)),
    ];
    const hasBypass = permissions.some(p => p.id === "admin:bypass");

    const socials = [
        { key: "linkedIn",  label: "LinkedIn",  color: "bg-blue-600",  href: profile.linkedIn },
        { key: "twitter",   label: "Twitter/X", color: "bg-black",     href: profile.twitter },
        { key: "instagram", label: "Instagram", color: "bg-pink-600",  href: profile.instagram },
        { key: "facebook",  label: "Facebook",  color: "bg-blue-700",  href: profile.facebook },
    ].filter(s => s.href);

    return (
        <div className="space-y-6 max-w-2xl">
            {/* Print button */}
            <div className="flex justify-end print:hidden">
                <Button variant="outline" size="sm" onClick={() => window.print()}>
                    <Printer size={14} /> Print ID Card
                </Button>
            </div>

            {/* Profile card */}
            <div className="border-2 border-border bg-card overflow-hidden">
                {/* Header strip */}
                <div className="bg-primary/10 border-b-2 border-border px-6 py-5 flex items-center gap-5">
                    <Avatar avatarUrl={profile.avatarUrl} name={profile.name} role={profile.role} sizePx={72} />
                    <div className="flex-1 min-w-0">
                        <h2 className="text-xl font-bold text-foreground leading-tight">{profile.name}</h2>
                        {profile.title && <p className="text-sm text-muted-foreground mt-0.5">{profile.title}</p>}
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                            <Badge className={`${profile.userRole.color} text-xs`}>{profile.userRole.label}</Badge>
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
                    <span className="font-mono text-xs text-muted-foreground self-start">
                        #{String(profile.id).padStart(4, "0")}
                    </span>
                </div>

                {/* Bio */}
                {profile.bio && (
                    <div className="px-6 py-4 border-b-2 border-border">
                        <p className="text-sm text-foreground leading-relaxed">{profile.bio}</p>
                    </div>
                )}

                {/* Contact + social */}
                <div className="px-6 py-4 space-y-2.5">
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
                            <span className="text-foreground">{formatBirthday(profile.birthday)}</span>
                        </div>
                    )}
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
                    <div className="flex items-center gap-2 text-sm">
                        <Building2 size={14} className="shrink-0 text-muted-foreground" />
                        <span className="text-muted-foreground">Since</span>
                        <span className="text-foreground font-medium">{formatDate(profile.createdAt)}</span>
                    </div>
                </div>

                {/* Social links */}
                {socials.length > 0 && (
                    <div className="border-t-2 border-border px-6 py-3 flex flex-wrap gap-2">
                        {socials.map(({ key, label, color, href }) => (
                            <a key={key} href={ensureUrl(href!)} target="_blank" rel="noopener noreferrer"
                                className={`flex items-center gap-1.5 text-xs text-white px-3 py-1.5 ${color} hover:opacity-90 transition-opacity`}>
                                <ExternalLink size={11} />
                                {label}
                            </a>
                        ))}
                    </div>
                )}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                    { label: "Rank",        value: profile.userRole.rank },
                    { label: "Scope",       value: SCOPE_LABELS[profile.scope] ?? profile.scope },
                    { label: "Reports",     value: profile.reports.length > 0 ? `${profile.reports.length} direct` : "None" },
                    { label: "Permissions", value: permissions.length },
                ].map(({ label, value }) => (
                    <div key={label} className="border-2 border-border bg-card px-4 py-3">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
                        <p className="font-semibold text-foreground mt-0.5">{value}</p>
                    </div>
                ))}
            </div>

            {/* Direct reports */}
            {profile.reports.length > 0 && (
                <div className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        Direct Reports ({profile.reports.length})
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {profile.reports.map(r => (
                            <Link key={r.id} href={`/users/${r.id}`}
                                className="flex items-center gap-3 border-2 border-border bg-card px-4 py-2.5 hover:border-primary transition-colors group">
                                <Avatar avatarUrl={r.avatarUrl} name={r.name} role={r.role} sizePx={32} />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-foreground group-hover:text-primary truncate">{r.name}</p>
                                    {r.title && <p className="text-xs text-muted-foreground truncate">{r.title}</p>}
                                </div>
                                <Badge className={`${r.userRole.color} text-[10px] shrink-0`}>{r.userRole.label}</Badge>
                            </Link>
                        ))}
                    </div>
                </div>
            )}

            {/* Permissions */}
            <div className="space-y-2">
                <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    <Shield size={12} /> Role Permissions
                    {hasBypass && (
                        <span className="text-[10px] bg-destructive/10 text-destructive border border-destructive/20 px-1.5 py-0.5 normal-case tracking-normal">
                            bypass active
                        </span>
                    )}
                </h3>
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
        </div>
    );
}

// ── Tab 2 — Edit & Security ───────────────────────────────────────────────────

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
    password:        z.string().optional(),
    confirmPassword: z.string().optional(),
});
type EditForm = z.infer<typeof editSchema>;

function EditTab({ profile, onSaved }: { profile: UserProfile; onSaved: (p: UserProfile) => void }) {
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
            password:        "",
            confirmPassword: "",
        },
    });

    const bioValue = watch("bio") ?? "";

    async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith("image/")) { toast.error("Please select an image file"); return; }
        if (file.size > 5 * 1024 * 1024) { toast.error("Image must be under 5 MB"); return; }

        // Local preview immediately
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
        if (data.password && data.password !== data.confirmPassword) {
            toast.error("Passwords do not match"); return;
        }
        setSaving(true);
        try {
            const payload: Record<string, unknown> = {
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
            if (data.password) payload.password = data.password;
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
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-w-xl">

            {/* Photo upload */}
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
                        {!process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME && (
                            <p className="text-[11px] text-amber-600">⚠ Cloudinary not configured — set env vars to enable upload</p>
                        )}
                    </div>
                </div>
                {/* Direct URL fallback */}
                <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5">
                        <Link2 size={12} /> Or paste a photo URL
                    </Label>
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

            {/* Social media */}
            <div className="border-2 border-border bg-card p-5 space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Social Media</h3>
                <div className="space-y-3">
                    {[
                        { name: "linkedIn"  as const, label: "LinkedIn",   placeholder: "linkedin.com/in/yourname" },
                        { name: "twitter"   as const, label: "Twitter/X",  placeholder: "twitter.com/yourhandle" },
                        { name: "instagram" as const, label: "Instagram",  placeholder: "instagram.com/yourhandle" },
                        { name: "facebook"  as const, label: "Facebook",   placeholder: "facebook.com/yourprofile" },
                    ].map(({ name, label, placeholder }) => (
                        <div key={name} className="flex items-center gap-2">
                            <span className="w-20 shrink-0 text-xs text-muted-foreground font-medium">{label}</span>
                            <Input {...register(name)} placeholder={placeholder} className="flex-1" />
                        </div>
                    ))}
                </div>
            </div>

            {/* Password */}
            <div className="border-2 border-border bg-card p-5 space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Change Password</h3>
                <p className="text-xs text-muted-foreground">Leave blank to keep current password.</p>
                <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <Label>New Password</Label>
                        <Input {...register("password")} type="password" placeholder="Min 6 characters" />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Confirm Password</Label>
                        <Input {...register("confirmPassword")} type="password" placeholder="Repeat password" />
                    </div>
                </div>
            </div>

            <div className="flex justify-end">
                <Button type="submit" disabled={saving || uploading}>
                    {saving ? "Saving…" : "Save Changes"}
                </Button>
            </div>
        </form>
    );
}

// ── Tab 3 — Org Position ─────────────────────────────────────────────────────

function OrgPositionTab({ profile }: { profile: UserProfile }) {
    const [roots,   setRoots]   = useState<OrgNode[]>([]);
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

// ── Page ─────────────────────────────────────────────────────────────────────

export default function UserProfilePage() {
    const { id }           = useParams<{ id: string }>();
    const { data: session } = useSession();
    const [profile,    setProfile]    = useState<UserProfile | null>(null);
    const [loading,    setLoading]    = useState(true);
    const [activeTab,  setActiveTab]  = useState<1 | 2 | 3>(1);
    const printRef = useRef<HTMLDivElement>(null);

    const sessionUserId = session?.user
        ? Number((session.user as { id?: string }).id)
        : undefined;
    const isSelf = sessionUserId !== undefined && sessionUserId === Number(id);

    useEffect(() => {
        axios.get<UserProfile>(`/api/users/${id}`)
            .then(r => setProfile(r.data))
            .catch(() => toast.error("Failed to load profile"))
            .finally(() => setLoading(false));
    }, [id]);

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

    // Non-self users only see Profile + Org tabs
    const visibleTabs = TABS.filter(t => t.id !== 2 || isSelf);

    return (
        <div ref={printRef}>
            {/* Header */}
            <div className="flex items-center gap-3 mb-5 print:hidden">
                <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
                    <Link href="/users"><ArrowLeft size={14} /> All Users</Link>
                </Button>
                <div className="flex items-center gap-2.5">
                    <Avatar avatarUrl={profile.avatarUrl} name={profile.name} role={profile.role} sizePx={36} />
                    <div>
                        <h1 className="text-lg font-bold text-foreground leading-tight">{profile.name}</h1>
                        {profile.title && <p className="text-xs text-muted-foreground leading-tight">{profile.title}</p>}
                    </div>
                    <Badge className={profile.userRole.color}>{profile.userRole.label}</Badge>
                    {isSelf && (
                        <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5">
                            You
                        </span>
                    )}
                </div>
            </div>

            {/* Tab bar */}
            <div className="flex border-b-2 border-border mb-6 print:hidden">
                {visibleTabs.map(tab => {
                    const Icon   = tab.icon;
                    const active = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as 1 | 2 | 3)}
                            className={[
                                "flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 -mb-0.5 transition-colors",
                                active
                                    ? "border-primary text-primary"
                                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
                            ].join(" ")}
                        >
                            <Icon size={14} /> {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* Tab content */}
            {activeTab === 1 && <ProfileTab profile={profile} />}
            {activeTab === 2 && isSelf && (
                <EditTab
                    profile={profile}
                    onSaved={updated => setProfile(prev => prev ? { ...prev, ...updated } : prev)}
                />
            )}
            {activeTab === 3 && <OrgPositionTab profile={profile} />}
        </div>
    );
}
