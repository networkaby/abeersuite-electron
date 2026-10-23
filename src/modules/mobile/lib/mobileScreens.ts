import { BookOpen, Boxes, Camera, HandCoins, MessageSquare, Send, Users, Wallet, type LucideIcon } from "lucide-react";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { requiredVoucherPermission } from "@/shared/lib/auth/voucherMatrix";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PHONE_APP_HOME } from "@/shared/lib/device/phone";

/** Side-menu headings, in the order they are listed. */
export const MOBILE_GROUPS = ["Stock", "Parties", "Messages", "Accounts"] as const;
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
    /** A screen of suppliers only — also needs "Show suppliers (creditors)". */
    suppliers?: true;
};

/**
 * Every phone-app screen, in order — the first ones held become the bottom tabs.
 * This one list drives the Home tiles, the bottom tab bar, the side menu, and the
 * "Mobile App" module on the Role page (its ticks) and Departments page (its chip —
 * see MOBILE_APP_MODULE in sidebarModules.ts), so adding a screen is:
 *   1. its `mobile:*` permission in permissions.ts + permissionCatalog.ts (then
 *      seed:sync-permissions),
 *   2. a row here,
 *   3. its page under src/app/m-staff-app/(app) (guarded by `mobileUser(permission)`)
 *      and, when the phone needs its own shape, its API under src/app/api/mobile
 *      (guarded by `requirePermission(permission)`).
 * Nothing else lists screens.
 */
export const MOBILE_SCREENS: MobileScreen[] = [
    {
        href: `${PHONE_APP_HOME}/stock`,
        group: "Stock",
        tab: "Stock",
        label: "Stock & price",
        hint: "Available qty, sale price",
        icon: Boxes,
        permission: PERMISSIONS.MOBILE_STOCK_VIEW,
    },
    {
        href: `${PHONE_APP_HOME}/parties`,
        group: "Parties",
        tab: "Parties",
        label: "Party",
        hint: "Balance, vouchers, bills",
        icon: Users,
        permission: PERMISSIONS.MOBILE_PARTIES_VIEW,
    },
    {
        href: `${PHONE_APP_HOME}/receivables`,
        group: "Parties",
        tab: "To receive",
        label: "Receivables",
        hint: "Who owes us, by age",
        icon: HandCoins,
        permission: PERMISSIONS.MOBILE_RECEIVABLES_VIEW,
    },
    {
        href: `${PHONE_APP_HOME}/payables`,
        group: "Parties",
        tab: "To pay",
        label: "Payables",
        hint: "Whom we owe, by age",
        icon: Wallet,
        permission: PERMISSIONS.MOBILE_PAYABLES_VIEW,
        suppliers: true,
    },
    {
        href: `${PHONE_APP_HOME}/inbox`,
        group: "Messages",
        tab: "Inbox",
        label: "Inbox",
        hint: "Customer WhatsApp chats",
        icon: MessageSquare,
        permission: PERMISSIONS.MOBILE_INBOX_VIEW,
    },
    {
        href: `${PHONE_APP_HOME}/daybook`,
        group: "Accounts",
        tab: "Day Book",
        label: "Day Book",
        hint: "Every voucher of a day",
        icon: BookOpen,
        permission: PERMISSIONS.MOBILE_DAYBOOK_VIEW,
    },
    // Last on purpose: the first screens held become the bottom tabs, and a photo
    // tick must not push a party screen off them.
    {
        href: `${PHONE_APP_HOME}/photos`,
        group: "Stock",
        tab: "Photos",
        label: "Photos",
        hint: "Shop photos from camera",
        icon: Camera,
        permission: PERMISSIONS.MOBILE_PHOTOS_EDIT,
    },
    // After Photos, for the same reason: sharing posts is a few staff's job, not a
    // reason to move a money screen off the bottom bar.
    {
        href: `${PHONE_APP_HOME}/posts`,
        group: "Messages",
        tab: "Posts",
        label: "Posts",
        hint: "Share to WhatsApp Channel / Status",
        icon: Send,
        permission: PERMISSIONS.MOBILE_POSTS_SHARE,
    },
];

/** Bottom-bar room after Home — four tabs in all. Every screen is in the side menu
 *  and on Home, so the bar never has to grow as the app does. */
export const MAX_SCREEN_TABS = 3;

/** "Show suppliers (creditors)" — the office tick that hides Sundry Creditors and
 *  purchase-side vouchers from Contacts, party pickers and SL Search. The phone app
 *  hides them the same way (party list, Quick Pay, Payables, party screen, Day Book). */
export function seesSuppliers(permissions: readonly string[]): boolean {
    return hasPermissionWithScope([...permissions], PERMISSIONS.CUSTOMERS_VIEW_CREDITORS);
}

export function holdsScreen(permissions: readonly string[], screen: MobileScreen): boolean {
    if (screen.suppliers && !seesSuppliers(permissions)) return false;
    if (screen.permission === PERMISSIONS.MOBILE_INBOX_VIEW) {
        if (
            permissions.includes(PERMISSIONS.MOBILE_INBOX_VIEW) ||
            permissions.includes(PERMISSIONS.MESSAGES_REPLY) ||
            permissions.includes("ui:sidebar:crm:messages") ||
            permissions.includes(PERMISSIONS.ADMIN_BYPASS)
        ) {
            return true;
        }
    }
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

/** Any one of these opens a party's bills (and so the Pay / Receive forms, which
 *  read them) — party search, receivables or payables. */
export const PARTY_TICKS = [
    PERMISSIONS.MOBILE_PARTIES_VIEW,
    PERMISSIONS.MOBILE_RECEIVABLES_VIEW,
    PERMISSIONS.MOBILE_PAYABLES_VIEW,
] as const;

/**
 * Who sees quick Receive / Pay (the + button, the Home tiles): the Role page's
 * Receipt / Payment CREATE and POST ticks — the two the voucher API itself checks
 * — plus a party tick, since the forms read the party's bills. Read through the
 * CRUD ladder (`hasPermissionWithScope`): a session carries only the highest rung.
 */
export function quickEntryFor(permissions: string[]): { pay: boolean; receive: boolean } {
    const can = (type: string) => (["create", "post"] as const).every((action) => {
        const id = requiredVoucherPermission(type, action);
        return id != null && hasPermissionWithScope(permissions, id);
    });
    const party = PARTY_TICKS.some((t) => permissions.includes(t)) || permissions.includes(PERMISSIONS.ADMIN_BYPASS);
    return { pay: party && can("PAYMENT"), receive: party && can("RECEIPT") };
}
