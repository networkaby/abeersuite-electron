"use client";

// "₹3,000 to link" — the mark that saves opening the bill-wise popup to find out
// there was nothing in it.
//
// The number is `PartyOutstanding.toLink`: money this party has on one side that
// a bill on the other side could settle right now. It is NOT the outstanding and
// NOT the ledger balance — a party can be deeply overdue with nothing to link
// (every bill open, no receipt against it), and that party stays unmarked,
// which is the whole point. Where it does show, the popup has real work in it.
//
// Two shapes, one meaning. The full chip carries the amount, for a report row
// that has the width for it. `compact` is a broken chain on its own, for the
// party lists, where the row is already carrying a name, a phone and a balance
// and the amount belongs in the tooltip. Owner: "it may be a Brocken chain or
// any icon" — a chain with a piece missing says "not joined up" without a word.

import { Link2, Unlink2 } from "lucide-react";
import { fmt } from "@/shared/lib/format/moneyInr";
import { cn } from "@/shared/lib/format/utils";

export function ToLinkChip({ toLink, compact = false, className }: {
    toLink: number;
    /** Icon only — the amount moves to the tooltip. For dense list rows. */
    compact?: boolean;
    className?: string;
}) {
    if (toLink <= 0.005) return null;

    const title = `₹${fmt(toLink)} is already received or paid on this party and sits against no bill. Open a bill's Status to place it.`;

    if (compact) {
        return (
            <span
                title={title}
                aria-label={`${fmt(toLink)} to link`}
                className={cn(
                    "shrink-0 text-amber-600 dark:text-amber-400",
                    className,
                )}
            >
                <Unlink2 size={13} />
            </span>
        );
    }

    return (
        <span
            title={title}
            className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium",
                "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
                className,
            )}
        >
            <Link2 size={11} />
            {fmt(toLink)} to link
        </span>
    );
}
