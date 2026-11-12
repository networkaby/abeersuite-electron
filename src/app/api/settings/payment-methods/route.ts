import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PAYMENT_GATEWAY_PROVIDERS } from "@/modules/pos/lib/paymentGateways";
import { credentialStatusFor } from "@/shared/lib/payments/credentialStatus";
import { ensurePaymentMethodCatalog } from "@/shared/lib/payments/paymentMethodCatalog";

// Settings → Payment Methods. A HARD-CODED catalog of payment methods (like the
// courier catalog): fixed in code, not addable/deletable — only their config is
// editable. GET self-heals the catalog so every method is always present.
// Secrets stay in env vars: this route never accepts or returns key/secret values —
// only whether the provider's env vars are present (✓/✗). Any signed-in staff may
// read/write — the Settings sidebar tick decides who reaches the page.

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        // Self-heal the fixed payment-method catalog so it's always present (no seed).
        await ensurePaymentMethodCatalog();
        const rows = await prisma.paymentGateway.findMany({
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            include: { _count: { select: { counterAccounts: true } } },
        });
        const gateways = await Promise.all(rows.map(async (g) => ({
            id: g.id,
            provider: g.provider,
            displayName: g.displayName,
            environment: g.environment,
            enabledForCounter: g.enabledForCounter,
            enabledForOnline: g.enabledForOnline,
            configJson: g.configJson,
            sortOrder: g.sortOrder,
            isActive: g.isActive,
            counterCount: g._count.counterAccounts,
            // Names + booleans only — never the secret values.
            credentialStatus: await credentialStatusFor(
                g.provider,
                g.environment === "LIVE" ? "LIVE" : "TEST",
            ),
        })));
        return NextResponse.json({ gateways, providers: PAYMENT_GATEWAY_PROVIDERS });
    } catch (e) {
        return handleApiError(e, "Failed to load payment methods");
    }
}

// Payment methods are a fixed, code-owned catalog — a new gateway is added by
// extending PAYMENT_METHOD_DEFAULTS in code, never created here.
export async function POST() {
    const { response } = await requireAuth();
    if (response) return response;
    return NextResponse.json(
        { error: "Payment methods are fixed — a new gateway is added in code, not here." },
        { status: 405 },
    );
}
