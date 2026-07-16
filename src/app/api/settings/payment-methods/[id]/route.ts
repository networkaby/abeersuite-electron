import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError, pickDefined } from "@/shared/lib/api";
import {
    getGatewayProvider,
    validateGatewayConfigJson,
} from "@/modules/pos/lib/paymentGateways";
import { clearOnlineSiblings } from "@/shared/lib/payments/gatewayMutations";

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
        const nextEnvironment = data.environment ?? existing.environment;
        const nextEnabledForOnline = data.enabledForOnline ?? existing.enabledForOnline;
        const nextEnabledForCounter = data.enabledForCounter ?? existing.enabledForCounter;

        if (data.configJson !== undefined) {
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

        const updated = await prisma.$transaction(async (tx) => {
            const row = await tx.paymentGateway.update({
                where: { id },
                data: pickDefined({
                    displayName: data.displayName,
                    environment: data.environment,
                    enabledForCounter: data.enabledForCounter,
                    enabledForOnline: data.enabledForOnline,
                    configJson: data.configJson as Prisma.InputJsonValue | undefined,
                    sortOrder: data.sortOrder,
                    isActive: data.isActive,
                }),
            });
            if (row.enabledForOnline) {
                await clearOnlineSiblings(tx, nextEnvironment, row.id);
            }
            return row;
        });
        return NextResponse.json({ gateway: updated });
    } catch (e) {
        return handleApiError(e, "Failed to update payment method");
    }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { id } = paramsSchema.parse(await params);
        const existing = await prisma.paymentGateway.findUnique({ where: { id } });
        if (!existing) {
            return NextResponse.json({ error: "Payment method not found" }, { status: 404 });
        }
        // Counter rails referencing this gateway auto-unlink via onDelete: SetNull.
        await prisma.paymentGateway.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete payment method");
    }
}
