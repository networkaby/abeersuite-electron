import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import {
    VOUCHER_TEMPLATE_KINDS,
    buildVoucherTemplateDefaults,
} from "@/shared/lib/print/voucherTemplateDefaults";

// GET /api/settings/voucher-templates
// Returns every template row. Defensively upserts any missing rows so the UI
// can always render all 21 tabs even if the seed wasn't re-run after a kind
// was added to the enum.
export async function GET() {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;

    const existing = await prisma.voucherPrintTemplate.findMany();
    const have = new Set(existing.map((r) => r.kind));
    const missing = VOUCHER_TEMPLATE_KINDS.filter((k) => !have.has(k));
    if (missing.length > 0) {
        await prisma.voucherPrintTemplate.createMany({
            data:           missing.map((kind) => buildVoucherTemplateDefaults(kind)),
            skipDuplicates: true,
        });
    }

    const templates = missing.length === 0
        ? existing
        : await prisma.voucherPrintTemplate.findMany();

    return NextResponse.json({ templates });
}
