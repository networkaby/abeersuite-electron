import type { LucideIcon } from "lucide-react";
import { BookOpen, Coins, FolderTree, Wallet } from "lucide-react";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { canOpenPage } from "@/shared/lib/auth/pageAccess";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";

export type MastersNavLink = {
    label: string;
    href: string;
    icon: LucideIcon;
    /** When omitted, visible to anyone who can open the masters section. */
    permission?: string;
};

const BASE = "/office/accountancy/masters";

export const MASTERS_NAV_LINKS: MastersNavLink[] = [
    { label: "Account Groups", href: `${BASE}/groups`, icon: FolderTree },
    { label: "Ledgers", href: `${BASE}/ledgers`, icon: BookOpen },
    { label: "Chart of accounts", href: `${BASE}/chart-of-accounts`, icon: Wallet },
    {
        label: "Opening Balance",
        href: `${BASE}/opening-balance`,
        icon: Coins,
        permission: PERMISSIONS.ACCOUNTANCY_MASTERS_EDIT,
    },
];

/** The tabs this person may open: the page lock (its own sidebar tick, pageAccess.ts)
 *  plus the tab's own permission, read on the CRUD ladder — a Delete grant is also
 *  Edit. admin:bypass passes both. */
export function filterMastersNav(links: MastersNavLink[], permissions: string[]): MastersNavLink[] {
    return links.filter(
        (link) => canOpenPage(link.href, permissions)
            && (!link.permission || hasPermissionWithScope(permissions, link.permission)),
    );
}
