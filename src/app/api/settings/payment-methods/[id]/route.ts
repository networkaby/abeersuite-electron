import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError, pickDefined } from "@/shared/lib/api";
import {
    getGatewayProvider,
    validateGatewayConfigJson,
    PAY_ON_DELIVERY_PROVIDER_ID,
} from "@/modules/pos/lib/paymentGateways";
import { sanitizePodConfig } from "@/shared/lib/payments/payOnDelivery";

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

const patchSchema = z.object({
    displayName: z.string().trim().min(1).max(80).optional(),
    environment: z.enum(["TEST", "LIVE"]).optional(),
    enabledForCounter: z.boolean().optional(),
    enabledForOnline: z.boolean().optional(),
    configJson: z.record(z.string(), z.unknown()).optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    isActive: z.boolean().optional(),
});

type PatchInput = z.infer<typeof patchSchema>;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { id } = paramsSchema.parse(await params);
        const { data, error } = await validateRequest<PatchInput>(req, patchSchema);
        if (error) return error;

        const existing = await prisma.paymentGateway.findUnique({ where: { id } });
        if (!existing) {
            return NextResponse.json({ error: "Payment method not found" }, { status: 404 });
        }
        const provider = getGatewayProvider(existing.provider);
        if (!provider) {
            return NextResponse.json({ error: "Unknown payment provider" }, { status: 400 });
        }

        // Resolve the post-update values to validate against (merge over existing).
        const nextEnabledForOnline = data.enabledForOnline ?? existing.enabledForOnline;
        const nextEnabledForCounter = data.enabledForCounter ?? existing.enabledForCounter;

        const isPod = existing.provider === PAY_ON_DELIVERY_PROVIDER_ID;
        // POD stores an area rule ({ area: {...} }); everything else validates against
        // the provider's declared config fields. The settlement ledger
        // (configJson.settlementAccountId) is common to every method — preserved on
        // top of whichever shape (POD's sanitizer would otherwise drop it).
        let nextConfigJson: Prisma.InputJsonValue | undefined;
        if (data.configJson === undefined) {
            nextConfigJson = undefined;
        } else {
            const base = isPod
                ? (sanitizePodConfig(data.configJson) as Record<string, unknown>)
                : { ...data.configJson };
            const sid = Number((data.configJson as { settlementAccountId?: unknown }).settlementAccountId);
            if (Number.isInteger(sid) && sid > 0) base.settlementAccountId = sid;
            else delete base.settlementAccountId;
            nextConfigJson = base as Prisma.InputJsonValue;
        }
        if (data.configJson !== undefined && !isPod) {
            const configError = validateGatewayConfigJson(existing.provider, data.configJson);
            if (configError) return NextResponse.json({ error: configError }, { status: 400 });
        }
        if (nextEnabledForOnline && !provider.supportsOnline) {
            return NextResponse.json(
                { error: `${provider.label} cannot be used for online checkout` },
                { status: 400 },
            );
        }
        if (nextEnabledForCounter && !provider.supportsCounter) {
            return NextResponse.json(
                { error: `${provider.label} cannot be used at the counter` },
                { status: 400 },
            );
        }

        // Multiple gateways may be enabled for online at once — the storefront offers
        // each as its own pay option, so no "only one online" enforcement here.
        const updated = await prisma.paymentGateway.update({
            where: { id },
            data: pickDefined({
                displayName: data.displayName,
                environment: data.environment,
                enabledForCounter: data.enabledForCounter,
                enabledForOnline: data.enabledForOnline,
                configJson: nextConfigJson,
                sortOrder: data.sortOrder,
                isActive: data.isActive,
            }),
        });
        return NextResponse.json({ gateway: updated });
    } catch (e) {
        return handleApiError(e, "Failed to update payment method");
    }
}

// Payment methods are a fixed, code-owned catalog and can't be deleted — switch a
// method off with the Active toggle instead. (Deleting would also orphan its config,
// e.g. the Pay-on-Delivery area rule or a counter rail pointing at it.)
export async function DELETE() {
    const { response } = await requireAuth();
    if (response) return response;
    return NextResponse.json(
        { error: "Payment methods are fixed and can't be deleted — switch it off with the Active toggle instead." },
        { status: 405 },
    );
}
