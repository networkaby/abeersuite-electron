"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { extractApiError } from "@/shared/lib/api";

/** `position` = the title(s) of the Position(s) that give them chat access. */
export type Staff = { id: number; name: string; position?: string };
/** @All / @Department / @Branch — a mention of the group mentions each member. */
export type StaffGroup = { kind: "all" | "department" | "branch"; id: string; name: string; memberIds: number[] };
type Directory = { staff: Staff[]; groups: StaffGroup[] };
export type PickMode = "invite" | "handover";

/** The staff list is the same for every chat — fetched once per page load. */
let directoryCache: Promise<Directory> | null = null;
export function loadDirectory(): Promise<Directory> {
    directoryCache ??= axios.get<Directory>("/api/messages/claim").then((r) => r.data)
        .catch((e) => { directoryCache = null; throw e; });
    return directoryCache;
}
export const loadStaff = (): Promise<Staff[]> => loadDirectory().then((d) => d.staff);

/**
 * Pick a colleague to invite onto a customer chat, or to hand it over to.
 * Used by the new-message popup and the Messages screen; the caller does the
 * POST /api/messages/claim with the picked id.
 */
export default function StaffPickerDialog({ mode, exclude, onPick, onClose }: {
    mode: PickMode | null;
    /** Already in the chat (or the caller) — not offered. */
    exclude: number[];
    onPick: (s: Staff) => void;
    onClose: () => void;
}) {
    const [staff, setStaff] = useState<Staff[] | null>(null);
    const [q, setQ] = useState("");

    useEffect(() => {
        if (!mode) return;
        loadStaff().then(setStaff).catch((e) => toast.error(extractApiError(e, "Could not load staff")));
    }, [mode]);

    const list = (staff ?? []).filter((s) => !exclude.includes(s.id) && s.name.toLowerCase().includes(q.trim().toLowerCase()));

    return (
        <Dialog open={mode !== null} onOpenChange={(o) => { if (!o) { setQ(""); onClose(); } }}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>{mode === "handover" ? "Hand this chat over to" : "Invite to help on this chat"}</DialogTitle>
                </DialogHeader>
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search staff" autoFocus />
                <div className="max-h-72 overflow-y-auto">
                    {list.map((s) => (
                        <button key={s.id} className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={() => { setQ(""); onPick(s); }}>
                            {s.name}
                            {s.position && <span className="ml-1 text-xs text-muted-foreground">· {s.position}</span>}
                        </button>
                    ))}
                    {staff == null && <p className="p-2 text-sm text-muted-foreground">Loading…</p>}
                </div>
            </DialogContent>
        </Dialog>
    );
}
