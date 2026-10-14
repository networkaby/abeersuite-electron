"use client";

// The tab strip on a module's detail pane. Persons, Companies and both panes of
// All Customers each carried their own copy of this map; they now share one.
//
// The open tab is a tinted pill in the module hue with a hue underline (see
// moduleTabStyle) rather than a solid dark block, so it reads as selected
// without outweighing the table underneath it.

import { moduleTabStyle } from "@/shared/lib/format/moduleTheme";
import { cn } from "@/shared/lib/format/utils";
import { Button } from "@/components/ui/button";

export function ModuleTabs<T extends string>({ module, tabs, active, onChange, labels, className }: {
    /** Module key from constants/nav.ts — decides the hue. */
    module: string;
    tabs: readonly T[];
    active: T;
    onChange: (tab: T) => void;
    /** Words for a tab whose key is not what it should read as. */
    labels?: Partial<Record<T, string>>;
    className?: string;
}) {
    return (
        <div className={cn("border-b bg-card px-6", className)}>
            {/* Wrapping rather than overflowing: nine tabs at a laptop width used
                to run off the right edge and the last one was simply unreachable. */}
            <div className="flex flex-wrap gap-2 py-2">
                {tabs.map((item) => (
                    <Button
                        key={item}
                        type="button"
                        size="sm"
                        variant="ghost"
                        // Callers keep their lowercase tab keys; the strip presents them.
                        className="capitalize"
                        style={moduleTabStyle(module, active === item)}
                        onClick={() => onChange(item)}
                    >
                        {labels?.[item] ?? item}
                    </Button>
                ))}
            </div>
        </div>
    );
}
