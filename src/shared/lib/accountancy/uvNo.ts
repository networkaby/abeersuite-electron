// Universal Voucher No (UVNo) — the UniversalVoucher spine already has a unique
// `id`, so the id IS the universal identifier. There is no separate number column;
// this helper just renders the display LABEL (`UV-<id>`). See docs/vocabulary.md
// ("Voucher No · Universal Voucher No"). Distinct from the per-kind Voucher No
// (`UniversalVoucher.voucherNo`, e.g. SV-/PMT-/POS-).
export function formatUvNo(id: number | null | undefined): string {
    return id != null ? `UV-${id}` : "";
}
