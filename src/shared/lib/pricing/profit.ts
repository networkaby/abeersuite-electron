/**
 * After-tax profit on a GST-inclusive selling price: GST is stripped from both
 * sale and cost (output GST owed, input GST reclaimed). pct = margin on net sale.
 * Shared by Update prices and Print labels so both show the same figure.
 */
export function afterGstProfit(
    price: number | null | undefined,
    costIncl: number | null | undefined,
    gstPct: number | null | undefined,
): { amt: number; pct: number | null } | null {
    if (price == null || costIncl == null || !isFinite(price) || !isFinite(costIncl)) return null;
    const gstMul = gstPct != null && isFinite(gstPct) && gstPct > 0 ? 1 + gstPct / 100 : 1;
    const netSale = price / gstMul;
    const amt = netSale - costIncl / gstMul;
    return { amt, pct: netSale > 0 ? (amt / netSale) * 100 : null };
}
