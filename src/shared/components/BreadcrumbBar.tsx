"use client";

// Uniform "breadcrumb bar" wrapper — card strip with bottom border. Used by
// every page-level breadcrumb (PathBreadcrumb, MastersBreadcrumb, and the
// inline breadcrumbs on inventory-details / stock-summary /
// AccountLedgerExplorer) so the style lives in one place.
//
// Owns its own padding (`px-6 py-2.5`) and bottom margin (`mb-4`). `<main>`
// no longer pads its children, so no negative-margin "escape" is needed —
// callers drop the bar wherever they want it.

import { cn } from "@/shared/lib/format/utils";

export interface BreadcrumbBarProps {
    children: React.ReactNode;
    className?: string;
}

export function BreadcrumbBar({ children, className }: BreadcrumbBarProps) {
    return (
        <div className={cn(
            "shrink-0 border-b border-border-strong bg-surface-raised px-6 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
            className,
        )}>
            {children}
        </div>
    );
}
