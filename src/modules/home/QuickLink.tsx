"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useCanOpenPage } from "@/shared/hooks/useCanOpenPage";

/** One tile on a Home briefing card. Hidden when the page lock (pageAccess.ts) would
 *  refuse this person, so the card offers only pages they can open. */
export function QuickLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
    const canOpen = useCanOpenPage();
    if (!canOpen(href)) return null;
    return (
        <Link
            href={href}
            className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/60 transition-colors"
        >
            {icon}
            <span className="flex-1">{label}</span>
            <ChevronRight size={14} className="text-muted-foreground shrink-0" />
        </Link>
    );
}
