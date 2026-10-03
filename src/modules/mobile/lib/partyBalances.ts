import "server-only";
import { aggregateClosingAsOf, loadNormalBalanceMap } from "@/modules/accountancy/lib/aggregateLedger";
import { round2 } from "@/shared/lib/format/moneyInr";

/**
 * Party balances for a handful of ledgers, summed from the ledger (a bounded set,
 * so no reliance on the Account.balance cache), signed the party's way round:
 * positive = they owe us (Dr), negative = we owe them (Cr), whatever group the
 * ledger sits in. A ledger with no movement reads 0.
 *
 * `asOf = null` counts every posted line whatever its date — the figure a party
 * screen shows as "balance".
 */
export async function partyBalances(accountIds: number[]): Promise<Map<number, number>> {
    const nbMap = await loadNormalBalanceMap(accountIds);
    const closing = await aggregateClosingAsOf(null, nbMap, accountIds);
    const out = new Map<number, number>();
    for (const id of accountIds) {
        const raw = closing.get(id) ?? 0;
        out.set(id, round2(nbMap.get(id) === "CREDIT" ? -raw : raw));
    }
    return out;
}
