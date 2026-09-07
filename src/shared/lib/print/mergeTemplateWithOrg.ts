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
    formatBankBlock,
    buildUpiPayLink,
    type OrganisationView,
} from "@/shared/lib/org/organisationView";

/** Shop identity for the shipping labels' FROM block, from a merged template. */
export function labelSender(t: VoucherTemplateDefaults): { name: string; address: string | null; phone: string | null } {
    return {
        name:    t.headerLine1,
        address: t.addressBlock?.trim() || null,
        phone:   t.phoneLine?.replace(/^Ph:\s*/i, "").trim() || null,
    };
}

/** Bottom-strip footer for the shipping labels; blank → nothing printed. */
export function labelFooter(t: VoucherTemplateDefaults): string | null {
    return t.footerLine?.trim() || null;
}

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
        emailLine:    template.emailLine    || org.email  || "",
        websiteLine:  template.websiteLine  || org.siteUrl || "",
        bankDetails:  template.bankDetails  || formatBankBlock(org),
        bankUpiQr:    template.bankUpiQr    || buildUpiPayLink(org),
        logoUrl:      template.logoUrl      || org.logoUrl || DEFAULT_LOGO_URL,
    };
}
