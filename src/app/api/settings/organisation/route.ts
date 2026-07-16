import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { validateRequest } from "@/shared/lib/api";
import { organisationUpdateSchema } from "@/shared/lib/schemas/organisationSchemas";
import { normaliseGstinState } from "@/shared/lib/gst/validateGstinState";
import {
    unpackOrgRow,
    parseIdentityJson,
    parseAddressJson,
    parseContactJson,
    type OrganisationView,
} from "@/shared/lib/org/organisationView";

/**
 * Returns the Organisation singleton as a flat OrganisationView (id=1).
 * Auto-upserts on first read. Available to any signed-in staff user.
 */
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;

    const row = await prisma.organisation.upsert({
        where:  { id: 1 },
        create: { id: 1 },
        update: {},
    });
    return NextResponse.json(unpackOrgRow(row));
}

/**
 * PATCH /api/settings/organisation — partial update of the singleton.
 * Accepts and returns a flat OrganisationView — JSON grouping is an internal
 * storage detail. GSTIN auto-populates gstStateCode; mismatches are rejected.
 */
export async function PATCH(req: NextRequest) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const { data, error } = await validateRequest(req, organisationUpdateSchema);
    if (error) return error;

    // Read current row (auto-upsert if missing) so we can merge the partial
    // patch onto the full stored values before packing back into JSON blobs.
    const current = await prisma.organisation.upsert({
        where:  { id: 1 },
        create: { id: 1 },
        update: {},
    });
    const cur = unpackOrgRow(current);

    // Merge patch onto current flat view.
    const merged: OrganisationView = { ...cur, ...data };

    // GSTIN ↔ state-code/state-name integrity guard. Only runs when the patch
    // touches any of those three fields.
    if (data.gstin !== undefined || data.gstStateCode !== undefined || data.state !== undefined) {
        const integrity = normaliseGstinState({
            gstin:        merged.gstin,
            gstStateCode: merged.gstStateCode,
            state:        merged.state,
        });
        if (!integrity.ok) {
            return NextResponse.json({ error: integrity.error }, { status: 400 });
        }
        merged.gstin        = integrity.value.gstin;
        merged.gstStateCode = integrity.value.gstStateCode;
        merged.state        = integrity.value.state;
    }

    // Pack flat view back into the three JSON blobs + scalar columns.
    const row = await prisma.organisation.update({
        where: { id: 1 },
        data: {
            brandName:    merged.brandName,
            legalName:    merged.legalName,
            gstin:        merged.gstin,
            gstStateCode: merged.gstStateCode,
            identityJson: { tagline: merged.tagline, logoUrl: merged.logoUrl, pan: merged.pan } satisfies ReturnType<typeof parseIdentityJson>,
            addressJson:  { addressLine1: merged.addressLine1, addressLine2: merged.addressLine2, city: merged.city, state: merged.state, pinCode: merged.pinCode, country: merged.country } satisfies ReturnType<typeof parseAddressJson>,
            contactJson:  { email: merged.email, supportEmail: merged.supportEmail, phone: merged.phone, whatsapp: merged.whatsapp, siteUrl: merged.siteUrl, hours: merged.hours } satisfies ReturnType<typeof parseContactJson>,
            updatedById:  user.id || null,
        },
    });
    return NextResponse.json(unpackOrgRow(row));
}
