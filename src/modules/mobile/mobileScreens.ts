import { BookOpen, Boxes, HandCoins, Users, Wallet, type LucideIcon } from "lucide-react";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

/** Side-menu headings, in the order they are listed. */
export const MOBILE_GROUPS = ["Stock", "Parties", "Accounts"] as const;
export type MobileGroup = (typeof MOBILE_GROUPS)[number];

export type MobileScreen = {
    href: string;
    /** Side-menu heading the screen sits under. */
    group: MobileGroup;
    /** Tab label — short, it sits under an icon in the bottom bar. */
    tab: string;
    /** Home tile / side-menu title and hint; `label` is also the tick's name on the Role page. */
    label: string;
    hint: string;
    icon: LucideIcon;
    /** The `mobile:*` tick that opens it — page, API, tile, tab and menu all read this one. */
    permission: string;
    /** What the tick allows, for the Role page's Global section. */
    roleDescription: string;
};

/**
 * Every phone-app screen, in order — the first ones held become the bottom tabs.
 * This one list drives the Home tiles, the bottom tab bar, the side menu and the
 * Role page's ticks, so adding a screen is:
 *   1. its `mobile:*` permission in permissions.ts + permissionCatalog.ts (then
 *      seed:sync-permissions),
 *   2. a row here,
 *   3. its page under src/app/m (guarded by `mobileUser(permission)`) and, when the
 *      phone needs its own shape, its API under src/app/api/mobile (guarded by
 *      `requirePermission(permission)`).
 * Nothing else lists screens.
 */
export const MOBILE_SCREENS: MobileScreen[] = [
    {
        href: "/m/stock",
        group: "Stock",
        tab: "Stock",
        label: "Stock & price",
        hint: "Available qty, sale price",
        icon: Boxes,
        permission: PERMISSIONS.MOBILE_STOCK_VIEW,
        roleDescription: "Phone app: search products, see available quantity per branch and sale price.",
    },
    {
        href: "/m/parties",
        group: "Parties",
        tab: "Parties",
        label: "Party balance",
        hint: "Balance, unpaid bills",
        icon: Users,
        permission: PERMISSIONS.MOBILE_PARTIES_VIEW,
        roleDescription: "Phone app: search parties, see balance and unpaid bills.",
    },
    {
        href: "/m/receivables",
        group: "Parties",
        tab: "To receive",
        label: "Receivables",
        hint: "Who owes us, by age",
        icon: HandCoins,
        permission: PERMISSIONS.MOBILE_RECEIVABLES_VIEW,
        roleDescription: "Phone app: who owes us — total, age, and each party's unpaid bills.",
    },
    {
        href: "/m/payables",
        group: "Parties",
        tab: "To pay",
        label: "Payables",
        hint: "Whom we owe, by age",
        icon: Wallet,
        permission: PERMISSIONS.MOBILE_PAYABLES_VIEW,
        roleDescription: "Phone app: whom we owe — total, age, and each supplier's unpaid bills.",
    },
    {
        href: "/m/daybook",
        group: "Accounts",
        tab: "Day Book",
        label: "Day Book",
        hint: "Every voucher of a day",
        icon: BookOpen,
        permission: PERMISSIONS.MOBILE_DAYBOOK_VIEW,
        roleDescription: "Phone app: every voucher of a chosen day.",
    },
];

/** Bottom-bar room after Home — four tabs in all. Every screen is in the side menu
 *  and on Home, so the bar never has to grow as the app does. */
export const MAX_SCREEN_TABS = 3;

export function holdsScreen(permissions: readonly string[], screen: MobileScreen): boolean {
    return permissions.includes(screen.permission) || permissions.includes(PERMISSIONS.ADMIN_BYPASS);
}

/** The screens this person may open, in order. */
export function screensFor(permissions: readonly string[]): MobileScreen[] {
    return MOBILE_SCREENS.filter((s) => holdsScreen(permissions, s));
}

/** Is `pathname` this screen or one of its detail pages? */
export function isOnScreen(pathname: string, href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`);
}
