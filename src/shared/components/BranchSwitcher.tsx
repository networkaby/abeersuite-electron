"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { Building2, Globe2 } from "lucide-react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useActiveBranchStore, COMBINED_BRANCH } from "@/store/activeBranchStore";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

type Branch = { id: string; name: string; isActive?: boolean };
type SessionUser = { branchIds?: string[]; permissions?: string[] } | null;

export function BranchSwitcher() {
    const router = useRouter();
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
                // Default selection rule: multi-branch users land in COMBINED ("My branches");
                // single-branch users land on their one branch. hydrate() is a no-op if
                // something is already stored, so persistent selection survives reload.
                const fallback = visible.length >= 2 ? COMBINED_BRANCH : (visible[0]?.id ?? null);
                hydrate(fallback);
            } catch {
                /* ignore — fallback to empty list */
            }
        }
        load();
        return () => { cancelled = true; };
    }, [user, isAdmin, userBranchIds, hydrate]);

    if (!user) return null;

    // No accessible branches — position-less user. Show an explicit badge so
    // they know why the operational UI is locked out.
    if (branches.length === 0) {
        return (
            <div className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400 border border-amber-300/60 dark:border-amber-700/60 rounded bg-amber-50/40 dark:bg-amber-950/20">
                <Building2 size={12} className="shrink-0" />
                <span className="truncate max-w-[160px]">No branch assigned</span>
            </div>
        );
    }

    // Single-branch users see a static badge (no need to switch).
    if (branches.length === 1) {
        return (
            <div className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-muted-foreground border border-border/60 rounded">
                <Building2 size={12} className="shrink-0" />
                <span className="truncate max-w-[120px]">{branches[0]!.name}</span>
            </div>
        );
    }

    const current = activeBranchId ?? COMBINED_BRANCH;
    // Admins see the whole org → label as "Consolidated".
    // Multi-branch non-admin users (incl. org-wide post holders like CEO) see "My branches".
    const combinedLabel = isAdmin ? "Consolidated" : "My branches";

    return (
        <Select value={current} onValueChange={(v) => {
            setActiveBranchId(v);
            // Refresh server components so they re-fetch with the new branch cookie.
            router.refresh();
        }}>
            <SelectTrigger className="h-7 w-[200px] text-xs">
                <div className="flex items-center gap-1.5">
                    {current === COMBINED_BRANCH
                        ? <Globe2 size={12} className="shrink-0 text-muted-foreground" />
                        : <Building2 size={12} className="shrink-0 text-muted-foreground" />}
                    <SelectValue placeholder="Branch" />
                </div>
            </SelectTrigger>
            <SelectContent>
                <SelectItem value={COMBINED_BRANCH} className="text-xs">
                    <span className="flex items-center gap-1.5">
                        <Globe2 size={12} className="opacity-70" />
                        {combinedLabel}
                    </span>
                </SelectItem>
                {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id} className="text-xs">{b.name}</SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
