/**
 * Pure types + formatters for the shop's own identity.
 *
 * There is no Organisation table — the values are assembled from
 * `COMPANY_DETAILS` in `getOrganisation.ts`. This module stays free of that
 * import so client components can use the types and formatters on their own.
 *
 * `parseBankJson` survives the table's removal because Account rows carry their
 * own `bankJson` (see `voucherReceiptSample.ts`) — it is not Organisation-only.
 */

// ── Flat view (what every caller uses) ───────────────────────────────────────

export interface OrganisationView {
    brandName:    string;
    legalName:    string;
    // identityJson fields
    tagline:      string;
    logoUrl:      string;
    pan:          string;
    // addressJson fields
    addressLine1: string;
    addressLine2: string;
    city:         string;
    state:        string;
    pinCode:      string;
    country:      string;
    // scalar tax
    gstin:        string;
    gstStateCode: string;
    // contactJson fields
    email:        string;
    supportEmail: string;
    phone:        string;
    whatsapp:     string;
    siteUrl:      string;
    hours:        string;
    // bankJson fields — the shop's primary bank, printed on vouchers (opt-in
    // per template via the "Bank details" toggle) so customers can pay in.
    bankBeneficiary:   string;
    bankName:          string;
    bankAccountNumber: string;
    bankIfsc:          string;
    bankBranch:        string;
    bankUpi:           string;
}

// ── JSON blob shapes (DB internal, exported for the API route packer) ────────

export interface OrgBankData {
    beneficiary: string; bankName: string; accountNumber: string;
    ifsc: string; branch: string; upi: string;
}

// ── Safe parsers: unknown JSON → typed struct with string fallbacks ───────────

function s(v: unknown, fallback = ""): string {
    return typeof v === "string" ? v : fallback;
}
function obj(v: unknown): Record<string, unknown> {
    return v != null && typeof v === "object" && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : {};
}

export function parseBankJson(v: unknown): OrgBankData {
    const o = obj(v);
    return {
        beneficiary:   s(o.beneficiary),
        bankName:      s(o.bankName),
        accountNumber: s(o.accountNumber),
        ifsc:          s(o.ifsc),
        branch:        s(o.branch),
        upi:           s(o.upi),
    };
}

// ── Formatters ────────────────────────────────────────────────────────────────

/** Render any structured Indian address as a multi-line block (one line per
 *  non-empty piece). Shared by the Organisation (HO) address and the per-branch
 *  address on invoices. */
export function formatStructuredAddressBlock(a: {
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?:         string | null;
    state?:        string | null;
    pinCode?:      string | null;
    country?:      string | null;
}): string {
    const cityLine = [a.city, a.state, a.pinCode].filter(Boolean).join(", ");
    return [a.addressLine1, a.addressLine2, cityLine, a.country]
        .filter(Boolean)
        .join("\n");
}

/** Render the org (Head-Office) address as a multi-line block. */
export function formatAddressBlock(org: OrganisationView): string {
    return formatStructuredAddressBlock(org);
}

/** Render the shop's primary bank details as a labelled multi-line block,
 *  matching the shop's existing retail-invoice layout: bank + branch on the
 *  Name line, then Account No. / IFSC code / Account holder's name. Empty
 *  → "" so the renderer can hide the whole section. */
export function formatBankBlock(org: OrganisationView): string {
    const nameLine = [org.bankName, org.bankBranch].filter(Boolean).join(", ");
    return [
        nameLine              && `Name: ${nameLine}`,
        org.bankAccountNumber && `Account No.: ${org.bankAccountNumber}`,
        org.bankIfsc          && `IFSC code: ${org.bankIfsc}`,
        org.bankBeneficiary   && `Account holder's name: ${org.bankBeneficiary}`,
    ].filter(Boolean).join("\n");
}

/** UPI deep link for the shop's scan-to-pay QR (or "" when no UPI id). */
export function buildUpiPayLink(org: OrganisationView): string {
    if (!org.bankUpi) return "";
    const payee = org.bankBeneficiary || org.brandName;
    return `upi://pay?pa=${encodeURIComponent(org.bankUpi)}&pn=${encodeURIComponent(payee)}&cu=INR`;
}
