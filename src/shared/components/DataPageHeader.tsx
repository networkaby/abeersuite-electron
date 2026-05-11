import type { ReactNode } from "react";

/**
 * Standard heading block for staff list / detail pages: title, optional subtitle,
 * optional leading icon, and a right-aligned actions slot. Replaces ~15 inline
 * `<div className="flex items-center justify-between">…<h1>…<p>…<Button>` blocks
 * across the office routes.
 */
export function DataPageHeader({
    title,
    subtitle,
    icon,
    actions,
}: {
    title: string;
    subtitle?: string;
    icon?: ReactNode;
    actions?: ReactNode;
}) {
    return (
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div className="min-w-0 flex items-start gap-3">
                {icon ? <div className="shrink-0 text-muted-foreground mt-1">{icon}</div> : null}
                <div className="min-w-0">
                    <h1 className="text-xl font-semibold tracking-tight truncate">{title}</h1>
                    {subtitle ? (
                        <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
                    ) : null}
                </div>
            </div>
            {actions ? <div className="flex items-center gap-2 shrink-0">{actions}</div> : null}
        </div>
    );
}
