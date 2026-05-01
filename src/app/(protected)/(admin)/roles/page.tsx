"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash2, Shield, Lock, Users } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Role {
    id: string;
    label: string;
    color: string;
    rank: number;
    isSystem: boolean;
    _count: { users: number };
    permissions: { permissionId: string }[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COLOR_OPTIONS = [
    { label: "Gray",   value: "bg-gray-100 text-gray-600",    dot: "bg-gray-400" },
    { label: "Blue",   value: "bg-blue-100 text-blue-600",    dot: "bg-blue-500" },
    { label: "Green",  value: "bg-green-100 text-green-600",  dot: "bg-green-500" },
    { label: "Red",    value: "bg-red-100 text-red-600",      dot: "bg-red-500" },
    { label: "Purple", value: "bg-purple-100 text-purple-600",dot: "bg-purple-500" },
    { label: "Orange", value: "bg-orange-100 text-orange-600",dot: "bg-orange-500" },
    { label: "Yellow", value: "bg-yellow-100 text-yellow-600",dot: "bg-yellow-400" },
    { label: "Teal",   value: "bg-teal-100 text-teal-600",    dot: "bg-teal-500" },
];

// Static map so Tailwind JIT sees all classes
const ROLE_ACCENT: Record<string, string> = {
    "bg-gray-100 text-gray-600":    "border-l-gray-300",
    "bg-blue-100 text-blue-600":    "border-l-blue-400",
    "bg-green-100 text-green-600":  "border-l-green-400",
    "bg-red-100 text-red-600":      "border-l-red-400",
    "bg-purple-100 text-purple-600":"border-l-purple-400",
    "bg-orange-100 text-orange-600":"border-l-orange-400",
    "bg-yellow-100 text-yellow-600":"border-l-yellow-300",
    "bg-teal-100 text-teal-600":    "border-l-teal-400",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RolesSettingsPage() {
    const [roles, setRoles] = useState<Role[]>([]);
    const [loading, setLoading] = useState(true);

    const [addingNew, setAddingNew] = useState(false);
    const [newRole, setNewRole] = useState({ label: "", color: "bg-blue-100 text-blue-600", rank: 20 });
    const [editingRank, setEditingRank] = useState<{ id: string; rank: number } | null>(null);
    const [saving, setSaving] = useState(false);

    const fetchData = async () => {
        try {
            const rolesRes = await axios.get<Role[]>("/api/roles");
            setRoles(rolesRes.data);
        } catch {
            toast.error("Failed to load roles");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, []);

    const handleSaveRank = async () => {
        if (!editingRank) return;
        try {
            await axios.patch(`/api/roles/${editingRank.id}`, { rank: editingRank.rank });
            toast.success("Rank updated");
            setEditingRank(null);
            fetchData();
        } catch { toast.error("Failed to update rank"); }
    };

    const handleCreate = async () => {
        if (!newRole.label.trim()) return;
        setSaving(true);
        try {
            await axios.post("/api/roles", newRole);
            toast.success("Role created");
            setAddingNew(false);
            setNewRole({ label: "", color: "bg-blue-100 text-blue-600", rank: 20 });
            fetchData();
        } catch {
            toast.error("Failed to create role");
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Delete this role? Users assigned this role will lose it.")) return;
        try {
            await axios.delete(`/api/roles/${id}`);
            toast.success("Role deleted");
            fetchData();
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e) ? e.response?.data?.error : "Failed to delete role";
            toast.error(msg);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
                Loading roles…
            </div>
        );
    }

    return (
        <div className="max-w-3xl space-y-6">

            {/* ── Page header ─────────────────────────────────────────────── */}
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">
                        Roles &amp; Permissions
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Define what each role can do. System roles cannot be deleted.
                    </p>
                </div>
                <Button onClick={() => setAddingNew(true)}>
                    <Plus /> New Role
                </Button>
            </div>

            {/* ── New role form ────────────────────────────────────────────── */}
            {addingNew && (
                <Card className="border border-primary/30 bg-primary/5">
                    <CardContent className="pt-5 pb-4">
                        <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-3">
                            New Role
                        </p>
                        <div className="flex flex-wrap gap-3 items-end">
                            {/* Label */}
                            <div className="flex-1 min-w-48">
                                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                    Role name
                                </label>
                                <Input
                                    autoFocus
                                    value={newRole.label}
                                    onChange={(e) => setNewRole(r => ({ ...r, label: e.target.value }))}
                                    onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                                    placeholder="e.g. Senior Technician"
                                />
                            </div>

                            {/* Rank */}
                            <div className="w-28">
                                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                    Rank (0–100)
                                </label>
                                <Input
                                    type="number"
                                    min={0}
                                    max={100}
                                    value={newRole.rank}
                                    onChange={(e) => setNewRole(r => ({ ...r, rank: Number(e.target.value) }))}
                                    placeholder="20"
                                />
                            </div>

                            {/* Colour picker */}
                            <div>
                                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                    Colour
                                </label>
                                <div className="flex gap-1.5 flex-wrap">
                                    {COLOR_OPTIONS.map(c => (
                                        <button
                                            key={c.value}
                                            type="button"
                                            title={c.label}
                                            onClick={() => setNewRole(r => ({ ...r, color: c.value }))}
                                            className={[
                                                "h-7 w-7 border-2 transition-all duration-150",
                                                c.dot,
                                                newRole.color === c.value
                                                    ? "border-foreground ring-2 ring-border ring-offset-1 scale-110"
                                                    : "border-transparent hover:scale-105 hover:border-border",
                                            ].join(" ")}
                                        />
                                    ))}
                                </div>
                            </div>

                            {/* Preview */}
                            {newRole.label && (
                                <Badge className={newRole.color}>{newRole.label}</Badge>
                            )}

                            {/* Actions */}
                            <div className="flex gap-2 ml-auto">
                                <Button variant="outline" size="sm" onClick={() => setAddingNew(false)}>
                                    Cancel
                                </Button>
                                <Button size="sm" disabled={saving || !newRole.label.trim()} onClick={handleCreate}>
                                    {saving ? "Creating…" : "Create Role"}
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* ── Role list ────────────────────────────────────────────────── */}
            <div className="space-y-2.5">
                {roles.map((role) => {
                    const accent = ROLE_ACCENT[role.color] ?? "border-l-gray-300";
                    return (
                        <Card
                            key={role.id}
                            className={`border-l-4 ${accent}`}
                        >
                            <CardContent className="py-3.5 flex items-center gap-4">
                                {/* Role badge */}
                                <Badge className={`${role.color} shrink-0 font-mono text-xs`}>
                                    {role.id}
                                </Badge>

                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-semibold text-sm text-foreground">
                                            {role.label}
                                        </span>
                                        {role.isSystem && (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground bg-muted border border-border px-1.5 py-0.5">
                                                <Lock size={9} /> System
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground bg-muted border border-border px-2 py-0.5">
                                            <Users size={9} />
                                            {role._count.users} {role._count.users === 1 ? "user" : "users"}
                                        </span>
                                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground bg-muted border border-border px-2 py-0.5">
                                            <Shield size={9} />
                                            {role.permissions.length} permissions
                                        </span>
                                        {/* Rank inline editor */}
                                        {editingRank?.id === role.id ? (
                                            <span className="inline-flex items-center gap-1">
                                                <Input
                                                    type="number" min={0} max={100}
                                                    value={editingRank.rank}
                                                    onChange={e => setEditingRank(r => r ? { ...r, rank: Number(e.target.value) } : r)}
                                                    className="h-6 w-16 text-xs px-1 py-0"
                                                    autoFocus
                                                />
                                                <button onClick={handleSaveRank} className="text-[11px] text-primary font-semibold hover:underline">Save</button>
                                                <button onClick={() => setEditingRank(null)} className="text-[11px] text-muted-foreground hover:underline">×</button>
                                            </span>
                                        ) : (
                                            <button
                                                onClick={() => setEditingRank({ id: role.id, rank: role.rank })}
                                                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground bg-muted border border-border px-2 py-0.5 hover:border-primary hover:text-primary transition-colors"
                                                title="Click to edit rank"
                                            >
                                                Rank {role.rank}
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Actions */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    asChild
                                    className="shrink-0"
                                >
                                    <Link href={`/roles/${role.id}`}>
                                        <Shield size={13} />
                                        Permissions
                                    </Link>
                                </Button>

                                {!role.isSystem && (
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        onClick={() => handleDelete(role.id)}
                                        className="shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                        title="Delete role"
                                    >
                                        <Trash2 size={14} />
                                    </Button>
                                )}
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

        </div>
    );
}
