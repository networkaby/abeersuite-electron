/**
 * Pure formatter — multi-line address block for a Branch. Prefers the
 * structured fields; falls back to the legacy single-line `address` when
 * the admin hasn't filled them in yet.
 *
 * Lives under `org/` (not `prisma/`) so client components can import it
 * without pulling the server dep tree.
 */

export interface BranchAddressInput {
    address:      string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city:         string | null;
    state:        string | null;
    pinCode:      string | null;
    country:      string | null;
}

export function formatBranchAddressBlock(b: BranchAddressInput): string {
    const hasStructured =
        !!b.addressLine1 || !!b.addressLine2 || !!b.city || !!b.state || !!b.pinCode;

    if (hasStructured) {
        const cityLine = [b.city, b.state, b.pinCode].filter(Boolean).join(", ");
        return [b.addressLine1, b.addressLine2, cityLine, b.country].filter(Boolean).join("\n");
    }
    return b.address ?? "";
}

/** Short single-line summary for list rows ("Address line 1, City"). */
export function branchAddressSummary(b: BranchAddressInput): string {
    if (b.addressLine1 || b.city) {
        return [b.addressLine1, b.city].filter(Boolean).join(", ");
    }
    return b.address ?? "";
}
