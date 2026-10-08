import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { APP, appLoginPath } from "@/modules/external/shopApp/appPaths";
import { resolveActivePortalAccount } from "@/shared/lib/auth/portalActiveAccount";

/**
 * The signed-in customer's id for an app screen that needs one (orders, bills…);
 * anyone else is sent to sign in and brought back to `back`.
 */
export async function requireAppCustomer(back: string): Promise<number> {
    const session = await auth();
    // Same field the portal's API guard reads (portalAuthGuard.ts).
    const user = session?.user as { kind?: string; customerId?: string } | undefined;
    const customerId = Number.parseInt(user?.customerId ?? "", 10);
    if (user?.kind !== "customer" || !Number.isFinite(customerId)) redirect(appLoginPath(back));
    return customerId;
}

/**
 * The customer and the profile they are using ("Using …" — the portal's cookie),
 * for screens that show one profile at a time (bills, repairs). A customer with
 * no profile at all goes back to Account.
 */
export async function requireAppCustomerProfile(back: string) {
    const customerId = await requireAppCustomer(back);
    const context = await resolveActivePortalAccount(customerId);
    if (!context) redirect(`${APP}/account`);
    return context; // carries customerId, options and the active profile
}
