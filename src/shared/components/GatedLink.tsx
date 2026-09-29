"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { useCanOpenPage } from "@/shared/hooks/useCanOpenPage";

type Props = ComponentProps<typeof Link> & {
    href: string;
    /** What stands in for the link when this person cannot open the page:
     *  "text" keeps the words as plain text (a link inside a sentence), "hide"
     *  drops it (a button-like link). Default "hide". */
    whenLocked?: "text" | "hide";
    /** Class for the plain-text stand-in — the link's own class usually carries
     *  link colours and underlines that would promise a click. */
    textClassName?: string;
    children: ReactNode;
};

/**
 * A link from one screen to an office page, which gives way when the page lock
 * (pageAccess.ts) would refuse this person — a click that can only end on "no
 * access" is not offered. The desktop app has no address bar, so a link like this
 * is the only road a cashier has to another page.
 */
export function GatedLink({ whenLocked = "hide", textClassName, children, ...link }: Props) {
    const canOpen = useCanOpenPage();
    if (canOpen(link.href)) return <Link {...link}>{children}</Link>;
    return whenLocked === "text" ? <span className={textClassName}>{children}</span> : null;
}
