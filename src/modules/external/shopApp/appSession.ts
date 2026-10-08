import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { appLoginPath } from "@/modules/external/shopApp/appPaths";

/**
 * The signed-in customer's id for an app screen that needs one (orders, bills…);
 * anyone else is sent to sign in and brought back to `back`.
 */
export async function requireAppCustomer(back: string): Promise<number> {
    const session = await auth();
    const user = session?.user as { kind?: string; id?: string | number } | undefined;
    const customerId = Number(user?.id);
    if (user?.kind !== "customer" || !Number.isFinite(customerId)) redirect(appLoginPath(back));
    return customerId;
}
