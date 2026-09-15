"use client";

// Uniform "breadcrumb bar" wrapper — card strip with bottom border. Used by
// every page-level breadcrumb (PathBreadcrumb, MastersBreadcrumb, and the
// inline breadcrumbs on inventory-details / stock-summary /
// AccountLedgerExplorer / the customer explorers) so the style lives in one
// place.
//
// Owns its own padding (`px-6 py-2.5`) and bottom margin (`mb-4`). `<main>`
// no longer pads its children, so no negative-margin "escape" is needed —
// callers drop the bar wherever they want it.
//
// It also carries the active module's hue: a faint wash plus a hue line along
// the bottom edge. That is the same navigation-not-decoration rule the sidebar
// and ModuleSurface follow — you land on a page and the colour says which
// module you are in before you read a word — and putting it here means every
// office page gets it from one file. Pages outside any module (login-adjacent
// shells, one-off tools) get the plain strip: no hue is more honest than a
// wrong hue.

import { usePathname } from "next/navigation";
import { getActiveModuleKey } from "@/utils/active-module";
import { moduleColor, moduleTint } from "@/shared/lib/format/moduleTheme";
import { cn } from "@/shared/lib/format/utils";

export interface BreadcrumbBarProps {
    children: React.ReactNode;
    className?: string;
}

export function BreadcrumbBar({ children, className }: BreadcrumbBarProps) {
    const moduleKey = getActiveModuleKey(usePathname());

    return (
        <div
            className={cn(
                "shrink-0 border-b border-border-strong bg-surface-raised px-6 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
                className,
            )}
            // The wash is mixed into --surface-raised, not the page canvas: this
            // strip IS a raised surface, and tinting against the canvas would
            // leave it darker than the card it sits on. The hue line is carried
            // in the same box-shadow as the strip's own drop shadow, since an
            // inline style replaces the class's shadow outright.
            style={moduleKey ? {
                backgroundColor: moduleTint(moduleKey, 9, "var(--surface-raised)"),
                boxShadow: `inset 0 -2px 0 ${moduleColor(moduleKey)}, 0 1px 2px rgba(0,0,0,0.04)`,
            } : undefined}
        >
            {children}
        </div>
    );
}
