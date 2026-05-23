/**
 * Pure types + formatters for the Organisation singleton. Lives apart from
 * `getOrganisation.ts` (which imports Prisma) so client components can
 * consume the types/formatters without pulling the server dep tree.
 */

export interface OrganisationView {
    brandName:    string;
    legalName:    string;
    tagline:      string;
    logoUrl:      string;
    addressLine1: string;
    addressLine2: string;
    city:         string;
    state:        string;
    pinCode:      string;
    country:      string;
    gstin:        string;
    pan:          string;
    gstStateCode: string;
    email:        string;
    supportEmail: string;
    phone:        string;
    whatsapp:     string;
    siteUrl:      string;
    hours:        string;
}

/** Render the address as a multi-line block (one line per non-empty piece). */
export function formatAddressBlock(org: OrganisationView): string {
    const cityLine = [org.city, org.state, org.pinCode].filter(Boolean).join(", ");
    return [
        org.addressLine1,
        org.addressLine2,
        cityLine,
        org.country,
    ].filter(Boolean).join("\n");
}
