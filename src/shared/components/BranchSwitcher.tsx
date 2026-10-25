"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
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
import { useBranchOptions } from "@/shared/hooks/useBranchOptions";

type SessionUser = { branchIds?: string[]; permissions?: string[] } | null;

export function BranchSwitcher() {
    const router = useRouter();
    const { activeBranchId, setActiveBranchId, hydrate } = useActiveBranchStore();
    // Both mounts (the office top bar and VoucherTopBar) sit inside the layout's
    // SessionWrapper, so the session is already here — no /api/auth/session read.
    const { data: session } = useSession();
    const user = (session?.user as SessionUser | undefined) ?? null;
    // The active branches from this browser's saved copy (useBranchOptions): no
    // /api/branches read per page — only when the copy is 30 min old or the
    // `settings` topic says a branch was added, renamed or switched off.
    const { branches: active, ready } = useBranchOptions();

    const isAdmin = (user?.permissions ?? []).includes(PERMISSIONS.ADMIN_BYPASS);
    const userBranchIds = user?.branchIds;
    const branches = useMemo(() => {
        if (isAdmin) return active;
        const mine = userBranchIds ?? [];
        return mine.length > 0 ? active.filter((b) => mine.includes(b.id)) : [];
    }, [active, isAdmin, userBranchIds]);

    // Default selection rule: land on the first available branch. The top
    // bar represents the user's *working* branch — reports default to org-
    // wide scope on their own, so we never select a combined sentinel here.
    // hydrate() is a no-op if something is already stored, so persistent
    // selection survives reload.
    useEffect(() => {
        if (user && ready) hydrate(branches[0]?.id ?? null);
    }, [user, ready, branches, hydrate]);

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
