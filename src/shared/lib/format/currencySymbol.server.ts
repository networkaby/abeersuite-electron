import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { setCurrencySymbol, currencySymbol } from "./moneyInr";

// Org Defaults → Currency symbol, read at most once a minute per server process
// so a busy till does not pay a DB read for every bill and message.
const TTL_MS = 60_000;
let loadedAt = 0;

/** Make every money formatter on this server use the shop's symbol; returns it. */
export async function loadCurrencySymbol(): Promise<string> {
    if (Date.now() - loadedAt < TTL_MS) return currencySymbol();
    try {
        const row = await prisma.orgDefaults.findUnique({ where: { id: 1 }, select: { defaultCurrencySymbol: true } });
        setCurrencySymbol(row?.defaultCurrencySymbol);
        loadedAt = Date.now();
    } catch {
        // Keep the last known symbol — a missed read must never fail a bill.
    }
    return currencySymbol();
}

/** After an Org Defaults save, so the next read picks up the new symbol. */
export function invalidateCurrencySymbol(): void {
    loadedAt = 0;
}
