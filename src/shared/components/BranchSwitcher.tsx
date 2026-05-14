"use client";

import { useEffect, useState } from "react";
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
    const { activeBranchId, setActiveBranchId, hydrate } = useActiveBranchStore();
    const [branches, setBranches] = useState<Branch[]>([]);
    const [user, setUser] = useState<SessionUser>(null);

    const permissions = user?.permissions ?? [];
    const userBranchIds = user?.branchIds ?? [];
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
        if (!user) return;
        hydrate(userBranchIds[0] ?? null);
    }, [user, hydrate, userBranchIds]);

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
                // Ensure a branch is always active in the cookie.
                // hydrate() is a no-op if something is already stored — safe to call here.
                // This covers admin users who have no branch assignments in the session.
                hydrate(visible[0]?.id ?? null);
            } catch {
                /* ignore — fallback to empty list */
            }
        }
        load();
        return () => { cancelled = true; };
    }, [user, isAdmin, userBranchIds, hydrate]);

    if (!user || branches.length === 0) return null;

    // Single-branch users see a static badge (no need to switch).
    if (branches.length === 1) {
        return (
            <div className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-muted-foreground border border-border/60 rounded">
                <Building2 size={12} className="shrink-0" />
                <span className="truncate max-w-[120px]">{branches[0]!.name}</span>
            </div>
        );
    }

    const current = activeBranchId ?? branches[0]!.id;

    return (
        <Select value={current} onValueChange={(v) => {
            setActiveBranchId(v);
            // Soft reload so server-side route handlers re-fetch with new branch.
            if (typeof window !== "undefined") window.location.reload();
        }}>
            <SelectTrigger className="h-7 w-[180px] text-xs">
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
