import { Boxes, Users, type LucideIcon } from "lucide-react";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

export type MobileScreen = {
    href: string;
    /** Tab label — short, it sits under an icon in the bottom bar. */
    tab: string;
    /** Home tile title and hint; `label` is also the tick's name on the Role page. */
    label: string;
    hint: string;
    icon: LucideIcon;
    /** The `mobile:*` tick that opens it — page, API and tab all read this one. */
    permission: string;
    /** What the tick allows, for the Role page's Global section. */
    roleDescription: string;
};

/**
 * Every phone-app screen, in tab order. This one list drives the Home tiles, the
 * bottom tab bar and the Role page's ticks, so adding a screen is:
 *   1. its `mobile:*` permission in permissions.ts + permissionCatalog.ts (then
 *      seed:sync-permissions),
 *   2. a row here,
 *   3. its page under src/app/m (guarded by `mobileUser(permission)`) and its API
 *      under src/app/api/mobile (guarded by `requirePermission(permission)`).
 * Nothing else lists screens.
 */
export const MOBILE_SCREENS: MobileScreen[] = [
    {
        href: "/m/stock",
        tab: "Stock",
        label: "Stock & price",
        hint: "Available qty, sale price",
        icon: Boxes,
        permission: PERMISSIONS.MOBILE_STOCK_VIEW,
        roleDescription: "Phone app: search products, see available quantity per branch and sale price.",
    },
    {
        href: "/m/parties",
        tab: "Parties",
        label: "Party balance",
        hint: "Balance, unpaid bills",
        icon: Users,
        permission: PERMISSIONS.MOBILE_PARTIES_VIEW,
        roleDescription: "Phone app: search parties, see balance and unpaid bills.",
    },
];

/** Bottom-bar room after Home — five items in all, the Android norm. Screens past
 *  this are still on the Home grid, so the bar never overflows as the app grows. */
export const MAX_SCREEN_TABS = 4;

export function holdsScreen(permissions: readonly string[], screen: MobileScreen): boolean {
    return permissions.includes(screen.permission) || permissions.includes(PERMISSIONS.ADMIN_BYPASS);
}

/** The screens this person may open, in tab order. */
export function screensFor(permissions: readonly string[]): MobileScreen[] {
    return MOBILE_SCREENS.filter((s) => holdsScreen(permissions, s));
}
