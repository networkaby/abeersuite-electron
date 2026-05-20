"use client";

import { ArrowLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BranchSwitcher } from "@/shared/components/BranchSwitcher";

interface VoucherTopBarProps {
    title: string;
    onClose: () => void;
    /** Mono reference shown next to title in edit mode. */
    editingRef?: string;
    /** Amber "Posted — edit reposts on save" badge in left nav. */
    postedWarning?: boolean;
    /** Colored status pill (text + tailwind classes supplied by caller). */
    statusBadge?: { label: string; colorClass: string };
    /** Extra nodes after the nav (CASH/CREDIT toggle, New button, etc.). */
    leftExtras?: React.ReactNode;
    /** Right section content (extra per-voucher controls). The shared BranchSwitcher + X close are always appended after this. */
    rightContent?: React.ReactNode;
    /** Make the header sticky (needed when the page scrolls, not a fixed-height container). */
    sticky?: boolean;
}

export function VoucherTopBar({
    title,
    onClose,
    editingRef,
    postedWarning,
    statusBadge,
    leftExtras,
    rightContent,
    sticky,
}: VoucherTopBarProps) {
    return (
        <header className={`flex shrink-0 items-center justify-between gap-4 border-b bg-card px-4 py-2${sticky ? " sticky top-0 z-10" : ""}`}>
            <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} title="Back (Esc)">
                    <ArrowLeft size={15} />
                </Button>
                <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{title}</span>
                    {editingRef && (
                        <span className="font-mono text-xs text-muted-foreground">{editingRef}</span>
                    )}
                    {postedWarning && (
                        <span
                            className="text-[11px] px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 font-medium"
                            title="Saving will reverse this voucher's stock & GL impact and re-post with the new values. Reference number is preserved."
                        >
                            Posted — edit reposts on save
                        </span>
                    )}
                    {statusBadge && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${statusBadge.colorClass}`}>
                            {statusBadge.label}
                        </span>
                    )}
                </nav>
                {leftExtras}
            </div>
            <div className="flex items-center gap-2">
                {rightContent}
                <BranchSwitcher />
                <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} title="Close (Esc)" aria-label="Close">
                    <X size={15} />
                </Button>
            </div>
        </header>
    );
}
