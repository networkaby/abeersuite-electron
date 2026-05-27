"use client";

import * as React from "react";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/shared/lib/format/utils";

type Props = React.ComponentProps<typeof ScrollArea> & {
    /** Extra classes appended to the default frame (border, rounded, bg). */
    className?: string;
};

/**
 * Table-level scroll container used across data pages: a vertically + horizontally
 * scrollable frame that fills the parent's remaining height. Pair with a parent
 * that is `flex flex-col` and has a known height (e.g. `h-full`).
 *
 * Renders a horizontal ScrollBar at the bottom so wide tables stay reachable
 * without the page itself scrolling.
 */
export function TableScrollArea({ className, children, type = "always", ...rest }: Props) {
    return (
        <ScrollArea
            type={type}
            className={cn(
                "min-h-0 flex-1 rounded-sm border border-border bg-card",
                className,
            )}
            {...rest}
        >
            {children}
            <ScrollBar orientation="horizontal" />
        </ScrollArea>
    );
}
