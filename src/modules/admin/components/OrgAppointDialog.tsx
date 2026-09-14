"use client";

// Appoint a user as the holder of a position, from inside the Regions tab.
// Lightweight searchable user picker — hits POST /api/positions/[id]/holders.
// Fetches /api/users on open (lazy, cached for the dialog's lifetime).

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import { UserPlus, Search } from "lucide-react";
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { initials } from "@/shared/lib/format/initials";

interface UserHit {
    id: number;
    name: string;
    email: string;
    avatarUrl: string | null;
    userRole?: { label: string; color: string } | null;
}

interface Props {
    open: boolean;
    positionId: string | null;
    positionTitle: string | null;
    existingHolderIds: number[];
    onClose: () => void;
    onAppointed: () => void;
}

export default function OrgAppointDialog({
    open, positionId, positionTitle, existingHolderIds, onClose, onAppointed,
}: Props) {
    const [users, setUsers]     = useState<UserHit[]>([]);
    const [loading, setLoading] = useState(false);
    const [query, setQuery]     = useState("");
    const [busyId, setBusyId]   = useState<number | null>(null);

    useEffect(() => {
        if (!open) return;
        setQuery("");
        setLoading(true);
        axios.get<UserHit[]>("/api/users")
            .then(r => setUsers(r.data))
            .catch(() => toast.error("Failed to load users"))
            .finally(() => setLoading(false));
    }, [open]);

    const heldSet = useMemo(() => new Set(existingHolderIds), [existingHolderIds]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return users
            .filter(u => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
            .slice(0, 50);
    }, [users, query]);

    async function appoint(user: UserHit) {
        if (!positionId) return;
        setBusyId(user.id);
        try {
            await axios.post(`/api/positions/${encodeURIComponent(positionId)}/holders`, { userId: user.id });
            toast.success(`Appointed ${user.name} to ${positionTitle ?? "position"}`);
            onAppointed();
            onClose();
        } catch (err: unknown) {
            toast.error(extractApiError(err, "Failed to appoint"));
        } finally {
            setBusyId(null);
        }
    }

    return (
        <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <UserPlus size={16} className="text-sky-600" />
                        Appoint to {positionTitle ?? "position"}
                    </DialogTitle>
                    <DialogDescription>
                        Pick a user to add as a holder. Users already on this position are dimmed.
                    </DialogDescription>
                </DialogHeader>

                <div className="relative">
                    <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        autoFocus
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Search by name or email…"
                        className="pl-7"
                    />
                </div>

                <div className="max-h-72 overflow-y-auto -mx-1 px-1">
                    {loading && <p className="text-xs text-muted-foreground italic text-center py-6">Loading users…</p>}
                    {!loading && filtered.length === 0 && (
                        <p className="text-xs text-muted-foreground italic text-center py-6">No matching users.</p>
                    )}
                    <div className="flex flex-col gap-1">
                        {filtered.map(u => {
                            const isHolder = heldSet.has(u.id);
                            return (
                                <button
                                    key={u.id}
                                    type="button"
                                    disabled={isHolder || busyId === u.id}
                                    onClick={() => appoint(u)}
                                    className={[
                                        "flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors",
                                        isHolder
                                            ? "opacity-50 cursor-not-allowed bg-muted/40"
                                            : "hover:bg-muted",
                                    ].join(" ")}
                                >
                                    {u.avatarUrl ? (
                                        <Image src={u.avatarUrl} alt={u.name} width={28} height={28} className="rounded-full object-cover shrink-0" />
                                    ) : (
                                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-foreground shrink-0">
                                            {initials(u.name)}
                                        </span>
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs font-medium truncate">{u.name}</p>
                                        <p className="text-[10px] text-muted-foreground truncate">{u.email}</p>
                                    </div>
                                    {isHolder && (
                                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Already holder</span>
                                    )}
                                    {busyId === u.id && (
                                        <span className="text-[10px] text-muted-foreground italic">…</span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
