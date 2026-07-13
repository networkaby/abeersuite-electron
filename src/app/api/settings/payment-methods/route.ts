import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import {
    PAYMENT_GATEWAY_PROVIDERS,
    GATEWAY_PROVIDER_IDS,
    getGatewayProvider,
    validateGatewayConfigJson,
} from "@/modules/pos/lib/paymentGateways";
import { credentialStatusFor } from "@/shared/lib/payments/credentialStatus";
import { clearOnlineSiblings } from "@/shared/lib/payments/gatewayMutations";

// Settings → Payment Methods. The global catalog of configured payment gateways /
// methods. Secrets stay in env vars: this route never accepts or returns key/secret
// values — only whether the provider's env vars are present (✓/✗). Gated by
// settings:manage (every heavy global-config settings page uses it).

const environmentSchema = z.enum(["TEST", "LIVE"]);

const createSchema = z.object({
    provider: z.string().refine((p) => GATEWAY_PROVIDER_IDS.includes(p), "Unknown payment provider"),
    displayName: z.string().trim().min(1, "Display name is required").max(80),
    environment: environmentSchema.default("TEST"),
    enabledForCounter: z.boolean().default(true),
    enabledForOnline: z.boolean().default(false),
    configJson: z.record(z.string(), z.unknown()).default({}),
    sortOrder: z.number().int().min(0).max(9999).default(0),
    isActive: z.boolean().default(true),
});

type CreateInput = z.infer<typeof createSchema>;

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const rows = await prisma.paymentGateway.findMany({
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            include: { _count: { select: { counterAccounts: true } } },
        });
        const gateways = rows.map((g) => ({
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
            credentialStatus: credentialStatusFor(
                g.provider,
                g.environment === "LIVE" ? "LIVE" : "TEST",
            ),
        }));
        return NextResponse.json({ gateways, providers: PAYMENT_GATEWAY_PROVIDERS });
    } catch (e) {
        return handleApiError(e, "Failed to load payment methods");
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;
    const { data, error } = await validateRequest<CreateInput>(req, createSchema);
    if (error) return error;
    const provider = getGatewayProvider(data.provider)!; // refined above

    const configError = validateGatewayConfigJson(data.provider, data.configJson);
    if (configError) {
        return NextResponse.json({ error: configError }, { status: 400 });
    }
    if (data.enabledForOnline && !provider.supportsOnline) {
        return NextResponse.json(
            { error: `${provider.label} cannot be used for online checkout` },
            { status: 400 },
        );
    }
    if (data.enabledForCounter && !provider.supportsCounter) {
        return NextResponse.json(
            { error: `${provider.label} cannot be used at the counter` },
            { status: 400 },
        );
    }

    try {
        const created = await prisma.$transaction(async (tx) => {
            const row = await tx.paymentGateway.create({
                data: {
                    provider: data.provider,
                    displayName: data.displayName,
                    environment: data.environment,
                    enabledForCounter: data.enabledForCounter,
                    enabledForOnline: data.enabledForOnline,
                    configJson: data.configJson as Prisma.InputJsonValue,
                    sortOrder: data.sortOrder,
                    isActive: data.isActive,
                },
            });
            if (row.enabledForOnline) {
                await clearOnlineSiblings(tx, row.environment, row.id);
            }
            return row;
        });
        return NextResponse.json({ gateway: created }, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create payment method");
    }
}
