"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import {
    ArrowLeft, Building2, Users, Shield,
    ShieldCheck, ChevronRight, Mail, Briefcase,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format-date";

// ── Types ────────────────────────────────────────────────────────────────────

interface Permission {
    id: string;
    label: string;
    module: string;
    description: string | null;
}

interface StaffCard {
    id: number;
    name: string;
    title: string | null;
    role: string;
    userRole: { label: string; color: string };
}

interface UserProfile {
    id: number;
    name: string;
    email: string;
    title: string | null;
    role: string;
    scope: string;
    createdAt: string;
    managerId: number | null;
    userRole: { id: string; label: string; color: string; rank: number; permissions: { permission: Permission }[] };
    manager:  StaffCard | null;
    reports:  StaffCard[];
    departments: { id: string; name: string }[];
    branches:    { id: string; name: string }[];
}

const SCOPE_LABELS: Record<string, string> = {
    OWN: "Own records only", TEAM: "Direct reports", DEPARTMENT: "Full department",
    BRANCH: "Full branch", REGION: "Region-wide", ORG: "Entire organisation",
};

const MODULE_ORDER = ["core", "customers", "tickets", "assignments", "service", "admin"];

// ── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string) {
    return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

function avatarBg(role: string) {
    const map: Record<string, string> = {
        R1: "bg-purple-100 text-purple-700",
        R2: "bg-blue-100 text-blue-700",
        R3: "bg-green-100 text-green-700",
        R4: "bg-orange-100 text-orange-700",
        R5: "bg-pink-100 text-pink-700",
    };
    return map[role] ?? "bg-gray-100 text-gray-600";
}

function MiniCard({ user }: { user: StaffCard }) {
    return (
        <Link
            href={`/users/${user.id}`}
            className="flex items-center gap-3 border-2 border-border bg-card px-3 py-2.5 hover:border-primary transition-colors group"
        >
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarBg(user.role)}`}>
                {initials(user.name)}
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">{user.name}</p>
                {user.title && <p className="text-xs text-muted-foreground truncate">{user.title}</p>}
            </div>
            <Badge className={`${user.userRole.color} text-[10px] shrink-0`}>{user.userRole.label}</Badge>
            <ChevronRight size={13} className="text-muted-foreground shrink-0" />
        </Link>
    );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function UserProfilePage() {
    const { id } = useParams<{ id: string }>();
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        axios.get<UserProfile>(`/api/users/${id}`)
            .then(r => setProfile(r.data))
            .catch(() => toast.error("Failed to load profile"))
            .finally(() => setLoading(false));
    }, [id]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
                Loading profile…
            </div>
        );
    }

    if (!profile) {
        return (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
                <p className="text-sm text-muted-foreground">User not found.</p>
                <Button asChild variant="outline" size="sm">
                    <Link href="/users"><ArrowLeft size={14} /> Back to Users</Link>
                </Button>
            </div>
        );
    }

    const permissions = profile.userRole.permissions.map(p => p.permission);
    const byModule = permissions.reduce<Record<string, Permission[]>>((acc, p) => {
        (acc[p.module] ??= []).push(p);
        return acc;
    }, {});
    const orderedModules = [
        ...MODULE_ORDER.filter(m => byModule[m]),
        ...Object.keys(byModule).filter(m => !MODULE_ORDER.includes(m)),
    ];
    const hasBypass = permissions.some(p => p.id === "admin:bypass");

    return (
        <div className="max-w-4xl space-y-6">

            {/* Back */}
            <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
                <Link href="/users"><ArrowLeft size={14} /> All Users</Link>
            </Button>

            {/* Hero card */}
            <div className="border-2 border-border bg-card p-6 flex flex-col sm:flex-row gap-5 items-start">
                {/* Avatar */}
                <div className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-full text-2xl font-bold ${avatarBg(profile.role)}`}>
                    {initials(profile.name)}
                </div>

                {/* Identity */}
                <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <h1 className="text-2xl font-bold text-foreground">{profile.name}</h1>
                        <Badge className={profile.userRole.color}>{profile.userRole.label}</Badge>
                        {hasBypass && (
                            <Badge variant="destructive" className="text-[10px]">Admin bypass</Badge>
                        )}
                    </div>

                    {profile.title && (
                        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Briefcase size={13} /> {profile.title}
                        </p>
                    )}
                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Mail size={13} /> {profile.email}
                    </p>

                    <div className="flex flex-wrap gap-4 pt-1 text-xs text-muted-foreground">
                        <span>Rank <span className="font-semibold text-foreground">{profile.userRole.rank}</span></span>
                        <span>Scope <span className="font-semibold text-foreground">{SCOPE_LABELS[profile.scope] ?? profile.scope}</span></span>
                        <span>Joined <span className="font-semibold text-foreground">{formatDate(profile.createdAt)}</span></span>
                    </div>
                </div>

                {/* Edit button */}
                <Button asChild variant="outline" size="sm" className="shrink-0">
                    <Link href="/users">Edit in Users</Link>
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Departments */}
                <section className="space-y-2.5">
                    <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        <Users size={13} /> Departments
                    </h2>
                    {profile.departments.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                            {profile.departments.map(d => (
                                <span key={d.id} className="border-2 border-blue-200 bg-blue-50 text-blue-700 px-3 py-1 text-sm font-medium">
                                    {d.name}
                                </span>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground italic">No department assigned</p>
                    )}
                </section>

                {/* Branches */}
                <section className="space-y-2.5">
                    <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        <Building2 size={13} /> Branches
                    </h2>
                    {profile.branches.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                            {profile.branches.map(b => (
                                <span key={b.id} className="border-2 border-orange-200 bg-orange-50 text-orange-700 px-3 py-1 text-sm font-medium">
                                    {b.name}
                                </span>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground italic">No branch assigned</p>
                    )}
                </section>

                {/* Reports to */}
                <section className="space-y-2.5">
                    <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        <ChevronRight size={13} /> Reports to
                    </h2>
                    {profile.manager ? (
                        <MiniCard user={profile.manager} />
                    ) : (
                        <p className="text-sm text-muted-foreground italic">No manager — top of hierarchy</p>
                    )}
                </section>

                {/* Direct reports */}
                <section className="space-y-2.5">
                    <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        <Users size={13} /> Direct Reports
                        {profile.reports.length > 0 && (
                            <span className="ml-1 text-[10px] bg-muted border border-border px-1.5 py-0.5 font-normal normal-case tracking-normal">
                                {profile.reports.length}
                            </span>
                        )}
                    </h2>
                    {profile.reports.length > 0 ? (
                        <div className="space-y-1.5">
                            {profile.reports.map(r => <MiniCard key={r.id} user={r} />)}
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground italic">No direct reports</p>
                    )}
                </section>

            </div>

            {/* Permissions */}
            <section className="space-y-3">
                <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    <Shield size={13} /> Role Permissions
                    <span className="text-[10px] bg-muted border border-border px-1.5 py-0.5 font-normal normal-case tracking-normal">
                        {permissions.length} granted via {profile.userRole.label}
                    </span>
                    {hasBypass && (
                        <span className="text-[10px] bg-destructive/10 text-destructive border border-destructive/20 px-1.5 py-0.5 font-medium normal-case tracking-normal">
                            bypass active — all permissions granted
                        </span>
                    )}
                </h2>

                {permissions.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">No permissions granted by role.</p>
                ) : (
                    <div className="space-y-2">
                        {orderedModules.map(module => (
                            <div key={module} className="border-2 border-border overflow-hidden">
                                <div className="flex items-center gap-2 bg-muted/50 border-b-2 border-border px-3 py-2">
                                    <ShieldCheck size={12} className="text-muted-foreground" />
                                    <span className="text-xs font-bold uppercase tracking-wide">{module}</span>
                                    <span className="ml-auto text-[11px] text-muted-foreground">{byModule[module].length}</span>
                                </div>
                                <div className="divide-y divide-border">
                                    {byModule[module].map(p => (
                                        <div key={p.id} className="flex items-start gap-3 px-3 py-2.5">
                                            <div className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${p.id === "admin:bypass" ? "bg-destructive" : "bg-primary"}`} />
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium text-foreground">{p.label}</p>
                                                {p.description && (
                                                    <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>
                                                )}
                                                <p className="font-mono text-[10px] text-muted-foreground/50 mt-0.5 select-all">{p.id}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
