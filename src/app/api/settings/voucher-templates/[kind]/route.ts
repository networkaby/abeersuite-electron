import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { voucherTemplateUpdateSchema } from "@/shared/lib/schemas/voucherTemplateSchemas";
import {
    isVoucherTemplateKind,
    buildVoucherTemplateDefaults,
} from "@/shared/lib/print/voucherTemplateDefaults";

type RouteCtx = { params: Promise<{ kind: string }> };

// GET /api/settings/voucher-templates/[kind]
export async function GET(_req: NextRequest, { params }: RouteCtx) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;

    const { kind } = await params;
    if (!isVoucherTemplateKind(kind)) {
        return NextResponse.json({ error: "Unknown voucher kind" }, { status: 404 });
    }

    // Auto-upsert with defaults so a freshly-added kind still returns a row
    // even before the next seed run.
    const template = await prisma.voucherPrintTemplate.upsert({
        where:  { kind },
        create: buildVoucherTemplateDefaults(kind),
        update: {},
    });
    return NextResponse.json(template);
}

// PUT /api/settings/voucher-templates/[kind] — partial update.
export async function PUT(req: NextRequest, { params }: RouteCtx) {
    const { user, response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;

    const { kind } = await params;
    if (!isVoucherTemplateKind(kind)) {
        return NextResponse.json({ error: "Unknown voucher kind" }, { status: 404 });
    }

    const { data, error } = await validateRequest(req, voucherTemplateUpdateSchema);
    if (error) return error;

    // Make sure the row exists (PUT semantics shouldn't 404 on a kind that just
    // hasn't been seeded yet). Mirror the GET fallback.
    const baseline = buildVoucherTemplateDefaults(kind);
    const template = await prisma.voucherPrintTemplate.upsert({
        where:  { kind },
        create: { ...baseline, ...data, updatedById: user.id || null },
        update: { ...data,     updatedById: user.id || null },
    });
    return NextResponse.json(template);
}
