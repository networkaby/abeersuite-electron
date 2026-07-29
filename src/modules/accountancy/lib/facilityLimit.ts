// "Available" balance for revolving-credit ledgers (Bank OD A/c, Credit Card) —
// how much more can still be drawn against the sanctioned limit right now.
//
// `balance` follows the app-wide signed convention (positive = the account's
// normal side). OD/Credit Card are always Credit-normal, so a positive balance
// is money drawn against the facility and a negative balance is our own money
// sitting in it beyond zero (e.g. we deposited into the OD account without
// ever drawing on it). Available = Limit − balance handles both directions
// without clamping — deposit past zero and Available rises above the limit;
// draw past the limit and Available goes negative (a visible over-limit flag).
//
// ── Usable Fund resolution ───────────────────────────────────────────────────
// fundTierOf() / netFundValue() below resolve the per-ledger fields the Usable
// Fund page reports on — stored as extra keys inside the existing bankJson /
// creditCardJson blobs (and the bnplJson / walletJson / gatewayJson blobs for
// their own groups). Each group has its own default when the ledger has never
// set fundTier explicitly:
//   Bank OD A/c     → INSTANT.
//   Credit Card     → OTHER.
//   BNPL A/c        → OTHER.
//   Wallets         → OTHER.
//   Payment Gateway → OTHER (settlement speed varies by provider — set fundTier
//                      to INSTANT per-ledger for a fast-settling one).
// Cash-in-Hand / Bank Accounts ledgers have no override at all — always INSTANT.
//
// fundTier is a REPORTING split only: it decides which section a ledger appears
// under, never how much that ledger is worth. Headroom is headroom whichever
// section reports it, so moving a ledger between Instant and Other never
// changes Instant + Other = Total.

import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { parseBank } from "@/modules/accountancy/lib/bankParticulars";
import { parseCreditCard } from "@/modules/accountancy/lib/creditCardParticulars";
import { parseBnpl } from "@/modules/accountancy/lib/bnplParticulars";
import { parseWallet } from "@/modules/accountancy/lib/walletParticulars";
import { parseGateway } from "@/modules/accountancy/lib/gatewayParticulars";

type LimitShaped = {
    group?: { name?: string | null } | null;
    bankJson?: unknown;
    creditCardJson?: unknown;
    bnplJson?: unknown;
    walletJson?: unknown;
    gatewayJson?: unknown;
};

/** Groups that are a credit facility (draw against a sanctioned limit) as
 *  opposed to a plain balance (Cash / Bank / Wallet / Payment Gateway, where
 *  the balance itself IS the spendable amount). Used to decide the right
 *  fallback when no limit has been entered yet — see accountCapacity(). */
const FACILITY_GROUPS: readonly string[] = [
    ACCOUNT_GROUPS.BANK_OD,
    ACCOUNT_GROUPS.CREDIT_CARD,
    ACCOUNT_GROUPS.BNPL,
];

export const isFacilityGroup = (groupName?: string | null): boolean =>
    !!groupName && FACILITY_GROUPS.includes(groupName);

/** Credit Card / BNPL are billing facilities, not deposit accounts — a
 *  credit-side balance there (an overpayment/refund) doesn't buy extra
 *  spending power, so their headroom is capped at the sanctioned limit and
 *  "drawn" is treated as a magnitude regardless of which side it landed on.
 *  Bank OD is excluded on purpose: it IS a real deposit account, so money
 *  parked in it beyond zero genuinely extends what can still be drawn —
 *  signed math there, can exceed the limit. See accountCapacity(). */
const MAGNITUDE_HEADROOM_GROUPS: readonly string[] = [
    ACCOUNT_GROUPS.CREDIT_CARD,
    ACCOUNT_GROUPS.BNPL,
];

export const isMagnitudeHeadroomGroup = (groupName?: string | null): boolean =>
    !!groupName && MAGNITUDE_HEADROOM_GROUPS.includes(groupName);

/** The sanctioned limit for this ledger, or null when it's not an OD/Credit
 *  Card/BNPL ledger, or the limit was never entered. */
export function accountLimit(account: LimitShaped): number | null {
    const groupName = account.group?.name;
    if (groupName === ACCOUNT_GROUPS.BANK_OD) {
        const raw = parseBank(account.bankJson).limit;
        const n = Number(raw);
        return raw !== "" && Number.isFinite(n) ? n : null;
    }
    if (groupName === ACCOUNT_GROUPS.CREDIT_CARD) {
        const raw = parseCreditCard(account.creditCardJson).limit;
        const n = Number(raw);
        return raw !== "" && Number.isFinite(n) ? n : null;
    }
    if (groupName === ACCOUNT_GROUPS.BNPL) {
        const raw = parseBnpl(account.bnplJson).limit;
        const n = Number(raw);
        return raw !== "" && Number.isFinite(n) ? n : null;
    }
    return null;
}

/** Available = Limit − signed balance. Not clamped — see file header. */
export function computeAvailable(limit: number, balance: number): number {
    return limit - balance;
}

/** Convenience: resolve the limit from the account, then compute Available.
 *  Returns null when there's no limit to compute against. */
export function availableBalance(account: LimitShaped & { balance?: number | null }): number | null {
    const limit = accountLimit(account);
    if (limit == null) return null;
    return computeAvailable(limit, account.balance ?? 0);
}

export type FundTier = "INSTANT" | "OTHER";

/** Which Usable Fund section this ledger belongs to, resolved with its
 *  group's default when the ledger never overrode it. Cash-in-Hand / Bank
 *  Accounts ledgers (no bankJson/creditCardJson override point) are always
 *  INSTANT. */
export function fundTierOf(account: LimitShaped): FundTier {
    const groupName = account.group?.name;
    if (groupName === ACCOUNT_GROUPS.BANK_OD) {
        return parseBank(account.bankJson).fundTier === "OTHER" ? "OTHER" : "INSTANT";
    }
    if (groupName === ACCOUNT_GROUPS.CREDIT_CARD) {
        return parseCreditCard(account.creditCardJson).fundTier === "INSTANT" ? "INSTANT" : "OTHER";
    }
    if (groupName === ACCOUNT_GROUPS.BNPL) {
        return parseBnpl(account.bnplJson).fundTier === "INSTANT" ? "INSTANT" : "OTHER";
    }
    if (groupName === ACCOUNT_GROUPS.WALLETS) {
        return parseWallet(account.walletJson).fundTier === "INSTANT" ? "INSTANT" : "OTHER";
    }
    if (groupName === ACCOUNT_GROUPS.PAYMENT_GATEWAY) {
        return parseGateway(account.gatewayJson).fundTier === "INSTANT" ? "INSTANT" : "OTHER";
    }
    return "INSTANT";
}

/**
 * What this ONE ledger counts toward Usable Fund — its balance/headroom, full
 * value. `fundTier` decides only WHICH SECTION the ledger is reported under,
 * never how much it is worth: the same money is the same money whether it is
 * reported as Instant or Other.
 *
 * ⚠ Correct ONLY for a Credit Card with no `sharedLimitKey`. A card that
 * shares its sanctioned limit with a sibling (a primary + add-on card issued
 * under one combined limit) needs the sibling's drawn amount folded in first —
 * this single-account function has no way to see that. Use
 * `combinedDrawnByCreditCardKey()` + `netFundValueWithSiblings()` (or just
 * `netFundTotal()` for a straight sum) whenever more than one ledger is on
 * hand, e.g. a ledger list/report. Naively summing `netFundValue()` across
 * many ledgers double-counts every shared limit once per card in the family.
 */
export function netFundValue(account: LimitShaped & { balance?: number | null }): number {
    return netFundValueWithSiblings(account);
}

/** The Credit Card's `sharedLimitKey` → combined balance drawn across every
 *  sibling card in that family. Pass the result into
 *  `netFundValueWithSiblings()` so each sibling's row shows the correct
 *  combined headroom instead of just its own. */
export function combinedDrawnByCreditCardKey(
    accounts: (LimitShaped & { balance?: number | null })[],
): Map<string, number> {
    const map = new Map<string, number>();
    for (const a of accounts) {
        const key = creditCardSharedKey(a);
        if (!key) continue;
        map.set(key, (map.get(key) ?? 0) + (a.balance ?? 0));
    }
    return map;
}

const creditCardSharedKey = (account: LimitShaped): string =>
    account.group?.name === ACCOUNT_GROUPS.CREDIT_CARD
        ? parseCreditCard(account.creditCardJson).sharedLimitKey
        : "";

/**
 * Capacity — headroom for a facility, balance otherwise. Uses the combined
 * drawn amount for a shared-limit card when `combinedDrawnByKey` has it,
 * falling back to the ledger's own balance otherwise (non-shared, the
 * common case).
 *
 * When no limit has been entered: a facility ledger (Bank OD / Credit Card /
 * BNPL) has UNKNOWN headroom, not the drawn balance — showing the amount
 * already owed as if it were spendable would be backwards. Only a genuine
 * balance-type ledger (Cash / Bank / Wallet / Payment Gateway) uses its
 * balance directly here.
 */
function accountCapacity(
    account: LimitShaped & { balance?: number | null },
    combinedDrawnByKey?: Map<string, number>,
): number {
    const limit = accountLimit(account);
    if (limit == null) return isFacilityGroup(account.group?.name) ? 0 : (account.balance ?? 0);
    const key = creditCardSharedKey(account);
    const drawnSigned = key && combinedDrawnByKey?.has(key) ? combinedDrawnByKey.get(key)! : (account.balance ?? 0);
    const drawn = isMagnitudeHeadroomGroup(account.group?.name) ? Math.abs(drawnSigned) : drawnSigned;
    return Math.max(0, computeAvailable(limit, drawn));
}

/** Same as `netFundValue()`, but correct for a shared-limit card when given
 *  the family's combined drawn amount (see `combinedDrawnByCreditCardKey()`). */
export function netFundValueWithSiblings(
    account: LimitShaped & { balance?: number | null },
    combinedDrawnByKey?: Map<string, number>,
): number {
    return accountCapacity(account, combinedDrawnByKey);
}

/**
 * Correct total across MANY ledgers — use this instead of
 * `accounts.map(netFundValue).reduce(sum)`. Ledgers sharing a
 * `sharedLimitKey` contribute their one shared limit's headroom exactly
 * once (drawn amounts combined first, netted once), not once per card.
 */
export function netFundTotal(accounts: (LimitShaped & { balance?: number | null })[]): number {
    const combinedDrawnByKey = combinedDrawnByCreditCardKey(accounts);
    const countedKeys = new Set<string>();
    let total = 0;
    for (const a of accounts) {
        const key = creditCardSharedKey(a);
        if (key) {
            if (countedKeys.has(key)) continue; // this shared pool already counted once
            countedKeys.add(key);
        }
        total += netFundValueWithSiblings(a, combinedDrawnByKey);
    }
    return total;
}

/**
 * Same as `netFundTotal()`, but only the ledgers reporting under one section
 * (`fundTierOf(account) === tier`). The combined-drawn map is still built from
 * ALL accounts passed in (not just the filtered subset), so a shared-limit
 * family's headroom stays correct even if a sibling sits in the other tier.
 */
export function netFundTotalByTier(
    accounts: (LimitShaped & { balance?: number | null })[],
    tier: FundTier,
): number {
    const combinedDrawnByKey = combinedDrawnByCreditCardKey(accounts);
    const countedKeys = new Set<string>();
    let total = 0;
    for (const a of accounts) {
        if (fundTierOf(a) !== tier) continue;
        const key = creditCardSharedKey(a);
        if (key) {
            if (countedKeys.has(key)) continue; // this shared pool already counted once
            countedKeys.add(key);
        }
        total += netFundValueWithSiblings(a, combinedDrawnByKey);
    }
    return total;
}
