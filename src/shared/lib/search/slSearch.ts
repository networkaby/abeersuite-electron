// The SL Search contract — shared by GET /api/search-slno and SlSearchDialog.
// Pure module: no server or React imports, so both sides can use it.

/** Shorter than this matches half the book (a "12" is in every other SL no),
 *  and every search is a scan of the line-note column. */
export const SL_SEARCH_MIN_CHARS = 4;

/** One voucher line whose note carries the SL no. */
export type SlSearchBill = {
    lineId: number;
    /** VoucherDetail id — what `editFormUrl` opens. Null only on a detail-less spine. */
    detailId: number | null;
    type: string;
    voucherNo: string | null;
    /** Bill date, yyyy-mm-dd — read it with `parseIsoDateOnly`. */
    date: string;
    /** Frozen bill snapshot first, else the party ledger's name. */
    partyName: string | null;
    partyPhone: string | null;
    productName: string;
    /** The line note alone — the POS "<sku> — <name> · " prefix is stripped. */
    note: string;
    quantity: number;
};

/** A repair or help-desk ticket that mentions the SL no. */
export type SlSearchTicket = {
    id: number;
    kind: "repair" | "help";
    status: { label: string; color: string };
    customerName: string | null;
    customerPhone: string | null;
    device: string | null;
    /** Which field carried it ("Warranty ref", "Problem", …), so staff see why. */
    matchedField: string | null;
    matchedText: string | null;
    createdAt: string;
};

export type SlSearchResult = { bills: SlSearchBill[]; tickets: SlSearchTicket[] };
