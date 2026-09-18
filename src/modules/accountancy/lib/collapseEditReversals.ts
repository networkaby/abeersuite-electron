/**
 * Hide edit-reversal noise from a ledger listing.
 *
 * When a voucher is edited, the original stays POSTED and a counter-entry is
 * posted as "EDIT (reverse): <original description>". On the account they net
 * to zero, so a register shows the pair collapsed away and only the new posting.
 * Matched by identical description, earliest unmatched original wins (repeated
 * edits net pair by pair).
 *
 * Shared by the ledger report and the bank reconciliation read so the two
 * screens list the same rows for the same ledger.
 */

const REV_PREFIX = "EDIT (reverse): ";

export function collapseEditReversals<T extends { universalVoucher: { id: number; description: string | null } }>(lines: T[]): T[] {
    const excludeIds = new Set<number>();
    for (const l of lines) {
        const desc = l.universalVoucher.description ?? "";
        if (!desc.startsWith(REV_PREFIX)) continue;
        if (excludeIds.has(l.universalVoucher.id)) continue;
        const origDesc = desc.slice(REV_PREFIX.length);
        const orig = lines.find((o) =>
            o.universalVoucher.id !== l.universalVoucher.id
            && !excludeIds.has(o.universalVoucher.id)
            && (o.universalVoucher.description ?? "") === origDesc,
        );
        if (orig) {
            excludeIds.add(orig.universalVoucher.id);
            excludeIds.add(l.universalVoucher.id);
        }
    }
    return lines.filter((l) => !excludeIds.has(l.universalVoucher.id));
}
