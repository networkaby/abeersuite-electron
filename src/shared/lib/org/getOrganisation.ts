import { prisma } from "@/shared/lib/prisma/prismaClient";
import { COMPANY_DETAILS } from "@/utils/constants-company-details";
import {
    formatAddressBlock,
    unpackOrgRow,
    type OrganisationView,
} from "@/shared/lib/org/organisationView";

// Re-export the pure pieces so existing imports `from "@/shared/lib/org/getOrganisation"`
// keep working — server-only code can grab everything from one place.
export { formatAddressBlock, unpackOrgRow };
export type { OrganisationView };

function fallbackFromCompanyDetails(): OrganisationView {
    const gstin = COMPANY_DETAILS.tax.gstin ?? "";
    return {
        brandName:    COMPANY_DETAILS.brandName,
        legalName:    COMPANY_DETAILS.legalName,
        tagline:      COMPANY_DETAILS.tagline,
        logoUrl:      "",
        pan:          COMPANY_DETAILS.tax.pan,
        addressLine1: COMPANY_DETAILS.address.line1,
        addressLine2: COMPANY_DETAILS.address.line2 ?? "",
        city:         COMPANY_DETAILS.address.city,
        state:        COMPANY_DETAILS.address.state,
        pinCode:      COMPANY_DETAILS.address.pin,
        country:      COMPANY_DETAILS.address.country,
        gstin,
        gstStateCode: gstin.length >= 2 ? gstin.slice(0, 2) : "",
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
    const unpacked = unpackOrgRow(row);
    const fb = fallbackFromCompanyDetails();
    // For every blank field, fall back to COMPANY_DETAILS so callers never
    // need to nullish-coalesce.
    return (Object.keys(fb) as (keyof OrganisationView)[]).reduce(
        (acc, key) => ({ ...acc, [key]: unpacked[key] || fb[key] }),
        unpacked,
    );
}

/**
 * Returns the stored values with no COMPANY_DETAILS fallback — used by the
 * settings form so it can show the admin exactly what's stored vs empty.
 */
export async function getOrganisationRaw(): Promise<OrganisationView> {
    const row = await prisma.organisation.upsert({
        where:  { id: 1 },
        create: { id: 1 },
        update: {},
    });
    return unpackOrgRow(row);
}
