import { Heart, LayoutDashboard, Percent, Receipt, ShoppingBag, Ticket, UserRound, Users, Wallet } from "lucide-react";

/** Every portal screen — the portal sidebar and the customer app's Account tab
 *  both list from here, so a new screen shows up in both. */
export const PORTAL_NAV_ITEMS = [
    { href: "/portal", label: "Dashboard", icon: LayoutDashboard },
    { href: "/portal/orders", label: "My Orders", icon: ShoppingBag },
    { href: "/portal/bills", label: "My Bills", icon: Receipt },
    { href: "/portal/repairs", label: "My Repairs", icon: Ticket },
    { href: "/portal/social", label: "Social", icon: Users },
    { href: "/portal/coupons", label: "My Coupons", icon: Percent },
    { href: "/portal/wallet", label: "My Wallet", icon: Wallet },
    { href: "/portal/wishlist", label: "Wishlist", icon: Heart },
    { href: "/portal/profile", label: "My Profile", icon: UserRound },
] as const;
