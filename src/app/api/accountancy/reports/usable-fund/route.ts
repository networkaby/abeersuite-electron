import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { businessToday } from "@/shared/lib/format/formatDate";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { aggregateClosingAsOf, loadNormalBalanceMap } from "@/modules/accountancy/lib/aggregateLedger";
import { parseBank } from "@/modules/accountancy/lib/bankParticulars";
import { parseCreditCard } from "@/modules/accountancy/lib/creditCardParticulars";
import { parseBnpl } from "@/modules/accountancy/lib/bnplParticulars";
import { parseWallet } from "@/modules/accountancy/lib/walletParticulars";
import { parseGateway } from "@/modules/accountancy/lib/gatewayParticulars";
import { accountLimit, fundTierOf, convertibilityOf, feePctOf } from "@/modules/accountancy/lib/facilityLimit";

// GET /api/accountancy/reports/usable-fund?asOf=YYYY-MM-DD
//
// Real data for every buckets that exists today: Cash-in-Hand, Bank Accounts,
// Bank OD A/c, Credit Card, BNPL A/c, Wallets, Payment Gateway. Returns
// per-ledger building blocks only (amount, limit, tier, convertibility,
// feePct, sharedLimitKey) — the Usable Fund page itself does all the
// netting/summing (capacityOf / netValueOf / sumFund), so the math lives in
// exactly one place.

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
        return parseBnpl(a.bnplJson).provider || null;
    }
    if (groupName === ACCOUNT_GROUPS.WALLETS) {
        return parseWallet(a.walletJson).provider || null;
    }
    if (groupName === ACCOUNT_GROUPS.PAYMENT_GATEWAY) {
        return parseGateway(a.gatewayJson).provider || null;
    }
    return null;
}

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const asOfParam = searchParams.get("asOf");
    const asOf = asOfParam ? new Date(asOfParam) : businessToday();
    asOf.setHours(23, 59, 59, 999);

    try {
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
                        tier: fundTierOf(account),
                        convertibility: convertibilityOf(account),
                        feePct: feePctOf(account),
                        sharedLimitKey: a.group?.name === ACCOUNT_GROUPS.CREDIT_CARD
                            ? (parseCreditCard(a.creditCardJson).sharedLimitKey || null)
                            : null,
                    };
                });
            return { key: b.key, label: b.label, groupName: b.groupName, ledgers };
        }).filter((b) => b.ledgers.length > 0);

        return NextResponse.json({ asOf: asOf.toISOString(), buckets });
    } catch (e) {
        return handleApiError(e, "Failed to load usable fund");
    }
}
