/**
 * Pure types + formatters for the Organisation singleton. Lives apart from
 * `getOrganisation.ts` (which imports Prisma) so client components can
 * consume the types/formatters without pulling the server dep tree.
 *
 * DB storage uses three JSON blobs (identityJson / addressJson / contactJson)
 * plus four scalar columns (brandName, legalName, gstin, gstStateCode).
 * All callers see the flat OrganisationView — packing/unpacking happens only
 * in getOrganisation.ts and the API route.
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
}

// ── JSON blob shapes (DB internal, exported for the API route packer) ────────

export interface OrgIdentityData {
    tagline: string; logoUrl: string; pan: string;
}
export interface OrgAddressData {
    addressLine1: string; addressLine2: string; city: string;
    state: string; pinCode: string; country: string;
}
export interface OrgContactData {
    email: string; supportEmail: string; phone: string;
    whatsapp: string; siteUrl: string; hours: string;
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

export function parseIdentityJson(v: unknown): OrgIdentityData {
    const o = obj(v);
    return { tagline: s(o.tagline), logoUrl: s(o.logoUrl), pan: s(o.pan) };
}
export function parseAddressJson(v: unknown): OrgAddressData {
    const o = obj(v);
    return {
        addressLine1: s(o.addressLine1),
        addressLine2: s(o.addressLine2),
        city:         s(o.city),
        state:        s(o.state),
        pinCode:      s(o.pinCode),
        country:      s(o.country, "India"),
    };
}
export function parseContactJson(v: unknown): OrgContactData {
    const o = obj(v);
    return {
        email:        s(o.email),
        supportEmail: s(o.supportEmail),
        phone:        s(o.phone),
        whatsapp:     s(o.whatsapp),
        siteUrl:      s(o.siteUrl),
        hours:        s(o.hours),
    };
}

// ── Unpack a Prisma Organisation row → flat OrganisationView ─────────────────

export function unpackOrgRow(row: {
    brandName: string; legalName: string;
    gstin: string; gstStateCode: string;
    identityJson: unknown; addressJson: unknown; contactJson: unknown;
}): OrganisationView {
    return {
        brandName:    row.brandName,
        legalName:    row.legalName,
        gstin:        row.gstin,
        gstStateCode: row.gstStateCode,
        ...parseIdentityJson(row.identityJson),
        ...parseAddressJson(row.addressJson),
        ...parseContactJson(row.contactJson),
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
