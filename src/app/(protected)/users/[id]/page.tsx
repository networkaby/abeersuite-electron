"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import {
    ArrowLeft, Printer,
    Shield, Mail, Briefcase, Building2, Users,
    ShieldCheck, CreditCard, Pencil, GitBranch,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/format-date";
import type { OrgNode } from "@/app/api/org-chart/route";
import OrgTree from "@/modules/admin/components/OrgTree";

// ── Types ────────────────────────────────────────────────────────────────────

interface Permission {
    id: string; label: string; module: string; description: string | null;
}
interface StaffCard {
    id: number; name: string; title: string | null; role: string;
    userRole: { label: string; color: string };
}
interface UserProfile {
    id: number; name: string; email: string; title: string | null;
    role: string; scope: string; createdAt: string; managerId: number | null;
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
    { id: 1, label: "ID Card",         icon: CreditCard },
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

// ── Tab 1 — ID Card ──────────────────────────────────────────────────────────

function IdCardTab({ profile }: { profile: UserProfile }) {
    const permissions = profile.userRole.permissions.map(p => p.permission);
    const byModule = permissions.reduce<Record<string, Permission[]>>((acc, p) => {
        (acc[p.module] ??= []).push(p); return acc;
    }, {});
    const orderedModules = [
        ...MODULE_ORDER.filter(m => byModule[m]),
        ...Object.keys(byModule).filter(m => !MODULE_ORDER.includes(m)),
    ];
    const hasBypass = permissions.some(p => p.id === "admin:bypass");

    return (
        <div className="space-y-6">
            <div className="flex justify-end print:hidden">
                <Button variant="outline" size="sm" onClick={() => window.print()}>
                    <Printer size={14} /> Print ID Card
                </Button>
            </div>

            {/* ID Card */}
            <div id="print-id-card" className="border-2 border-border bg-card overflow-hidden max-w-sm mx-auto print:border print:shadow-none">
                <div className="bg-primary px-5 py-3 flex items-center justify-between">
                    <span className="text-xs font-bold text-primary-foreground uppercase tracking-widest">
                        Employee ID
                    </span>
                    <span className="font-mono text-xs text-primary-foreground/70">
                        #{String(profile.id).padStart(4, "0")}
                    </span>
                </div>

                <div className="px-5 py-4 flex gap-4 items-start">
                    <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-xl font-bold ${avatarBg(profile.role)}`}>
                        {initials(profile.name)}
                    </div>
                    <div className="min-w-0 space-y-1">
                        <p className="font-bold text-lg text-foreground leading-tight">{profile.name}</p>
                        {profile.title && (
                            <p className="text-xs text-muted-foreground">{profile.title}</p>
                        )}
                        <Badge className={`${profile.userRole.color} text-xs`}>{profile.userRole.label}</Badge>
                    </div>
                </div>

                <div className="border-t-2 border-border px-5 py-3 space-y-1.5 bg-muted/30">
                    {profile.departments.length > 0 && (
                        <div className="flex items-start gap-2 text-xs">
                            <Users size={11} className="mt-0.5 shrink-0 text-muted-foreground" />
                            <span className="text-muted-foreground">Dept</span>
                            <span className="font-medium text-foreground">{profile.departments.map(d => d.name).join(", ")}</span>
                        </div>
                    )}
                    {profile.branches.length > 0 && (
                        <div className="flex items-start gap-2 text-xs">
                            <Building2 size={11} className="mt-0.5 shrink-0 text-muted-foreground" />
                            <span className="text-muted-foreground">Branch</span>
                            <span className="font-medium text-foreground">{profile.branches.map(b => b.name).join(", ")}</span>
                        </div>
                    )}
                    <div className="flex items-center gap-2 text-xs">
                        <Mail size={11} className="shrink-0 text-muted-foreground" />
                        <span className="text-muted-foreground truncate">{profile.email}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                        <Briefcase size={11} className="shrink-0 text-muted-foreground" />
                        <span className="text-muted-foreground">Since</span>
                        <span className="font-medium text-foreground">{formatDate(profile.createdAt)}</span>
                    </div>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
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
                    ))
                }
            </div>
        </div>
    );
}

// ── Tab 2 — Edit & Security (personal details + password only) ───────────────

const editSchema = z.object({
    name:            z.string().min(1, "Name is required"),
    email:           z.string().email("Invalid email"),
    title:           z.string().optional(),
    password:        z.string().optional(),
    confirmPassword: z.string().optional(),
});
type EditForm = z.infer<typeof editSchema>;

function EditTab({ profile, onSaved }: { profile: UserProfile; onSaved: (p: UserProfile) => void }) {
    const [saving, setSaving] = useState(false);

    const { register, handleSubmit, formState: { errors } } = useForm<EditForm>({
        resolver: zodResolver(editSchema),
        defaultValues: {
            name:            profile.name,
            email:           profile.email,
            title:           profile.title ?? "",
            password:        "",
            confirmPassword: "",
        },
    });

    const onSubmit = async (data: EditForm) => {
        if (data.password && data.password !== data.confirmPassword) {
            toast.error("Passwords do not match");
            return;
        }
        setSaving(true);
        try {
            const payload: Record<string, unknown> = {
                name:  data.name,
                email: data.email,
                title: data.title || null,
            };
            if (data.password) payload.password = data.password;
            const res = await axios.put<UserProfile>(`/api/users/${profile.id}`, payload);
            toast.success("Profile updated");
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
                </div>
            </div>

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

            <div className="border-2 border-dashed border-border bg-muted/20 p-5 text-center space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Photo Upload</p>
                <p className="text-xs text-muted-foreground">Coming soon — profile photo support</p>
            </div>

            <div className="flex justify-end">
                <Button type="submit" disabled={saving}>
                    {saving ? "Saving…" : "Save Changes"}
                </Button>
            </div>
        </form>
    );
}

// ── Tab 3 — Org Position (full chart, self highlighted) ──────────────────────

function OrgPositionTab({ profile }: { profile: UserProfile }) {
    const [roots, setRoots] = useState<OrgNode[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        axios.get<OrgNode[]>("/api/org-chart")
            .then(r => setRoots(r.data))
            .catch(() => toast.error("Failed to load org chart"))
            .finally(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
                Loading org chart…
            </div>
        );
    }

    return <OrgTree roots={roots} highlightId={profile.id} />;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function UserProfilePage() {
    const { id } = useParams<{ id: string }>();
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading]   = useState(true);
    const [activeTab, setActiveTab] = useState<1 | 2 | 3>(1);
    const printRef = useRef<HTMLDivElement>(null);

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

    return (
        <div ref={printRef}>
            {/* Header */}
            <div className="flex items-center gap-3 mb-5 print:hidden">
                <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
                    <Link href="/users"><ArrowLeft size={14} /> All Users</Link>
                </Button>
                <div className="flex items-center gap-2.5">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${avatarBg(profile.role)}`}>
                        {initials(profile.name)}
                    </div>
                    <div>
                        <h1 className="text-lg font-bold text-foreground leading-tight">{profile.name}</h1>
                        {profile.title && <p className="text-xs text-muted-foreground leading-tight">{profile.title}</p>}
                    </div>
                    <Badge className={profile.userRole.color}>{profile.userRole.label}</Badge>
                </div>
            </div>

            {/* Tab bar */}
            <div className="flex border-b-2 border-border mb-6 print:hidden">
                {TABS.map(tab => {
                    const Icon = tab.icon;
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
                            <Icon size={14} />
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* Tab content */}
            {activeTab === 1 && <IdCardTab profile={profile} />}
            {activeTab === 2 && (
                <EditTab
                    profile={profile}
                    onSaved={updated => setProfile(prev => prev ? { ...prev, ...updated } : prev)}
                />
            )}
            {activeTab === 3 && <OrgPositionTab profile={profile} />}
        </div>
    );
}
