import { auth } from "@/auth";
import { NextResponse } from "next/server";

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
