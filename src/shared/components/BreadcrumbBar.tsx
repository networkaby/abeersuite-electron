"use client";

// Uniform "breadcrumb bar" wrapper — full-bleed card strip with bottom
// border. Used by every page-level breadcrumb (PathBreadcrumb,
// MastersBreadcrumb, and the inline breadcrumbs on inventory-details /
// stock-summary / AccountLedgerExplorer) so the style lives in one place.
//
// `escape` (default true) applies -mx-8 -mt-8 to break out of the office
// layout's p-8 main padding so the bar hugs the viewport edges. Pass
// `escape={false}` when the caller already sits inside an outer escape
// (e.g. inventory-details / AccountLedgerExplorer wrap their content in
// a -m-8 div for full-bleed master-detail layout).

import { cn } from "@/shared/lib/format/utils";

export interface BreadcrumbBarProps {
    children: React.ReactNode;
    /** Apply negative margins to escape the office layout's p-8. Default true. */
    escape?: boolean;
    className?: string;
}

export function BreadcrumbBar({ children, escape = true, className }: BreadcrumbBarProps) {
    return (
        <div className={cn(
            "shrink-0 border-b bg-card px-8 py-2.5",
            escape && "-mx-8 -mt-8 mb-4",
            className,
        )}>
            {children}
        </div>
    );
}
