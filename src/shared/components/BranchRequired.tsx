"use client";

import { Building2 } from "lucide-react";
import { useActiveBranchStore, isCombined } from "@/store/activeBranchStore";

interface BranchRequiredProps {
    /** What the user is trying to do — appears in the message, e.g. "post this sale". */
    action?: string;
    children: React.ReactNode;
}

/**
 * Gate operational form pages on a concrete working branch. When the user is
 * in "My branches" combined mode or has no branch selected at all, render an
 * inline notice instead of the form. The topbar's BranchSwitcher is the one
 * place the user changes scope, so we just point them there.
 *
 * Use on Sale / Purchase / Receipt / Payment / Branch Transfer / POS forms.
 * Reports must NOT use this — they're expected to operate in combined mode.
 *
 * Registered in docs/reusables.md.
 */
export function BranchRequired({ action = "post this transaction", children }: BranchRequiredProps) {
    const activeBranchId = useActiveBranchStore((s) => s.activeBranchId);

    if (!activeBranchId) {
        return (
            <NoBranchNotice
                title="Select a working branch"
                message={`Pick a branch from the top bar before you can ${action}.`}
            />
        );
    }

    if (isCombined(activeBranchId)) {
        return (
            <NoBranchNotice
                title="Switch to a specific branch"
                message={`You're in "My branches" view. Pick a single branch from the top bar to ${action}.`}
            />
        );
    }

    return <>{children}</>;
}

function NoBranchNotice({ title, message }: { title: string; message: string }) {
    return (
        <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-3 py-20 text-center">
            <Building2 size={36} className="text-muted-foreground opacity-40" />
            <p className="text-base font-medium text-foreground">{title}</p>
            <p className="text-sm text-muted-foreground">{message}</p>
        </div>
    );
}
