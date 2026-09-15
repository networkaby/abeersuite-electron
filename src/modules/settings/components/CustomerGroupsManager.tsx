"use client";

// Settings → Customer Groups — marketing segment master (Corporate / School /
// Lawyer …). Groups are assigned on the customer profile and used for product
// targeting. Internal-only — the customer never sees their group.

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { extractApiError } from "@/shared/lib/api";
import { confirmAction } from "@/shared/lib/ui/confirmStore";

type GroupRow = {
    id: number;
    name: string;
    isActive: boolean;
    _count: { persons: number; companies: number };
};

export function CustomerGroupsManager() {
    const [rows, setRows] = useState<GroupRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [draftName, setDraftName] = useState("");

    useEffect(() => {
        axios.get<GroupRow[]>("/api/settings/customer-groups")
            .then((res) => setRows(res.data))
            .catch(() => toast.error("Could not load customer groups"))
            .finally(() => setLoading(false));
    }, []);

    const addGroup = async () => {
        const name = draftName.trim();
        if (!name) { toast.error("Give the group a name"); return; }
        setSaving(true);
        try {
            const { data } = await axios.post<GroupRow>("/api/settings/customer-groups", { name });
            setRows((p) => [...p, { ...data, _count: data._count ?? { persons: 0, companies: 0 } }]
                .sort((a, b) => a.name.localeCompare(b.name)));
            setDraftName("");
            toast.success(`Group "${data.name}" added`);
        } catch (e) {
            toast.error(extractApiError(e, "Could not add the group"));
        } finally {
            setSaving(false);
        }
    };

    const patchGroup = async (id: number, patch: Record<string, unknown>) => {
        try {
            const { data } = await axios.patch<GroupRow>(`/api/settings/customer-groups/${id}`, patch);
            setRows((p) => p.map((r) => (r.id === id ? { ...r, ...data } : r)));
        } catch (e) {
            toast.error(extractApiError(e, "Could not update the group"));
        }
    };

    const removeGroup = async (row: GroupRow) => {
        const members = row._count.persons + row._count.companies;
        const ok = await confirmAction({
            title: `Delete group "${row.name}"?`,
            body: members > 0 ? `${members} customer(s) will be detached from it.` : "This cannot be undone.",
            confirmLabel: "Delete",
        });
        if (!ok) return;
        try {
            await axios.delete(`/api/settings/customer-groups/${row.id}`);
            setRows((p) => p.filter((r) => r.id !== row.id));
        } catch (e) {
            toast.error(extractApiError(e, "Could not delete the group"));
        }
    };

    if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

    return (
        <div className="max-w-2xl space-y-4">
            <div className="rounded-lg border border-border">
                <div className="grid grid-cols-[1fr_110px_70px_40px] items-center gap-2 border-b border-border bg-muted/50 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    <span>Group</span>
                    <span>Members</span>
                    <span>Active</span>
                    <span />
                </div>
                {rows.length === 0 && (
                    <p className="px-3 py-4 text-sm text-muted-foreground">No groups yet — add the first one below.</p>
                )}
                {rows.map((row) => (
                    <div key={row.id} className="grid grid-cols-[1fr_110px_70px_40px] items-center gap-2 border-b border-border px-3 py-2 last:border-b-0">
                        <Input
                            defaultValue={row.name}
                            onBlur={(e) => {
                                const v = e.target.value.trim();
                                if (v && v !== row.name) void patchGroup(row.id, { name: v });
                            }}
                            className="h-8 text-sm"
                        />
                        <span className="text-sm text-muted-foreground">
                            {row._count.persons + row._count.companies}
                        </span>
                        <Switch
                            checked={row.isActive}
                            onCheckedChange={(v) => void patchGroup(row.id, { isActive: v })}
                        />
                        <Button variant="ghost" size="icon-sm" onClick={() => void removeGroup(row)} title="Delete">
                            <Trash2 size={14} className="text-destructive" />
                        </Button>
                    </div>
                ))}
            </div>

            {/* Add row */}
            <div className="rounded-lg border border-dashed border-border p-3">
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Add group</p>
                <div className="flex items-center gap-2">
                    <Input
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") void addGroup(); }}
                        placeholder="e.g. Corporate, School, Lawyer"
                        className="h-8 text-sm"
                    />
                    <Button size="sm" onClick={() => void addGroup()} disabled={saving}>
                        <Plus size={14} className="mr-1" /> Add
                    </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                    Assign a group on the customer&apos;s Profile tab. Internal only — the customer never sees it.
                </p>
            </div>
        </div>
    );
}
