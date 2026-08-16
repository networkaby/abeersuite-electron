import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// Customer Retention has no dashboard of its own — like /office/accountancy it
// just lands the user on the first section they can access. Permission-aware so
// a user with only loyalty (or only tiers) rights isn't bounced off the Coupons
// gate. Keeps the breadcrumb root href (/office/customer-retention) valid.
const SECTIONS: { href: string; perm: string }[] = [
    { href: "/office/customer-retention/coupons", perm: PERMISSIONS.COUPONS_EDIT },
    { href: "/office/customer-retention/gift-cards", perm: PERMISSIONS.GIFT_CARDS_EDIT },
    { href: "/office/customer-retention/loyalty", perm: PERMISSIONS.LOYALTY_EDIT },
    { href: "/office/customer-retention/customer-tiers", perm: PERMISSIONS.CUSTOMERS_EDIT },
    { href: "/office/customer-retention/protection", perm: PERMISSIONS.RETENTION_PROTECTION_MANAGE },
];

export default async function CustomerRetentionIndex() {
    const session = await auth();
    const perms = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const bypass = perms.includes(PERMISSIONS.ADMIN_BYPASS);
    // Prefer a section the user can edit; otherwise land on the first section
    // read-only rather than bouncing them out of Retention entirely.
    const target = SECTIONS.find((s) => bypass || perms.includes(s.perm));
    redirect(target?.href ?? SECTIONS[0].href);
}
