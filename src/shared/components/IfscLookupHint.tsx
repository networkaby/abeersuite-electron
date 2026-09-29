"use client";

// The line under an IFSC box saying which bank and branch the code belongs to,
// from useIfscLookup. When the form's Bank Name / Branch say something else — a
// saved record, or a value staff typed over the lookup — a Use button takes
// RBI's version; leaving it alone keeps the manual one. Nothing blocks a save:
// a code missing from the list may simply be a branch newer than the list.

import { Loader2, BadgeCheck } from "lucide-react";
import { cn } from "@/shared/lib/format/utils";
import type { IfscLookupState } from "@/shared/hooks/useIfscLookup";

export function IfscLookupHint({ state, onUse, canUse = true, className }: {
    state: IfscLookupState;
    onUse: () => void;
    /** False on a read-only form — the hint still shows, the button does not. */
    canUse?: boolean;
    className?: string;
}) {
    switch (state.status) {
        case "idle":
            return null;
        case "loading":
            return (
                <p className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
                    <Loader2 size={12} className="animate-spin" /> Looking up the IFSC…
                </p>
            );
        case "notFound":
            return (
                <p className={cn("text-xs text-amber-700 dark:text-amber-400", className)}>
                    This IFSC is not in RBI&apos;s list — please check the code. Fill Bank Name and Branch by hand.
                </p>
            );
        case "failed":
            return (
                <p className={cn("text-xs text-muted-foreground", className)}>
                    Could not look up the IFSC right now — fill Bank Name and Branch by hand.
                </p>
            );
        case "found": {
            const d = state.details;
            const place = [d.district, d.state].filter(Boolean).join(", ");
            return (
                <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-xs", className)}>
                    <span className="flex min-w-0 items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                        <BadgeCheck size={13} className="shrink-0" />
                        <span className="min-w-0">
                            {d.bank}{d.branch && <> · {d.branch}</>}{place && <span className="text-muted-foreground"> — {place}</span>}
                        </span>
                    </span>
                    {state.differs && canUse && (
                        <button
                            type="button"
                            className="font-medium text-primary underline-offset-2 hover:underline"
                            title="Replace Bank Name and Branch with these"
                            onClick={onUse}
                        >
                            Use
                        </button>
                    )}
                </div>
            );
        }
    }
}
