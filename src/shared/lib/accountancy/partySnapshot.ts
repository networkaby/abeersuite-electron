// Frozen party snapshot stored on InvVoucher.partyJson — the customer/supplier
// name / phone / address as-of the transaction (immutable on a tax invoice).
// Replaces the former partyName / partyPhone / partyAddress scalar columns.
// `accountId` remains the canonical (live) party link; this is the snapshot copy.
// Pure module — safe to import from client and server.

export type PartySnapshot = {
    name: string | null;
    phone: string | null;
    address: string | null;
};

function readField(partyJson: unknown, key: keyof PartySnapshot): string | null {
    if (partyJson && typeof partyJson === "object" && key in partyJson) {
        const v = (partyJson as Record<string, unknown>)[key];
        if (typeof v === "string") {
            const t = v.trim();
            return t === "" ? null : t;
        }
    }
    return null;
}

export const readPartyName = (partyJson: unknown): string | null => readField(partyJson, "name");
export const readPartyPhone = (partyJson: unknown): string | null => readField(partyJson, "phone");
export const readPartyAddress = (partyJson: unknown): string | null => readField(partyJson, "address");

/**
 * Build the snapshot object from raw inputs (trims, blanks → null). Returns null
 * when every field is empty so the caller can store Prisma.DbNull (no snapshot,
 * e.g. a non-party voucher). Storeable directly in the Json column otherwise.
 */
export function buildPartyJson(p: {
    name?: string | null;
    phone?: string | null;
    address?: string | null;
}): PartySnapshot | null {
    const name = p.name?.trim() || null;
    const phone = p.phone?.trim() || null;
    const address = p.address?.trim() || null;
    if (!name && !phone && !address) return null;
    return { name, phone, address };
}
