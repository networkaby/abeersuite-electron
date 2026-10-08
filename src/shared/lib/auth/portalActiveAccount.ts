import "server-only";
import { cookies } from "next/headers";
import { PORTAL_ACTIVE_ACCOUNT_COOKIE, resolvePortalAccountContext, type PortalAccountContext } from "@/shared/lib/auth/portalAccountContext";

/**
 * The profile the customer is using right now — the one the "Using …" switch
 * saved in its cookie, else their personal one. Null when they have no profile
 * at all. The portal's bills and repairs pages and the customer app share it.
 */
export async function resolveActivePortalAccount(customerId: number): Promise<PortalAccountContext | null> {
    const raw = Number((await cookies()).get(PORTAL_ACTIVE_ACCOUNT_COOKIE)?.value);
    try {
        return await resolvePortalAccountContext(customerId, Number.isFinite(raw) ? raw : null);
    } catch {
        return null;
    }
}
