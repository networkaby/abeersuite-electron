"use client";

// Profile-tab card: assign the customer to a marketing group (Corporate /
// School / Lawyer …) from the CustomerGroup master. Internal-only — the
// customer never sees their group. Shared by Person and Company tabs.

import { useEffect, useState } from "react";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { toast } from "sonner";
import { Users } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { extractApiError } from "@/shared/lib/api";

type GroupOpt = { id: number; name: string; isActive: boolean };

const NO_GROUP = "none"; // Select sentinel — SelectItem can't carry an empty value

interface Props {
    party: { kind: "person" | "company"; id: number };
    initialGroupId: number | null;
    onSaved: () => void;
}

export default function CustomerGroupCard({ party, initialGroupId, onSaved }: Props) {
    const [groups, setGroups] = useState<GroupOpt[]>([]);
    const [groupId, setGroupId] = useState<number | null>(initialGroupId);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        axios.get<GroupOpt[]>("/api/settings/customer-groups")
            .then((res) => setGroups(res.data.filter((g) => g.isActive || g.id === initialGroupId)))
            .catch(() => toast.error("Could not load customer groups"));
    }, [initialGroupId]);

    // The dropdown is reference data — a group added under Settings should be
    // pickable here without reopening the customer. The current selection is
    // separate state and is not touched.
    useRealtimeTopics(["settings", "parties"], () => {
        axios.get<GroupOpt[]>("/api/settings/customer-groups")
            .then((res) => setGroups(res.data.filter((g) => g.isActive || g.id === initialGroupId)))
            .catch(() => { /* keep the options already loaded */ });
    });

    const save = async (next: number | null) => {
        const prev = groupId;
        setGroupId(next);
        setSaving(true);
        try {
            const base = party.kind === "person" ? "/api/person" : "/api/companies";
            await axios.put(`${base}/${party.id}`, { customerGroupId: next });
            onSaved();
        } catch (e) {
            setGroupId(prev);
            toast.error(extractApiError(e, "Could not change the group"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="rounded-lg border border-border p-4">
            <div className="mb-2 flex items-center gap-2">
                <Users size={15} className="text-muted-foreground" />
                <Label className="text-sm font-medium">Marketing group</Label>
            </div>
            <Select
                value={groupId != null ? String(groupId) : NO_GROUP}
                onValueChange={(v) => void save(v === NO_GROUP ? null : Number(v))}
                disabled={saving}
            >
                <SelectTrigger className="h-8 w-full max-w-xs text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                    <SelectItem value={NO_GROUP}>No group</SelectItem>
                    {groups.map((g) => (
                        <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <p className="mt-2 text-xs text-muted-foreground">
                Segment for product targeting — internal only, the customer never sees it.
                Manage the list in Settings → Customer Groups.
            </p>
        </div>
    );
}
