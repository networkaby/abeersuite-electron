/**
 * Pure merge: voucher print template ⊕ Organisation singleton.
 *
 * Lives apart from `voucherTemplate.ts` (which imports Prisma) so client
 * components can call this directly to keep the live editor preview in
 * sync with the eventual print output.
 *
 * Per-kind template values always win when non-empty — they are the
 * override layer (e.g. POS sets `headerLine2 = "POS sale receipt"` even
 * though the org has no concept of POS).
 *
 * Logo resolves per-kind → Organisation → the bundled `public/logo.svg`, so
 * turning on "Show logo" always has something to render even before an admin
 * fills in a logo URL.
 */

// Bundled shop logo shipped in /public. Served at this path by Next.
const DEFAULT_LOGO_URL = "/logo.svg";

import type { VoucherTemplateDefaults } from "@/shared/lib/print/voucherTemplateDefaults";
import {
    formatAddressBlock,
    type OrganisationView,
} from "@/shared/lib/org/organisationView";

export function mergeTemplateWithOrg(
    template: VoucherTemplateDefaults,
    org: OrganisationView,
): VoucherTemplateDefaults {
    return {
        ...template,
        headerLine1:  template.headerLine1  || org.brandName,
        addressBlock: template.addressBlock || formatAddressBlock(org),
        gstinLine:    template.gstinLine    || (org.gstin ? `GSTIN: ${org.gstin}` : ""),
        phoneLine:    template.phoneLine    || (org.phone ? `Ph: ${org.phone}` : ""),
        logoUrl:      template.logoUrl      || org.logoUrl || DEFAULT_LOGO_URL,
    };
}
