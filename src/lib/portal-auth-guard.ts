import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
    PORTAL_ACTIVE_ACCOUNT_COOKIE,
    resolvePortalAccountContext,
    type PortalAccountContext,
} from "@/lib/auth/portal-account-context";

export async function requirePortalCustomer(): Promise<
    | { customerId: number; response: null }
    | { customerId: null; response: NextResponse }
> {
    const session = await auth();
    if (!session?.user) {
        return { customerId: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    }
    const kind = (session.user as { kind?: string }).kind;
    if (kind !== "customer") {
        return { customerId: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }
    const raw = (session.user as { customerId?: string }).customerId;
    const customerId = raw ? parseInt(raw, 10) : NaN;
    if (!Number.isFinite(customerId)) {
        return { customerId: null, response: NextResponse.json({ error: "Invalid session" }, { status: 401 }) };
    }
    return { customerId, response: null };
}

export async function requirePortalAccountContext(): Promise<
    | { context: PortalAccountContext; response: null }
    | { context: null; response: NextResponse }
> {
    const authResult = await requirePortalCustomer();
    if (authResult.response) return { context: null, response: authResult.response };

    const cookieStore = await cookies();
    const rawAccountId = cookieStore.get(PORTAL_ACTIVE_ACCOUNT_COOKIE)?.value;
    const preferredAccountId = rawAccountId ? Number(rawAccountId) : null;

    try {
        const context = await resolvePortalAccountContext(
            authResult.customerId!,
            Number.isFinite(preferredAccountId) ? preferredAccountId : null
        );
        return { context, response: null };
    } catch {
        return {
            context: null,
            response: NextResponse.json({ error: "No account available for portal user" }, { status: 400 }),
        };
    }
}
