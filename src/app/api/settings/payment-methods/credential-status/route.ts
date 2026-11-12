import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PAYMENT_GATEWAY_PROVIDERS } from "@/modules/pos/lib/paymentGateways";
import {
    credentialStatusFor,
    credentialStatusForAll,
} from "@/shared/lib/payments/credentialStatus";

// Reports whether each provider's required env vars are present — names + booleans
// only, NEVER the secret values. Lets the Settings form re-poll when the operator
// changes the provider/environment. Open to any signed-in staff (requireAuth).

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const url = new URL(req.url);
        const provider = url.searchParams.get("provider");
        const envParam = url.searchParams.get("environment");
        const environment = envParam === "LIVE" ? "LIVE" : "TEST";

        if (provider) {
            return NextResponse.json({ status: await credentialStatusFor(provider, environment) });
        }
        return NextResponse.json({ statuses: await credentialStatusForAll(PAYMENT_GATEWAY_PROVIDERS) });
    } catch (e) {
        return handleApiError(e, "Failed to read credential status");
    }
}
