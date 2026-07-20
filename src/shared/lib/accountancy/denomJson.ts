/**
 * DenomJson — the Contra deposit-slip capture stored on
 * `UniversalVoucher.denomJson` (one FINAL combined breakdown per voucher;
 * GL lines stay plain amounts).
 *
 * Shape: { notes: { "500": 10 }, cheques: [{ no: "483920", amount: 12500 }] }
 *
 * Pure types + parsers — safe for both client (contra form) and server
 * (vouchers API, print sample builder).
 */

// Type aliases (not interfaces) so the shape satisfies Prisma's InputJsonValue
// without casts — interfaces lack the implicit index signature.
export type DenomCheque = {
    no:      string;
    amount:  number;
    /** Drawer / source ledger the cheque credits (shown on the deposit slip). */
    account?: string;
};

export type DenomJson = {
    /** Note/coin counts keyed by denomination in rupees (stringified). */
    notes:   Record<string, number>;
    cheques: DenomCheque[];
};

const isPosInt = (n: unknown): n is number =>
    typeof n === "number" && Number.isInteger(n) && n >= 0;

/** Safe-parse an unknown JSON cell → DenomJson, or null when absent/invalid/empty. */
export function parseDenomJson(v: unknown): DenomJson | null {
    if (v == null || typeof v !== "object" || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;

    const notes: Record<string, number> = {};
    if (o.notes != null && typeof o.notes === "object" && !Array.isArray(o.notes)) {
        for (const [k, cnt] of Object.entries(o.notes as Record<string, unknown>)) {
            const denom = Number(k);
            if (Number.isFinite(denom) && denom > 0 && isPosInt(cnt) && cnt > 0) notes[k] = cnt;
        }
    }

    const cheques: DenomCheque[] = [];
    if (Array.isArray(o.cheques)) {
        for (const c of o.cheques) {
            if (c == null || typeof c !== "object") continue;
            const { no, amount, account } = c as Record<string, unknown>;
            if (typeof no === "string" && no.trim() && typeof amount === "number" && amount > 0) {
                cheques.push({
                    no: no.trim(),
                    amount,
                    ...(typeof account === "string" && account.trim() ? { account: account.trim() } : {}),
                });
            }
        }
    }

    if (Object.keys(notes).length === 0 && cheques.length === 0) return null;
    return { notes, cheques };
}

export function denomNotesTotal(d: DenomJson): number {
    return Object.entries(d.notes).reduce((s, [denom, cnt]) => s + Number(denom) * cnt, 0);
}

export function denomChequesTotal(d: DenomJson): number {
    return d.cheques.reduce((s, c) => s + c.amount, 0);
}

export function denomTotal(d: DenomJson): number {
    return denomNotesTotal(d) + denomChequesTotal(d);
}

/** Merge per-row captures into the FINAL voucher-level breakdown: counts sum
 *  note-wise, cheque lists concatenate. */
export function combineDenoms(list: DenomJson[]): DenomJson {
    const notes: Record<string, number> = {};
    const cheques: DenomCheque[] = [];
    for (const d of list) {
        for (const [k, cnt] of Object.entries(d.notes)) {
            if (cnt > 0) notes[k] = (notes[k] ?? 0) + cnt;
        }
        cheques.push(...d.cheques);
    }
    return { notes, cheques };
}
