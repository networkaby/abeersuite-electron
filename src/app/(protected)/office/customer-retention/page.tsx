import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { canOpenPage, NO_ACCESS_HOME, NO_ACCESS_PARAM } from "@/shared/lib/auth/pageAccess";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";

// Customer Retention has no dashboard of its own — like /office/accountancy it
// just lands the user on the first section they can open (its own sidebar tick,
// pageAccess.ts), preferring one they can also edit. Keeps the breadcrumb root href
// (/office/customer-retention) valid.
const SECTIONS: { href: string; perm: string }[] = [
    { href: "/office/customer-retention/coupons", perm: PERMISSIONS.COUPONS_EDIT },
    { href: "/office/customer-retention/gift-cards", perm: PERMISSIONS.GIFT_CARDS_EDIT },
    { href: "/office/customer-retention/loyalty", perm: PERMISSIONS.LOYALTY_EDIT },
    { href: "/office/customer-retention/customer-tiers", perm: PERMISSIONS.TIERS_EDIT },
    { href: "/office/customer-retention/protection", perm: PERMISSIONS.RETENTION_PROTECTION_MANAGE },
];

export default async function CustomerRetentionIndex() {
    const session = await auth();
    const perms = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const open = SECTIONS.filter((s) => canOpenPage(s.href, perms));
    // The ladder: a Delete grant is also Edit.
    const target = open.find((s) => hasPermissionWithScope(perms, s.perm)) ?? open[0];
    redirect(target?.href ?? `${NO_ACCESS_HOME}?${NO_ACCESS_PARAM}=1`);
}
