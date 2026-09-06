// Universal Voucher No (UVNo) — the UniversalVoucher spine already has a unique
// `id`, so the id IS the universal identifier. There is no separate number column;
// this helper just renders the display LABEL (`UV-<id>`). See docs/vocabulary.md
// ("Voucher No · Universal Voucher No"). Distinct from the per-kind Voucher No
// (`UniversalVoucher.voucherNo`, e.g. SV-/PMT-/POS-).
//
// The id itself is a plain autoincrement, kept collision-free across counters by the
// per-counter id-range blocks (shared/lib/counter/idRange.ts). The 9-digit
// FY/counter/sequence formula that once lived here was never called and is gone.

export function formatUvNo(id: number | null | undefined): string {
    return id != null ? `UV-${id}` : "";
}
