"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { Building2 } from "lucide-react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useActiveBranchStore } from "@/store/activeBranchStore";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

type Branch = { id: string; name: string; isActive?: boolean };
type SessionUser = { branchIds?: string[]; permissions?: string[] } | null;

export function BranchSwitcher() {
    const router = useRouter();
    const { activeBranchId, setActiveBranchId, hydrate } = useActiveBranchStore();
    const [branches, setBranches] = useState<Branch[]>([]);
    const [user, setUser] = useState<SessionUser>(null);

    const permissions = user?.permissions ?? [];
    const userBranchIds = useMemo(() => user?.branchIds ?? [], [user]);
    const isAdmin = permissions.includes(PERMISSIONS.ADMIN_BYPASS);

    // Fetch session ourselves so we don't depend on SessionProvider being mounted.
    useEffect(() => {
        let cancelled = false;
        fetch("/api/auth/session")
            .then((r) => r.json())
            .then((s: { user?: SessionUser }) => { if (!cancelled) setUser(s?.user ?? null); })
            .catch(() => { /* ignore */ });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            if (!user) return;
            try {
                const res = await axios.get<Branch[]>("/api/branches");
                if (cancelled) return;
                const active = res.data.filter((b) => b.isActive !== false);
                let visible: Branch[] = [];
                if (isAdmin) {
                    visible = active;
                } else if (userBranchIds.length > 0) {
                    visible = active.filter((b) => userBranchIds.includes(b.id));
                }
                setBranches(visible);
                // Default selection rule: land on the first available branch. The top
                // bar represents the user's *working* branch — reports default to org-
                // wide scope on their own, so we never select a combined sentinel here.
                // hydrate() is a no-op if something is already stored, so persistent
                // selection survives reload.
                const fallback = visible[0]?.id ?? null;
                hydrate(fallback);
            } catch {
                /* ignore — fallback to empty list */
            }
        }
        load();
        return () => { cancelled = true; };
    }, [user, isAdmin, userBranchIds, hydrate]);

    if (!user) return null;

    // No accessible branches — an unappointed (position-less) user has no branch.
    // Show no branch control at all.
    if (branches.length === 0) return null;

    // Single-branch users see a static badge (no need to switch).
    if (branches.length === 1) {
        return (
            <div className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-muted-foreground border border-border/60 rounded">
                <Building2 size={12} className="shrink-0" />
                <span className="truncate max-w-[120px]">{branches[0]!.name}</span>
            </div>
        );
    }

    // Top bar always represents a specific working branch. If somehow nothing
    // is selected (shouldn't happen after hydrate, but defensive), fall back to
    // the first visible branch's id rather than showing an empty trigger.
    const current = activeBranchId ?? branches[0]!.id;

    return (
        <Select value={current} onValueChange={(v) => {
            setActiveBranchId(v);
            // Refresh server components so they re-fetch with the new branch cookie.
            router.refresh();
        }}>
            <SelectTrigger className="h-7 w-[200px] text-xs">
                <div className="flex items-center gap-1.5">
                    <Building2 size={12} className="shrink-0 text-muted-foreground" />
                    <SelectValue placeholder="Branch" />
                </div>
            </SelectTrigger>
            <SelectContent>
                {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id} className="text-xs">{b.name}</SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
