"use client";

// Move a holder from one position to another in a single action.
// Mechanically: DELETE /api/positions/{src}/holders/{userId} then
// POST /api/positions/{dst}/holders { userId }. The source position is left
// in place (only the holder is detached). If the user is already on the
// target, the second call returns 409 and we surface that.

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import { ArrowRightLeft, Search, Building2, Layers } from "lucide-react";
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface PositionHit {
    id: string;
    title: string;
    branch:     { id: string; name: string } | null;
    department: { id: string; name: string } | null;
}

interface Props {
    open: boolean;
    /** Position the holder is currently on. */
    sourcePositionId: string | null;
    sourceTitle: string | null;
    holderUserId: number | null;
    holderName: string | null;
    onClose: () => void;
    onTransferred: () => void;
}

export default function OrgTransferDialog({
    open, sourcePositionId, sourceTitle, holderUserId, holderName, onClose, onTransferred,
}: Props) {
    const [positions, setPositions] = useState<PositionHit[]>([]);
    const [loading, setLoading]     = useState(false);
    const [query, setQuery]         = useState("");
    const [busyId, setBusyId]       = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setQuery("");
        setLoading(true);
        axios.get<PositionHit[]>("/api/positions")
            .then(r => setPositions(r.data))
            .catch(() => toast.error("Failed to load positions"))
            .finally(() => setLoading(false));
    }, [open]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return positions
            .filter(p => p.id !== sourcePositionId)
            .filter(p => {
                if (!q) return true;
                return (
                    p.title.toLowerCase().includes(q) ||
                    p.branch?.name.toLowerCase().includes(q) ||
                    p.department?.name.toLowerCase().includes(q)
                );
            })
            .slice(0, 60);
    }, [positions, query, sourcePositionId]);

    async function transfer(target: PositionHit) {
        if (!sourcePositionId || !holderUserId) return;
        if (!window.confirm(`Transfer ${holderName} from "${sourceTitle}" to "${target.title}"?`)) return;
        setBusyId(target.id);
        try {
            // 1) Remove from source
            await axios.delete(`/api/positions/${encodeURIComponent(sourcePositionId)}/holders/${holderUserId}`);
            // 2) Add to target
            try {
                await axios.post(`/api/positions/${encodeURIComponent(target.id)}/holders`, { userId: holderUserId });
            } catch (postErr) {
                // Rollback: re-attach to source so we don't leave the user orphaned.
                await axios.post(`/api/positions/${encodeURIComponent(sourcePositionId)}/holders`, { userId: holderUserId }).catch(() => {});
                throw postErr;
            }
            toast.success(`${holderName} moved to ${target.title}`);
            onTransferred();
            onClose();
        } catch (err: unknown) {
            toast.error(extractApiError(err, "Failed to transfer"));
        } finally {
            setBusyId(null);
        }
    }

    return (
        <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ArrowRightLeft size={16} className="text-sky-600" />
                        Transfer / Promote {holderName ?? "holder"}
                    </DialogTitle>
                    <DialogDescription>
                        Moving from <span className="font-medium">{sourceTitle}</span>. Pick the target position — branch and department come along for the ride.
                    </DialogDescription>
                </DialogHeader>

                <div className="relative">
                    <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        autoFocus
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Search by title, branch, department…"
                        className="pl-7"
                    />
                </div>

                <div className="max-h-80 overflow-y-auto -mx-1 px-1">
                    {loading && <p className="text-xs text-muted-foreground italic text-center py-6">Loading positions…</p>}
                    {!loading && filtered.length === 0 && (
                        <p className="text-xs text-muted-foreground italic text-center py-6">No matching positions.</p>
                    )}
                    <div className="flex flex-col gap-1">
                        {filtered.map(p => (
                            <button
                                key={p.id}
                                type="button"
                                disabled={busyId === p.id}
                                onClick={() => transfer(p)}
                                className="flex flex-col items-start gap-0.5 px-2 py-1.5 rounded-md text-left hover:bg-muted transition-colors disabled:opacity-50"
                            >
                                <p className="text-xs font-medium truncate w-full">{p.title}</p>
                                <p className="text-[10px] text-muted-foreground flex items-center gap-2 flex-wrap">
                                    {p.branch && (
                                        <span className="inline-flex items-center gap-0.5"><Building2 size={9} /> {p.branch.name}</span>
                                    )}
                                    {p.department && (
                                        <span className="inline-flex items-center gap-0.5"><Layers size={9} /> {p.department.name}</span>
                                    )}
                                    {!p.branch && !p.department && <span className="italic">Org-wide</span>}
                                </p>
                            </button>
                        ))}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
