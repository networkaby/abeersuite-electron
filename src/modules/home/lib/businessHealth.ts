import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { childrenMap, subtreeIds } from "@/shared/lib/tree";
import { businessTodayIso } from "@/shared/lib/format/formatDate";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { aggregateClosingAsOf, loadNormalBalanceMap, netProfitLoss } from "@/modules/accountancy/lib/aggregateLedger";
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
        const kids = childrenMap(groups);
        const accountsOf = (name: string): number[] => {
            const root = groups.find((g) => g.name === name);
            if (!root) return [];
            const ids = new Set(subtreeIds(kids, root.id));
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

// ── Cash flow and runway ─────────────────────────────────────────────────────

export type CashFlowDay = { date: string; inflow: number; outflow: number };

/**
 * Money in and out of cash + bank per day. Netted per voucher first, so moving
 * money between your own cash and bank (a contra, or a POS cash drop) is neither
 * in nor out.
 */
async function computeCashFlow(fromIso: string, toIso: string): Promise<CashFlowDay[]> {
    const { liquid } = await loadGroupAccounts();
    if (liquid.length === 0) return [];
    const rows = await prisma.$queryRaw<{ d: Date; inflow: string; outflow: string }[]>`
        WITH per_voucher AS (
            SELECT v."date" AS d,
                   SUM(CASE WHEN l."type" = 'DEBIT' THEN l."amount" ELSE -l."amount" END) AS s
            FROM "VoucherGlLine" l
            JOIN "UniversalVoucher" v ON v."id" = l."universalVoucherId"
            WHERE l."accountId" = ANY(${liquid})
              AND v."status" = 'POSTED'
              AND v."date" BETWEEN ${fromIso}::date AND ${toIso}::date
            GROUP BY v."date", v."id"
        )
        SELECT d, SUM(GREATEST(s, 0)) AS inflow, SUM(GREATEST(-s, 0)) AS outflow
        FROM per_voucher GROUP BY d ORDER BY d`;
    const byDay = new Map(rows.map((r) => [r.d.toISOString().slice(0, 10), r]));
    // Every day in the range, quiet days included, so the bars line up with the dates.
    const out: CashFlowDay[] = [];
    for (let d = new Date(`${fromIso}T00:00:00Z`); d.toISOString().slice(0, 10) <= toIso; d.setUTCDate(d.getUTCDate() + 1)) {
        const iso = d.toISOString().slice(0, 10);
        const r = byDay.get(iso);
        out.push({ date: iso, inflow: Number(r?.inflow ?? 0), outflow: Number(r?.outflow ?? 0) });
    }
    return out;
}

const cachedCashFlow = unstable_cache(computeCashFlow, ["home:cash-flow"], { revalidate: 300 });

function daysAgoIso(n: number): string {
    const d = new Date(`${businessTodayIso()}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
}

export async function loadCashFlow(days: HealthPeriod): Promise<CashFlowDay[]> {
    return cachedCashFlow(daysAgoIso(days - 1), businessTodayIso());
}

/** Months the liquid fund lasts at the last 3 months' average money out. */
export async function loadCashRunway(): Promise<{ liquidFund: number; monthlyOut: number; months: number | null; runsOut: string | null }> {
    const [today, flow] = await Promise.all([
        todayPoint(businessTodayIso()),
        cachedCashFlow(daysAgoIso(89), businessTodayIso()),
    ]);
    const monthlyOut = flow.reduce((s, d) => s + d.outflow, 0) / 3;
    const months = monthlyOut > 0 ? Math.max(0, today.liquidFund) / monthlyOut : null;
    let runsOut: string | null = null;
    if (months != null) {
        const d = new Date(`${businessTodayIso()}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + Math.round(months * 30.44));
        runsOut = d.toISOString().slice(0, 10);
    }
    return { liquidFund: today.liquidFund, monthlyOut, months, runsOut };
}

// ── Monthly sales and net profit ─────────────────────────────────────────────

export const TREND_MONTHS = [6, 12] as const;
export type TrendMonths = (typeof TREND_MONTHS)[number];
export type MonthPoint = { month: string; sales: number; netProfit: number };

export function parseTrendMonths(raw: string | null): TrendMonths {
    return Number(raw) === 6 ? 6 : 12;
}

/** Sales after returns, before GST (the Sales Accounts group), and the P&L's net profit. */
async function computeMonth(month: string): Promise<MonthPoint> {
    const from = new Date(`${month}-01T00:00:00Z`);
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    const { sales: salesIds } = await loadSalesAccounts();
    const [sums, netProfit] = await Promise.all([
        salesIds.length
            ? prisma.voucherGlLine.groupBy({
                by: ["type"],
                _sum: { amount: true },
                where: { accountId: { in: salesIds }, universalVoucher: { status: "POSTED", date: { gte: from, lte: to } } },
            })
            : Promise.resolve([]),
        netProfitLoss(from, to),
    ]);
    const amt = (t: string) => Number(sums.find((r) => r.type === t)?._sum.amount ?? 0);
    return { month, sales: amt("CREDIT") - amt("DEBIT"), netProfit };
}

const loadSalesAccounts = unstable_cache(
    async () => {
        const groups = await prisma.accountGroup.findMany({ select: { id: true, parentId: true, name: true } });
        const root = groups.find((g) => g.name === ACCOUNT_GROUPS.SALES_ACCOUNTS);
        if (!root) return { sales: [] as number[] };
        const ids = new Set([root.id]);
        for (let grew = true; grew; ) {
            grew = false;
            for (const g of groups) if (g.parentId != null && ids.has(g.parentId) && !ids.has(g.id)) { ids.add(g.id); grew = true; }
        }
        const accounts = await prisma.account.findMany({ where: { groupId: { in: [...ids] } }, select: { id: true } });
        return { sales: accounts.map((a) => a.id) };
    },
    ["home:sales-accounts"],
    { revalidate: 600 },
);

// A closed month only moves on a back-dated entry: keep it for hours.
const pastMonth = unstable_cache(computeMonth, ["home:month:past"], { revalidate: 6 * 3600 });
const thisMonth = unstable_cache(computeMonth, ["home:month:current"], { revalidate: 300 });

export async function loadMonthlyTrend(months: TrendMonths): Promise<MonthPoint[]> {
    const now = businessTodayIso().slice(0, 7);
    const [y, m] = now.split("-").map(Number);
    const list: string[] = [];
    for (let i = months - 1; i >= 0; i--) {
        const d = new Date(Date.UTC(y, m - 1 - i, 1));
        list.push(d.toISOString().slice(0, 7));
    }
    return Promise.all(list.map((mo) => (mo === now ? thisMonth(mo) : pastMonth(mo))));
}
