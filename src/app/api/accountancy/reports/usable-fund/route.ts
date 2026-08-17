import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { businessToday } from "@/shared/lib/format/formatDate";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { aggregateClosingAsOf, isUnchangedSince, loadNormalBalanceMap } from "@/modules/accountancy/lib/aggregateLedger";
import { parseBank } from "@/modules/accountancy/lib/bankParticulars";
import { parseCreditCard } from "@/modules/accountancy/lib/creditCardParticulars";
import { parseBnpl } from "@/modules/accountancy/lib/bnplParticulars";
import { parseWallet } from "@/modules/accountancy/lib/walletParticulars";
import { parseGateway } from "@/modules/accountancy/lib/gatewayParticulars";
import { accountLimit, fundTierOf, isFacilityGroup, isMagnitudeHeadroomGroup, netFundTotalByTier } from "@/modules/accountancy/lib/facilityLimit";

// GET /api/accountancy/reports/usable-fund?asOf=YYYY-MM-DD
//
// Real data for every buckets that exists today: Cash-in-Hand, Bank Accounts,
// Bank OD A/c, Credit Card, BNPL A/c, Wallets, Payment Gateway. Returns
// per-ledger building blocks only (amount, limit, isFacility, magnitudeHeadroom,
// tier, sharedLimitKey) — the Usable Fund page itself does
// all the netting/summing (capacityOf / netValueOf / sumFund), so the math
// lives in exactly one place.

const BUCKETS = [
    { key: "cash", label: "Cash in Hand", groupName: ACCOUNT_GROUPS.CASH_IN_HAND },
    { key: "bank", label: "Bank Accounts", groupName: ACCOUNT_GROUPS.BANK_ACCOUNTS },
    { key: "od", label: "Bank Overdraft", groupName: ACCOUNT_GROUPS.BANK_OD },
    { key: "card", label: "Credit Cards", groupName: ACCOUNT_GROUPS.CREDIT_CARD },
    { key: "bnpl", label: "BNPL / Pay Later", groupName: ACCOUNT_GROUPS.BNPL },
    { key: "wallets", label: "Wallets", groupName: ACCOUNT_GROUPS.WALLETS },
    { key: "gateway", label: "Payment Gateway", groupName: ACCOUNT_GROUPS.PAYMENT_GATEWAY },
] as const;

const GROUP_NAMES: string[] = BUCKETS.map((b) => b.groupName);

type AccountRow = {
    group: { name: string } | null;
    bankJson: unknown;
    creditCardJson: unknown;
    bnplJson: unknown;
    walletJson: unknown;
    gatewayJson: unknown;
};

function noteFor(a: AccountRow): string | null {
    const groupName = a.group?.name;
    if (groupName === ACCOUNT_GROUPS.BANK_OD) {
        const b = parseBank(a.bankJson);
        return b.accountNumber ? `A/c ••••${b.accountNumber.slice(-4)}` : null;
    }
    if (groupName === ACCOUNT_GROUPS.CREDIT_CARD) {
        const c = parseCreditCard(a.creditCardJson);
        const parts = [
            c.cardNumber ? `••••${c.cardNumber.slice(-4)}` : null,
            c.dueDay ? `due ${c.dueDay}` : null,
        ].filter(Boolean);
        return parts.length ? parts.join(" · ") : null;
    }
    if (groupName === ACCOUNT_GROUPS.BNPL) {
        const p = parseBnpl(a.bnplJson);
        const parts = [p.provider || null, p.creditDays ? `${p.creditDays}-day credit` : null].filter(Boolean);
        return parts.length ? parts.join(" · ") : null;
    }
    if (groupName === ACCOUNT_GROUPS.WALLETS) {
        return parseWallet(a.walletJson).provider || null;
    }
    if (groupName === ACCOUNT_GROUPS.PAYMENT_GATEWAY) {
        return parseGateway(a.gatewayJson).provider || null;
    }
    return null;
}

// The client sends back the server time it received on its last successful
// fetch (`?since=`) so this route can stay stateless. Only the default "as of
// today" call (the finance top bar's usage) honors it — a historical `?asOf=`
// query always computes fresh.
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const asOfParam = searchParams.get("asOf");
    const asOf = asOfParam ? new Date(asOfParam) : businessToday();
    asOf.setHours(23, 59, 59, 999);

    try {
        const now = new Date();
        // Only the default "as of today" call may skip — a historical `?asOf=`
        // query is not what the top bar polls and always computes fresh.
        const sinceParam = asOfParam ? null : searchParams.get("since");
        if (await isUnchangedSince(sinceParam, now)) {
            return NextResponse.json({ unchanged: true, computedAt: now.toISOString() });
        }

        const nbMap = await loadNormalBalanceMap();
        const closingMap = await aggregateClosingAsOf(asOf, nbMap);

        const accounts = await prisma.account.findMany({
            where: { isActive: true, group: { name: { in: GROUP_NAMES } } },
            select: {
                id: true,
                name: true,
                bankJson: true,
                creditCardJson: true,
                bnplJson: true,
                walletJson: true,
                gatewayJson: true,
                group: { select: { name: true } },
            },
            orderBy: { name: "asc" },
        });

        const buckets = BUCKETS.map((b) => {
            const ledgers = accounts
                .filter((a) => a.group?.name === b.groupName)
                .map((a) => {
                    const account: AccountRow = {
                        group: a.group,
                        bankJson: a.bankJson,
                        creditCardJson: a.creditCardJson,
                        bnplJson: a.bnplJson,
                        walletJson: a.walletJson,
                        gatewayJson: a.gatewayJson,
                    };
                    return {
                        name: a.name,
                        note: noteFor(account),
                        amount: closingMap.get(a.id) ?? 0,
                        limit: accountLimit(account),
                        // Facility ledger (Bank OD / Credit Card / BNPL) with no limit
                        // entered yet — capacity is unknown, not the drawn balance. The
                        // client's capacityOf() falls back to 0 rather than amount here.
                        isFacility: isFacilityGroup(a.group?.name),
                        // Credit Card / BNPL only — a credit-side balance there is capped
                        // at the limit rather than extending headroom past it. See
                        // isMagnitudeHeadroomGroup() in facilityLimit.ts.
                        magnitudeHeadroom: isMagnitudeHeadroomGroup(a.group?.name),
                        tier: fundTierOf(account),
                        sharedLimitKey: a.group?.name === ACCOUNT_GROUPS.CREDIT_CARD
                            ? (parseCreditCard(a.creditCardJson).sharedLimitKey || null)
                            : null,
                    };
                });
            return { key: b.key, label: b.label, groupName: b.groupName, ledgers };
        }).filter((b) => b.ledgers.length > 0);

        // Instant Fund total — same figure the Usable Fund page's "Instant"
        // hero tile shows, computed here too so the top bar can show it
        // without loading every bucket/ledger.
        const accountsWithBalance = accounts.map((a) => ({ ...a, balance: closingMap.get(a.id) ?? 0 }));
        const instantTotal = netFundTotalByTier(accountsWithBalance, "INSTANT");

        return NextResponse.json({ asOf: asOf.toISOString(), computedAt: now.toISOString(), buckets, instantTotal });
    } catch (e) {
        return handleApiError(e, "Failed to load usable fund");
    }
}
