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
// fundTierOf() / netFundValue() below resolve the same per-ledger fields the
// Usable Fund design preview mocks (see the page's own header comment) —
// stored as extra keys inside the existing bankJson / creditCardJson blobs
// (and the bnplJson / walletJson / gatewayJson blobs for their own groups).
// Each group has its own sensible default when the ledger has never set the
// field explicitly:
//   Bank OD A/c     → fundTier defaults to INSTANT.
//   Credit Card     → fundTier defaults to OTHER, convertibility to CONVERTIBLE.
//   BNPL A/c        → fundTier defaults to OTHER, convertibility to RESTRICTED
//                      (normally purchase-only, no cash-out route).
//   Wallets         → fundTier defaults to OTHER, convertibility to CONVERTIBLE.
//   Payment Gateway → fundTier defaults to OTHER, convertibility to CONVERTIBLE
//                      (settlement speed varies by provider — set fundTier to
//                      INSTANT per-ledger for a fast-settling one).
// Cash-in-Hand / Bank Accounts ledgers have no override at all — they're
// always INSTANT, full value, no conversion concept applies.

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
export type Convertibility = "CONVERTIBLE" | "RESTRICTED" | "UNAVAILABLE";

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

/** OTHER-tier ledgers only — how the ledger's headroom counts toward Other
 *  Fund. Credit Card / Wallets / Payment Gateway default to CONVERTIBLE;
 *  BNPL defaults to RESTRICTED (normally purchase-only, no cash-out route). */
export function convertibilityOf(account: LimitShaped): Convertibility {
    const groupName = account.group?.name;
    if (groupName === ACCOUNT_GROUPS.CREDIT_CARD) {
        const v = parseCreditCard(account.creditCardJson).convertibility;
        return v === "RESTRICTED" || v === "UNAVAILABLE" ? v : "CONVERTIBLE";
    }
    if (groupName === ACCOUNT_GROUPS.WALLETS) {
        const v = parseWallet(account.walletJson).convertibility;
        return v === "RESTRICTED" || v === "UNAVAILABLE" ? v : "CONVERTIBLE";
    }
    if (groupName === ACCOUNT_GROUPS.PAYMENT_GATEWAY) {
        const v = parseGateway(account.gatewayJson).convertibility;
        return v === "RESTRICTED" || v === "UNAVAILABLE" ? v : "CONVERTIBLE";
    }
    if (groupName === ACCOUNT_GROUPS.BNPL) {
        const v = parseBnpl(account.bnplJson).convertibility;
        return v === "CONVERTIBLE" || v === "UNAVAILABLE" ? v : "RESTRICTED";
    }
    return "RESTRICTED";
}

/** Processing fee % — Credit Card / BNPL / Wallets / Payment Gateway only,
 *  applied when convertibility is CONVERTIBLE. */
export function feePctOf(account: LimitShaped): number {
    const groupName = account.group?.name;
    const raw =
        groupName === ACCOUNT_GROUPS.CREDIT_CARD ? parseCreditCard(account.creditCardJson).feePct :
        groupName === ACCOUNT_GROUPS.BNPL ? parseBnpl(account.bnplJson).feePct :
        groupName === ACCOUNT_GROUPS.WALLETS ? parseWallet(account.walletJson).feePct :
        groupName === ACCOUNT_GROUPS.PAYMENT_GATEWAY ? parseGateway(account.gatewayJson).feePct :
        "";
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
}

/**
 * What this ONE ledger counts toward Usable Fund — full balance/headroom for
 * INSTANT, net of the processing fee for CONVERTIBLE, zero otherwise.
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

/** Capacity (headroom for a facility, balance otherwise), using the combined
 *  drawn amount for a shared-limit card when `combinedDrawnByKey` has it —
 *  falls back to the ledger's own balance otherwise (non-shared, the common case). */
function accountCapacity(
    account: LimitShaped & { balance?: number | null },
    combinedDrawnByKey?: Map<string, number>,
): number {
    const limit = accountLimit(account);
    if (limit == null) return account.balance ?? 0;
    const key = creditCardSharedKey(account);
    const drawn = key && combinedDrawnByKey?.has(key) ? combinedDrawnByKey.get(key)! : (account.balance ?? 0);
    return Math.max(0, computeAvailable(limit, drawn));
}

/** Same as `netFundValue()`, but correct for a shared-limit card when given
 *  the family's combined drawn amount (see `combinedDrawnByCreditCardKey()`). */
export function netFundValueWithSiblings(
    account: LimitShaped & { balance?: number | null },
    combinedDrawnByKey?: Map<string, number>,
): number {
    const tier = fundTierOf(account);
    const capacity = accountCapacity(account, combinedDrawnByKey);
    if (tier === "INSTANT") return capacity;
    if (convertibilityOf(account) === "CONVERTIBLE") return capacity * (1 - feePctOf(account) / 100);
    return 0;
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
