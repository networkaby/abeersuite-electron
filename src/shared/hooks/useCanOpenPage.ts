"use client";

import { useSession } from "next-auth/react";
import { canOpenPage } from "@/shared/lib/auth/pageAccess";

/**
 * For screens that list pages as cards or tabs (hubs, tab strips, the Home cards):
 * true when this person may open `href` under the page lock (pageAccess.ts), so a
 * card for a locked page is simply not shown. The session is primed by the office
 * layout, so this answers on the first render — no flicker. With no session yet it
 * answers true and leaves the page lock itself to refuse.
 */
export function useCanOpenPage(): (href: string) => boolean {
    const { data } = useSession();
    const permissions = (data?.user as { permissions?: string[] } | undefined)?.permissions;
    return (href) => !permissions || canOpenPage(href, permissions);
}
