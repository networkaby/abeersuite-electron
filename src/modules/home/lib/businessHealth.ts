import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { businessTodayIso } from "@/shared/lib/format/formatDate";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { aggregateClosingAsOf, loadNormalBalanceMap } from "@/modules/accountancy/lib/aggregateLedger";
import { getClosingStockValue } from "@/modules/accountancy/lib/closingStock";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { requiredVoucherPermission } from "@/shared/lib/auth/voucherMatrix";

/**
 * Home "Business health" card — working capital, liquid fund and inventory value,
 * one point per sampled day over the chosen period.
 *
 * Same arithmetic as the Fund Flow report (fund-flow/route.ts), so the figures
 * agree with it: Stock-in-Hand is never posted per voucher, so the dated stock
 * valuation replaces whatever that group holds.
 *
 *   working capital = |Current Assets| − Stock-in-Hand + stock value − |Current Liabilities|
 *   liquid fund     = Cash-in-Hand + Bank Accounts (the top bar's two pills)
 *   inventory       = stock value as at that day
 */

/** Periods the card offers. 15 days is the default. */
export const HEALTH_PERIODS = [7, 15, 30, 90, 365] as const;
export type HealthPeriod = (typeof HEALTH_PERIODS)[number];
export const DEFAULT_HEALTH_PERIOD: HealthPeriod = 15;

/** At most this many points per graph — a year is sampled, not walked day by day. */
const MAX_POINTS = 15;

export type HealthPoint = { date: string; workingCapital: number; liquidFund: number; inventory: number };

/** Who sees the card: anyone holding a Purchase voucher tick (admin passes). */
export function canSeeBusinessHealth(permissions: string[]): boolean {
    return (["create", "post", "cancel", "delete"] as const).some((a) => {
        const id = requiredVoucherPermission("PURCHASE", a);
        return id != null && hasPermissionWithScope(permissions, id);
    });
}

export function parseHealthPeriod(raw: string | null): HealthPeriod {
    const n = Number(raw);
    return (HEALTH_PERIODS as readonly number[]).includes(n) ? (n as HealthPeriod) : DEFAULT_HEALTH_PERIOD;
}

/** Evenly spaced business dates ending today, oldest first. */
function sampleDates(days: HealthPeriod): string[] {
    const today = new Date(`${businessTodayIso()}T00:00:00Z`);
    const points = Math.min(days, MAX_POINTS);
    const step = (days - 1) / (points - 1);
    const out = new Set<string>();
    for (let i = points - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setUTCDate(d.getUTCDate() - Math.round(i * step));
        out.add(d.toISOString().slice(0, 10));
    }
    return [...out];
}

/** Account ids under each group the card needs, sub-groups included. Masters change rarely. */
const loadGroupAccounts = unstable_cache(
    async () => {
        const [groups, accounts] = await Promise.all([
            prisma.accountGroup.findMany({ select: { id: true, parentId: true, name: true } }),
            prisma.account.findMany({ select: { id: true, groupId: true } }),
        ]);
        const kids = new Map<number, number[]>();
        for (const g of groups) {
            if (g.parentId == null) continue;
            kids.set(g.parentId, [...(kids.get(g.parentId) ?? []), g.id]);
        }
        const accountsOf = (name: string): number[] => {
            const root = groups.find((g) => g.name === name);
            if (!root) return [];
            const ids = new Set<number>();
            const stack = [root.id];
            while (stack.length) {
                const id = stack.pop()!;
                ids.add(id);
                stack.push(...(kids.get(id) ?? []));
            }
            return accounts.filter((a) => a.groupId != null && ids.has(a.groupId)).map((a) => a.id);
        };
        return {
            currentAssets: accountsOf("Current Assets"),
            currentLiabilities: accountsOf("Current Liabilities"),
            stockInHand: accountsOf("Stock-in-Hand"),
            liquid: [...accountsOf(ACCOUNT_GROUPS.CASH_IN_HAND), ...accountsOf(ACCOUNT_GROUPS.BANK_ACCOUNTS)],
        };
    },
    ["home:business-health:groups"],
    { revalidate: 600 },
);

async function computePoint(date: string): Promise<HealthPoint> {
    const g = await loadGroupAccounts();
    const ids = [...new Set([...g.currentAssets, ...g.currentLiabilities])];
    const asOf = new Date(`${date}T23:59:59.999Z`);
    const nbMap = await loadNormalBalanceMap(ids);
    const [closing, stock] = await Promise.all([
        aggregateClosingAsOf(asOf, nbMap, ids),
        getClosingStockValue(undefined, asOf),
    ]);
    const sum = (list: number[]) => list.reduce((s, id) => s + (closing.get(id) ?? 0), 0);
    return {
        date,
        workingCapital: Math.abs(sum(g.currentAssets)) - sum(g.stockInHand) + stock.computed - Math.abs(sum(g.currentLiabilities)),
        liquidFund: sum(g.liquid),
        inventory: stock.computed,
    };
}

// A past day rarely moves (only a back-dated entry shifts it), so it is kept for
// hours; today's point is kept for a few minutes. Keyed by date, so switching the
// period re-uses every day already worked out.
const pastPoint = unstable_cache(computePoint, ["home:business-health:past"], { revalidate: 6 * 3600 });
const todayPoint = unstable_cache(computePoint, ["home:business-health:today"], { revalidate: 300 });

export async function loadBusinessHealth(days: HealthPeriod): Promise<HealthPoint[]> {
    const today = businessTodayIso();
    return Promise.all(sampleDates(days).map((d) => (d === today ? todayPoint(d) : pastPoint(d))));
}
