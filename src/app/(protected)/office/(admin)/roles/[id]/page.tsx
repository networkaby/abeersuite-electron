"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import {
    ArrowLeft, Shield, Search, Check, AlertTriangle,
    ChevronDown, ChevronRight, Users, Lock,
    ClipboardList, Ticket, Settings, ShieldCheck, Wrench,
    Save, RotateCcw,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Permission {
    id: string;
    label: string;
    module: string;
    description?: string | null;
}

interface Role {
    id: string;
    label: string;
    color: string;
    rank: number;
    isSystem: boolean;
    _count: { users: number };
    permissions: { permissionId: string; permission: Permission }[];
}

// ─── Module metadata ──────────────────────────────────────────────────────────

const MODULE_META: Record<string, { label: string; description: string; icon: React.ReactNode; chip: string }> = {
    core:        { label: "Core",           description: "System-level access controls",         icon: <ShieldCheck size={13} />, chip: "bg-red-50 border-red-200 text-red-700" },
    customers:   { label: "Customers",      description: "Customer and company record access",   icon: <Users size={13} />,       chip: "bg-blue-50 border-blue-200 text-blue-700" },
    tickets:     { label: "Tickets",        description: "Ticket workflow and ownership",        icon: <Ticket size={13} />,      chip: "bg-indigo-50 border-indigo-200 text-indigo-700" },
    assignments: { label: "Assignments",    description: "Work Inbox visibility scopes",        icon: <ClipboardList size={13} />,chip: "bg-emerald-50 border-emerald-200 text-emerald-700" },
    service:     { label: "Service",        description: "Service centers and warranty fields",  icon: <Wrench size={13} />,      chip: "bg-orange-50 border-orange-200 text-orange-700" },
    admin:       { label: "Administration", description: "System settings and user management", icon: <Settings size={13} />,    chip: "bg-purple-50 border-purple-200 text-purple-700" },
};

const MODULE_ORDER = ["core", "customers", "tickets", "assignments", "service", "admin"];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RolePermissionsPage({ params }: { params: Promise<{ id: string }> }) {
    const { id: roleId } = use(params);
    const router = useRouter();

    const [role,           setRole]           = useState<Role | null>(null);
    const [allPerms,       setAllPerms]       = useState<Permission[]>([]);
    const [selected,       setSelected]       = useState<Set<string>>(new Set());
    const [original,       setOriginal]       = useState<Set<string>>(new Set());
    const [loading,        setLoading]        = useState(true);
    const [saving,         setSaving]         = useState(false);
    const [search,         setSearch]         = useState("");
    const [collapsed,      setCollapsed]      = useState<Set<string>>(new Set());

    // ── Load ─────────────────────────────────────────────────────────────────

    useEffect(() => {
        Promise.all([
            axios.get<Role>(`/api/roles/${roleId}`),
            axios.get<Permission[]>("/api/permissions"),
        ])
            .then(([roleRes, permsRes]) => {
                const r = roleRes.data;
                setRole(r);
                setAllPerms(permsRes.data);
                const granted = new Set(r.permissions.map(p => p.permissionId));
                setSelected(granted);
                setOriginal(new Set(granted));
            })
            .catch(() => toast.error("Failed to load role"))
            .finally(() => setLoading(false));
    }, [roleId]);

    // ── Derived ──────────────────────────────────────────────────────────────

    const hasChanges = () => {
        if (selected.size !== original.size) return true;
        for (const p of selected) if (!original.has(p)) return true;
        return false;
    };

    const hasBypass = selected.has("admin:bypass");

    const filtered = search.trim()
        ? allPerms.filter(p =>
            [p.label, p.id, p.module, p.description ?? ""]
                .some(s => s.toLowerCase().includes(search.toLowerCase()))
        )
        : allPerms;

    const byModule = filtered.reduce<Record<string, Permission[]>>((acc, p) => {
        (acc[p.module] ??= []).push(p);
        return acc;
    }, {});

    const orderedModules = [
        ...MODULE_ORDER.filter(m => byModule[m]),
        ...Object.keys(byModule).filter(m => !MODULE_ORDER.includes(m)),
    ];

    // ── Handlers ─────────────────────────────────────────────────────────────

    const togglePerm = (id: string) =>
        setSelected((prev) => {
            const n = new Set(prev);
            if (n.has(id)) n.delete(id);
            else n.add(id);
            return n;
        });

    const toggleModule = (mod: string) =>
        setCollapsed((prev) => {
            const n = new Set(prev);
            if (n.has(mod)) n.delete(mod);
            else n.add(mod);
            return n;
        });

    const selectAll   = (perms: Permission[]) =>
        setSelected(prev => { const n = new Set(prev); perms.forEach(p => n.add(p.id));    return n; });

    const deselectAll = (perms: Permission[]) =>
        setSelected(prev => { const n = new Set(prev); perms.forEach(p => n.delete(p.id)); return n; });

    const handleSave = async () => {
        if (!role) return;
        setSaving(true);
        try {
            await axios.put(`/api/roles/${roleId}/permissions`, { permissionIds: [...selected] });
            setOriginal(new Set(selected));
            toast.success("Permissions saved");
            router.refresh();
        } catch {
            toast.error("Failed to save permissions");
        } finally {
            setSaving(false);
        }
    };

    const handleDiscard = () => setSelected(new Set(original));

    // ── Loading ───────────────────────────────────────────────────────────────

    if (loading) {
        return (
            <div className="flex items-center justify-center py-32 text-muted-foreground text-sm">
                Loading…
            </div>
        );
    }

    if (!role) {
        return (
            <div className="flex flex-col items-center justify-center py-32 gap-3 text-muted-foreground">
                <Shield size={36} className="opacity-20" />
                <p className="text-sm">Role not found.</p>
                <Link href="/office/roles" className="text-xs text-primary hover:underline">← Back to Roles</Link>
            </div>
        );
    }

    const selectedCount = selected.size;
    const totalCount    = allPerms.length;

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="flex flex-col min-h-[calc(100vh-4rem)]">

            {/* ── Breadcrumb ─────────────────────────────────────────────── */}
            <div className="mb-6">
                <Link
                    href="/office/roles"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                    <ArrowLeft size={12} /> Back to Roles
                </Link>
            </div>

            {/* ── Main layout: sidebar + content ─────────────────────────── */}
            <div className="flex gap-6 flex-1 items-start">

                {/* ── LEFT SIDEBAR ───────────────────────────────────────── */}
                <aside className="w-64 shrink-0 sticky top-6 space-y-4">

                    {/* Role card */}
                    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
                        <div className="flex items-center gap-2 flex-wrap">
                            <Badge className={`${role.color} font-mono text-xs shrink-0`}>{role.id}</Badge>
                            {role.isSystem && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground bg-muted border border-border px-1.5 py-0.5">
                                    <Lock size={9} /> System
                                </span>
                            )}
                        </div>
                        <div>
                            <p className="text-base font-bold text-foreground leading-tight">{role.label}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Rank {role.rank}</p>
                        </div>
                        <div className="flex gap-3 text-xs text-muted-foreground border-t border-border pt-3">
                            <span className="flex items-center gap-1"><Users size={11} /> {role._count.users} {role._count.users === 1 ? "user" : "users"}</span>
                            <span className="flex items-center gap-1"><Shield size={11} /> {selectedCount}/{totalCount}</span>
                        </div>
                    </div>

                    {/* Save / Discard */}
                    <div className="space-y-2">
                        <Button
                            className="w-full"
                            onClick={handleSave}
                            disabled={saving || !hasChanges()}
                        >
                            <Save size={14} />
                            {saving ? "Saving…" : hasChanges() ? `Save ${selectedCount} permission${selectedCount !== 1 ? "s" : ""}` : "No changes"}
                        </Button>
                        <Button
                            variant="outline"
                            className="w-full"
                            onClick={handleDiscard}
                            disabled={!hasChanges()}
                        >
                            <RotateCcw size={14} />
                            Discard changes
                        </Button>
                    </div>

                    {/* Unsaved indicator */}
                    {hasChanges() && (
                        <p className="text-[11px] text-center text-primary font-medium animate-pulse">
                            · unsaved changes
                        </p>
                    )}

                    {/* admin:bypass warning */}
                    {hasBypass && (
                        <div className="flex items-start gap-2 border-2 border-destructive/30 bg-destructive/10 px-3 py-2.5">
                            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-destructive" />
                            <p className="text-[11px] leading-relaxed text-destructive">
                                <span className="font-semibold">admin:bypass active.</span>{" "}
                                This role skips every permission check in the system.
                            </p>
                        </div>
                    )}
                </aside>

                {/* ── RIGHT CONTENT ──────────────────────────────────────── */}
                <div className="flex-1 min-w-0 space-y-4 pb-12">

                    {/* Page title */}
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <h1 className="text-xl font-bold tracking-tight">
                                Permissions
                                <span className="ml-2 font-normal text-muted-foreground">—</span>
                                <Badge className={`${role.color} ml-2`}>{role.label}</Badge>
                            </h1>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Check the permissions this role grants. Changes apply on next login.
                            </p>
                        </div>
                    </div>

                    {/* Search + global bulk */}
                    <div className="flex gap-2 rounded-md border border-border bg-muted/30 px-4 py-3">
                        <div className="relative flex-1">
                            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="Search permissions by name, module or ID…"
                                className="pl-8 h-8 text-sm"
                            />
                        </div>
                        <Button variant="outline" size="sm"
                            onClick={() => setSelected(new Set(allPerms.map(p => p.id)))}>
                            Select all
                        </Button>
                        <Button variant="outline" size="sm"
                            onClick={() => setSelected(new Set())}>
                            Clear all
                        </Button>
                    </div>

                    {/* Module sections */}
                    {orderedModules.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                            <Search size={32} className="mb-3 opacity-20" />
                            <p className="text-sm">No permissions match your search.</p>
                        </div>
                    ) : (
                        orderedModules.map(mod => {
                            const perms          = byModule[mod];
                            const meta           = MODULE_META[mod];
                            const selectedInMod  = perms.filter(p => selected.has(p.id)).length;
                            const allSelected    = selectedInMod === perms.length;
                            const isCollapsed    = collapsed.has(mod);

                            return (
                                <div key={mod} className="overflow-hidden rounded-lg border border-border bg-card">

                                    {/* Module header */}
                                    <div className={[
                                        "flex items-center gap-2.5 border-b border-border px-4 py-3",
                                        meta?.chip ?? "bg-muted text-foreground",
                                    ].join(" ")}>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-xs"
                                            onClick={() => toggleModule(mod)}
                                            className="opacity-60 hover:opacity-100 transition-opacity"
                                            title={isCollapsed ? "Expand" : "Collapse"}
                                        >
                                            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                        </Button>
                                        <span className="opacity-70">{meta?.icon}</span>
                                        <div className="flex-1 min-w-0">
                                            <span className="text-xs font-bold uppercase tracking-wider">
                                                {meta?.label ?? mod}
                                            </span>
                                            {!search && meta?.description && (
                                                <span className="ml-2 text-[11px] font-normal normal-case tracking-normal opacity-60">
                                                    {meta.description}
                                                </span>
                                            )}
                                        </div>
                                        <span className="text-xs font-semibold tabular-nums opacity-60">
                                            {selectedInMod}/{perms.length}
                                        </span>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="xs"
                                            onClick={() => allSelected ? deselectAll(perms) : selectAll(perms)}
                                            className="h-auto px-2 py-0.5 text-xs font-medium hover:bg-black/10"
                                        >
                                            {allSelected ? "None" : "All"}
                                        </Button>
                                    </div>

                                    {/* Permission rows */}
                                    {!isCollapsed && (
                                        <div className="divide-y divide-border">
                                            {perms.map(p => {
                                                const isOn        = selected.has(p.id);
                                                const isDangerous = p.id === "admin:bypass";
                                                const wasOriginal = original.has(p.id);
                                                const changed     = isOn !== wasOriginal;

                                                return (
                                                    <Button
                                                        key={p.id}
                                                        type="button"
                                                        variant="ghost"
                                                        onClick={() => togglePerm(p.id)}
                                                        className={[
                                                            "h-auto w-full items-start justify-start gap-4 rounded-none px-5 py-3.5 text-left transition-colors group",
                                                            isDangerous
                                                                ? isOn ? "bg-destructive/10 hover:bg-destructive/5" : "hover:bg-destructive/5"
                                                                : isOn ? "bg-primary/5 hover:bg-primary/10"   : "hover:bg-muted/60",
                                                        ].join(" ")}
                                                    >
                                                        {/* Checkbox */}
                                                        <div className={[
                                                            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border-2 transition-all",
                                                            isOn
                                                                ? isDangerous
                                                                    ? "border-destructive bg-destructive"
                                                                    : "border-primary bg-primary"
                                                                : "border-border group-hover:border-foreground/50",
                                                        ].join(" ")}>
                                                            {isOn && <Check size={10} strokeWidth={3} className="text-white" />}
                                                        </div>

                                                        {/* Text */}
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <span className={[
                                                                    "text-sm font-medium leading-none",
                                                                    isDangerous && isOn
                                                                        ? "text-destructive"
                                                                        : isOn ? "text-foreground" : "text-muted-foreground",
                                                                ].join(" ")}>
                                                                    {p.label}
                                                                </span>
                                                                {isDangerous && (
                                                                    <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
                                                                        Dangerous
                                                                    </Badge>
                                                                )}
                                                                {changed && (
                                                                    <span className={`text-[10px] font-semibold ${isOn ? "text-green-600" : "text-red-500"}`}>
                                                                        {isOn ? "+ added" : "− removed"}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {p.description && (
                                                                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                                                    {p.description}
                                                                </p>
                                                            )}
                                                            <p className="mt-1 font-mono text-[10px] text-muted-foreground/40 select-all">
                                                                {p.id}
                                                            </p>
                                                        </div>
                                                    </Button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* ── Sticky bottom save bar ─────────────────────────────────── */}
            {hasChanges() && (
                <div className="fixed bottom-0 left-0 right-0 z-50 border-t-2 border-primary/20 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80 px-6 py-3 flex items-center justify-between gap-4 shadow-lg">
                    <p className="text-sm text-muted-foreground">
                        <span className="font-semibold text-foreground">{selectedCount}</span> permissions selected
                        {" · "}unsaved changes
                    </p>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={handleDiscard}>
                            <RotateCcw size={13} /> Discard
                        </Button>
                        <Button size="sm" onClick={handleSave} disabled={saving}>
                            <Save size={13} />
                            {saving ? "Saving…" : "Save permissions"}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
