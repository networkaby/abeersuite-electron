import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import {
    isVoucherTemplateKind,
    buildVoucherTemplateDefaults,
} from "@/shared/lib/print/voucherTemplateDefaults";

type RouteCtx = { params: Promise<{ kind: string }> };

// POST /api/settings/voucher-templates/[kind]/reset
// Restores the row to the canonical bootstrap defaults.
export async function POST(_req: NextRequest, { params }: RouteCtx) {
    const { user, response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;

    const { kind } = await params;
    if (!isVoucherTemplateKind(kind)) {
        return NextResponse.json({ error: "Unknown voucher kind" }, { status: 404 });
    }

    const defaults = buildVoucherTemplateDefaults(kind);
    const template = await prisma.voucherPrintTemplate.upsert({
        where:  { kind },
        create: { ...defaults, updatedById: user.id || null },
        update: { ...defaults, updatedById: user.id || null },
    });
    return NextResponse.json(template);
}
