"use client";

import { setCurrencySymbol } from "@/shared/lib/format/moneyInr";

/**
 * Hands the server-read Org Defaults currency symbol to the browser's money
 * formatters. Set during render, not in an effect, so the children rendered
 * after it in the same pass already format with the right symbol.
 */
export default function CurrencySymbolInit({ symbol }: { symbol: string }) {
    setCurrencySymbol(symbol);
    return null;
}
