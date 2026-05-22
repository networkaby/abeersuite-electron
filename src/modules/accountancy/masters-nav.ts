import type { LucideIcon } from "lucide-react";
import { BookOpen, Coins, FolderTree, Wallet } from "lucide-react";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

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
    { label: "Chart of Accounts", href: `${BASE}/chart-of-accounts`, icon: Wallet },
    {
        label: "Opening Balance",
        href: `${BASE}/opening-balance`,
        icon: Coins,
        permission: PERMISSIONS.FINANCE_OPENING_BALANCE_MANAGE,
    },
];

export function filterMastersNav(links: MastersNavLink[], permissions: string[]): MastersNavLink[] {
    const isAdmin = permissions.includes(PERMISSIONS.ADMIN_BYPASS);
    return links.filter(
        (link) => isAdmin || !link.permission || permissions.includes(link.permission),
    );
}
