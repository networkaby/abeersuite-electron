/**
 * The shop's own identity — brand, legal name, address, GSTIN, contact, bank.
 *
 * This is built entirely from `COMPANY_DETAILS`. There is no Organisation table
 * and no settings page behind it: changing the shop's identity is a code edit
 * plus a deploy, on purpose. Print templates remain the per-document override
 * layer (see `mergeTemplateWithOrg.ts`), so a single voucher can still show
 * something different without touching this.
 *
 * Kept as a function rather than a bare constant because every printed document
 * already reads it through this seam — one call site to change if the shop ever
 * needs per-branch identity.
 */

import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import {
    formatAddressBlock,
    type OrganisationView,
} from "@/shared/lib/org/organisationView";

// Re-exported so existing imports `from "@/shared/lib/org/getOrganisation"`
// keep working — callers grab everything from one place.
export { formatAddressBlock };
export type { OrganisationView };

const c = COMPANY_DETAILS;

/** The organisation, assembled once at module load. */
export const ORGANISATION: OrganisationView = {
    brandName:    c.brandName,
    legalName:    c.legalName,
    tagline:      c.tagline,
    logoUrl:      c.logoUrl,
    pan:          c.tax.pan,
    addressLine1: c.address.line1,
    addressLine2: c.address.line2 ?? "",
    city:         c.address.city,
    state:        c.address.state,
    pinCode:      c.address.pin,
    country:      c.address.country,
    gstin:        c.tax.gstin,
    // Place-of-supply is the first two chars of the GSTIN.
    gstStateCode: c.tax.gstin.length >= 2 ? c.tax.gstin.slice(0, 2) : "",
    email:        c.contact.email,
    supportEmail: c.contact.supportEmail,
    phone:        c.contact.phone,
    whatsapp:     c.contact.whatsapp,
    siteUrl:      c.siteUrl,
    hours:        c.hours,
    bankBeneficiary:   c.bank.beneficiary,
    bankName:          c.bank.bankName,
    bankAccountNumber: c.bank.accountNumber,
    bankIfsc:          c.bank.ifsc,
    bankBranch:        c.bank.branch,
    bankUpi:           c.bank.upiVpa,
};

/** The organisation used on every storefront page and printed document. */
export function getOrganisation(): OrganisationView {
    return ORGANISATION;
}
