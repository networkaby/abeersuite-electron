import { prisma } from "@/shared/lib/prisma/prismaClient";
import { COMPANY_DETAILS } from "@/utils/constants-company-details";
import {
    formatAddressBlock,
    type OrganisationView,
} from "@/shared/lib/org/organisationView";

// Re-export the pure pieces so existing imports `from "@/shared/lib/org/getOrganisation"`
// keep working — server-only code can grab everything from one place.
export { formatAddressBlock };
export type { OrganisationView };

function fallbackFromCompanyDetails(): OrganisationView {
    return {
        brandName:    COMPANY_DETAILS.brandName,
        legalName:    COMPANY_DETAILS.legalName,
        tagline:      COMPANY_DETAILS.tagline,
        logoUrl:      "",
        addressLine1: COMPANY_DETAILS.address.line1,
        addressLine2: COMPANY_DETAILS.address.line2 ?? "",
        city:         COMPANY_DETAILS.address.city,
        state:        COMPANY_DETAILS.address.state,
        pinCode:      COMPANY_DETAILS.address.pin,
        country:      COMPANY_DETAILS.address.country,
        gstin:        COMPANY_DETAILS.tax.gstin,
        pan:          COMPANY_DETAILS.tax.pan,
        gstStateCode: COMPANY_DETAILS.tax.gstin.length >= 2
            ? COMPANY_DETAILS.tax.gstin.slice(0, 2)
            : "",
        email:        COMPANY_DETAILS.contact.email,
        supportEmail: COMPANY_DETAILS.contact.supportEmail,
        phone:        COMPANY_DETAILS.contact.phone,
        whatsapp:     COMPANY_DETAILS.contact.whatsapp,
        siteUrl:      COMPANY_DETAILS.siteUrl,
        hours:        COMPANY_DETAILS.hours,
    };
}

/**
 * Loads the Organisation singleton (row id=1). Auto-upserts on first call
 * (matches the `OrgDefaults` / `BooksConfig` pattern). Any blank field on
 * the row is filled in from `COMPANY_DETAILS` before returning so callers
 * never have to nullish-coalesce.
 */
export async function getOrganisation(): Promise<OrganisationView> {
    const row = await prisma.organisation.upsert({
        where:  { id: 1 },
        create: { id: 1 },
        update: {},
    });

    const fb = fallbackFromCompanyDetails();
    return {
        brandName:    row.brandName    || fb.brandName,
        legalName:    row.legalName    || fb.legalName,
        tagline:      row.tagline      || fb.tagline,
        logoUrl:      row.logoUrl      || fb.logoUrl,
        addressLine1: row.addressLine1 || fb.addressLine1,
        addressLine2: row.addressLine2 || fb.addressLine2,
        city:         row.city         || fb.city,
        state:        row.state        || fb.state,
        pinCode:      row.pinCode      || fb.pinCode,
        country:      row.country      || fb.country,
        gstin:        row.gstin        || fb.gstin,
        pan:          row.pan          || fb.pan,
        gstStateCode: row.gstStateCode || fb.gstStateCode,
        email:        row.email        || fb.email,
        supportEmail: row.supportEmail || fb.supportEmail,
        phone:        row.phone        || fb.phone,
        whatsapp:     row.whatsapp     || fb.whatsapp,
        siteUrl:      row.siteUrl      || fb.siteUrl,
        hours:        row.hours        || fb.hours,
    };
}

/**
 * Returns the raw row (no COMPANY_DETAILS fallback) — used by the settings
 * form so it can show the admin exactly what's stored vs what's still empty.
 */
export async function getOrganisationRaw(): Promise<OrganisationView> {
    const row = await prisma.organisation.upsert({
        where:  { id: 1 },
        create: { id: 1 },
        update: {},
    });
    return {
        brandName:    row.brandName,
        legalName:    row.legalName,
        tagline:      row.tagline,
        logoUrl:      row.logoUrl,
        addressLine1: row.addressLine1,
        addressLine2: row.addressLine2,
        city:         row.city,
        state:        row.state,
        pinCode:      row.pinCode,
        country:      row.country,
        gstin:        row.gstin,
        pan:          row.pan,
        gstStateCode: row.gstStateCode,
        email:        row.email,
        supportEmail: row.supportEmail,
        phone:        row.phone,
        whatsapp:     row.whatsapp,
        siteUrl:      row.siteUrl,
        hours:        row.hours,
    };
}
