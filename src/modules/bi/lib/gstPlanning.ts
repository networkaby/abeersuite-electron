// GST purchase planning — purchase (GST parties only), sale, and bank / OD
// deposit, each computed from vouchers and each manually overridable.
//
// The model splits the three figures by whether you can steer them:
//
//   • Purchase is UNCONTROLLABLE — it is whatever suppliers bill. Finished
//     months use actuals; unfinished months are forecast from the average of
//     the last few months with data.
//   • Sale and bank deposit are CONTROLLABLE, so the plan states targets rather
//     than predictions. FY sale target = FY purchase + allowedDiff (one signed
//     figure you set). FY deposit ceiling = sale target less the gap %.
//
// Both allowances are YEARLY, never monthly. A month is not judged on its own —
// it just consumes from the year's allowance, and whatever is left is spread
// over the months still to come. That is how an early overshoot gets corrected:
// it lowers the pace the rest of the year is allowed, rather than failing.
//
// On top sits the presumptive income-tax test, run against BOTH the sale target
// and the deposit ceiling — either can push deemed income past the free limit.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { endOfDayUtc, startOfDayUtc } from "@/shared/lib/format/formatDate";
import { isBankGroupName, isOdGroupName } from "@/modules/accountancy/lib/bankParticulars";
import { loadPurchaseLines } from "@/modules/bi/lib/purchaseLines";
import { SALE_RETURN_TYPE, SALE_TYPES, r2 } from "@/modules/bi/lib/marginEngine";

export interface GstPartyPurchaseRow {
    accountId: number;
    name: string;
    gstin: string;
    purchaseBills: number;
    purchase: number;
}

export interface BankLedgerOption {
    id: number;
    name: string;
    accountNumber: string;
    kind: "bank" | "od";
}

export interface GstPlanningConfig {
    taxRatePercent: number;
    depositGapPercent: number;
    /** Slice of bank deposit the government deems income (presumptive taxation). */
    presumptiveRatePercent: number;
    /** Deemed income below this pays no income tax. */
    incomeTaxFreeLimit: number;
    /** Bank / OD ledgers whose deposits count — picked once, used everywhere. */
    bankAccountIds: number[];
}

/**
 * The FY-level presumptive test for ONE base: deemed income against the
 * tax-free limit. Run against sale and against bank deposit alike — under
 * presumptive taxation turnover is the statutory base, and deposit is the cash
 * proxy the department actually sees, so either one can breach first.
 */
export interface PresumptiveCheck {
    /** What was tested — FY sale, or FY bank deposit. */
    base: number;
    presumptiveIncome: number;
    taxFreeLimit: number;
    /** The base at which deemed income exactly reaches the limit. */
    maxBase: number;
    /** Base still available before income tax starts. Negative once over. */
    headroom: number;
    withinLimit: boolean;
}

/** Both presumptive tests plus the combined verdict the UI alerts on. */
export interface PresumptiveVerdict {
    sale: PresumptiveCheck;
    deposit: PresumptiveCheck;
    /** True only while BOTH bases stay inside the free limit. */
    withinLimit: boolean;
}

/** One figure: what the vouchers say, what you typed, and which one is in play. */
export interface PlanningFigure {
    computed: number;
    override: number | null;
    effective: number;
    isOverridden: boolean;
}

export interface GstPlanningMonthRow {
    yearMonth: string;
    monthLabel: string;
    purchase: PlanningFigure;
    sale: PlanningFigure;
    deposit: PlanningFigure;
    /** Value addition — sale − purchase. Negative when purchase leads. */
    valueAddition: number;
    /** Output tax on sale. */
    outputTax: number;
    /** Input tax on purchase. */
    inputTax: number;
    /**
     * This month's GST cost — output tax less input tax, i.e. value addition at
     * the tax rate. Negative when purchase leads, and that surplus is carried
     * into the next month rather than lost.
     */
    cost: number;
    /** Carried forward from the previous months of the FY. */
    carriedIn: number;
    /** carriedIn + cost — the final payable tax to date, positive or negative. */
    finalPayable: number;
    /** This month's deposit ceiling = sale × (1 − depositGap%). */
    maxDeposit: number;
    /** Ceiling less deposit — spare room this month, negative when over. */
    depositRoom: number;
    /** Spare room carried in from the earlier months of the FY. */
    depositCarriedIn: number;
    /** depositCarriedIn + depositRoom — the limit still in hand, positive or negative. */
    depositLimitLeft: number;
    /** How far this month alone went past its own ceiling. */
    depositExcess: number;
    /** Judged on the running limit, so an earlier month's spare room can absorb it. */
    depositOk: boolean;
}

export interface GstPlanningFyRow {
    fyStartYear: number;
    label: string;
    /** The one steering figure — targeted gap between FY purchase and FY sale. */
    allowedDiff: number;
    /** The FY's own cost — the sum of its twelve months, positive or negative. */
    costThisFy: number;
}

/**
 * One yearly allowance and how much of it is left. Both the sale allowance and
 * the deposit allowance take this shape, so the UI renders them identically.
 */
export interface YearlyAllowance {
    /** The full-year permission. */
    target: number;
    /** Consumed by the months already gone, including the part-finished current one. */
    used: number;
    /** target − used. Negative once the year's allowance is already spent. */
    left: number;
    /** Months still available to spend it in, current month included. */
    monthsLeft: number;
    /** left ÷ monthsLeft — the pace needed from here. Zero when no months remain. */
    perMonth: number;
    /** False once `left` has gone negative — the year is already over its allowance. */
    withinAllowance: boolean;
}

/**
 * The whole plan for one FY: what purchase is expected to be, what sale that
 * permits, what deposit that permits, and the pace each needs from here.
 */
export interface GstPlanningFyPlan {
    purchase: { actual: number; forecast: number; total: number };
    allowedDiff: number;
    sale: YearlyAllowance;
    deposit: YearlyAllowance;
    /** Projected FY GST cost — allowedDiff at the tax rate. Negative = credit. */
    cost: number;
}

export const DEFAULT_PLANNING_CONFIG: GstPlanningConfig = {
    taxRatePercent: 18,
    depositGapPercent: 10,
    presumptiveRatePercent: 8,
    incomeTaxFreeLimit: 1200000,
    bankAccountIds: [],
};

/** Parse stored JSON bank / OD ledger ids. */
export function parseBankAccountIds(json: unknown): number[] {
    if (!Array.isArray(json)) return [];
    return [...new Set(json.filter((x): x is number => typeof x === "number" && x > 0))];
}

/** Parse "YYYY-MM" into UTC calendar-month bounds. */
export function monthBounds(yearMonth: string): { from: Date; to: Date } {
    const m = /^(\d{4})-(\d{2})$/.exec(yearMonth);
    if (!m) throw new Error("Invalid month — use YYYY-MM.");
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (month < 1 || month > 12) throw new Error("Invalid month — use YYYY-MM.");
    const from = startOfDayUtc(`${year}-${String(month).padStart(2, "0")}-01`);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const to = endOfDayUtc(`${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`);
    return { from, to };
}

/** FY runs April–March; fyStartYear 2026 = 1 Apr 2026 → 31 Mar 2027. */
export function fyBounds(fyStartYear: number): { from: Date; to: Date } {
    return {
        from: startOfDayUtc(`${fyStartYear}-04-01`),
        to: endOfDayUtc(`${fyStartYear + 1}-03-31`),
    };
}

export function fyLabel(fyStartYear: number): string {
    return `FY ${fyStartYear}-${String((fyStartYear + 1) % 100).padStart(2, "0")}`;
}

/** The twelve months of a financial year, April first. */
export function fyMonths(fyStartYear: number): string[] {
    return Array.from({ length: 12 }, (_, i) => {
        const month = ((3 + i) % 12) + 1;
        const year = i < 9 ? fyStartYear : fyStartYear + 1;
        return `${year}-${String(month).padStart(2, "0")}`;
    });
}

/** Which FY a "YYYY-MM" belongs to — Jan–Mar fall back into the previous FY. */
export function fyStartYearOf(yearMonth: string): number {
    const m = /^(\d{4})-(\d{2})$/.exec(yearMonth);
    if (!m) throw new Error("Invalid month — use YYYY-MM.");
    const year = Number(m[1]);
    const month = Number(m[2]);
    return month >= 4 ? year : year - 1;
}

export function monthLabel(yearMonth: string): string {
    const m = /^(\d{4})-(\d{2})$/.exec(yearMonth);
    if (!m) return yearMonth;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
    return d.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
}

function yearMonthFromDate(d: Date): string {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Today's "YYYY-MM" — the line between finished months and forecast ones. */
function currentYearMonth(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function figure(computed: number, override: number | null): PlanningFigure {
    const isOverridden = override !== null;
    return {
        computed: r2(computed),
        override: isOverridden ? r2(override) : null,
        effective: r2(isOverridden ? override : computed),
        isOverridden,
    };
}

// ── config ───────────────────────────────────────────────────────────────────

/** The editable numbers — bankAccountIds is a list and is handled separately. */
export const PLANNING_CONFIG_NUMBER_KEYS = [
    "taxRatePercent",
    "depositGapPercent",
    "presumptiveRatePercent",
    "incomeTaxFreeLimit",
] as const;

type ConfigRow = {
    taxRatePercent: unknown;
    depositGapPercent: unknown;
    presumptiveRatePercent: unknown;
    incomeTaxFreeLimit: unknown;
    bankAccountIds: unknown;
};

function toConfig(row: ConfigRow): GstPlanningConfig {
    return {
        taxRatePercent: toNumber(row.taxRatePercent as number),
        depositGapPercent: toNumber(row.depositGapPercent as number),
        presumptiveRatePercent: toNumber(row.presumptiveRatePercent as number),
        incomeTaxFreeLimit: toNumber(row.incomeTaxFreeLimit as number),
        bankAccountIds: parseBankAccountIds(row.bankAccountIds),
    };
}

export async function loadPlanningConfig(): Promise<GstPlanningConfig> {
    const row = await prisma.biGstPlanningConfig.findUnique({ where: { id: 1 } });
    return row ? toConfig(row) : { ...DEFAULT_PLANNING_CONFIG };
}

export async function savePlanningConfig(data: Partial<GstPlanningConfig>): Promise<GstPlanningConfig> {
    const writable = {
        ...Object.fromEntries(
            PLANNING_CONFIG_NUMBER_KEYS.filter((k) => data[k] !== undefined).map((k) => [k, data[k]]),
        ),
        ...(data.bankAccountIds !== undefined ? { bankAccountIds: data.bankAccountIds } : {}),
    };
    const row = await prisma.biGstPlanningConfig.upsert({
        where: { id: 1 },
        create: { id: 1, ...DEFAULT_PLANNING_CONFIG, ...writable },
        update: writable,
    });
    return toConfig(row);
}

// ── computed sources ─────────────────────────────────────────────────────────

async function gstinByAccountId(accountIds: number[]): Promise<Map<number, string>> {
    if (accountIds.length === 0) return new Map();
    const accounts = await prisma.account.findMany({
        where: { id: { in: accountIds } },
        select: {
            id: true,
            person: { select: { gstin: true } },
            company: { select: { gstin: true } },
        },
    });
    const out = new Map<number, string>();
    for (const a of accounts) {
        const gstin = a.person?.gstin ?? a.company?.gstin ?? null;
        if (gstin) out.set(a.id, gstin);
    }
    return out;
}

export async function loadGstPartyPurchases(from: Date, to: Date, branchId?: string | null): Promise<GstPartyPurchaseRow[]> {
    const purchases = await loadPurchaseLines({ from, to, branchId });
    const byParty = new Map<number, { bills: Set<number>; purchase: number }>();

    for (const p of purchases) {
        if (!p.accountId) continue;
        const row = byParty.get(p.accountId) ?? { bills: new Set<number>(), purchase: 0 };
        row.bills.add(p.voucherId);
        row.purchase += p.value;
        byParty.set(p.accountId, row);
    }

    const accountIds = [...byParty.keys()];
    const [gstMap, accounts] = await Promise.all([
        gstinByAccountId(accountIds),
        prisma.account.findMany({
            where: { id: { in: accountIds } },
            select: { id: true, name: true },
        }),
    ]);
    const nameById = new Map(accounts.map((a) => [a.id, a.name]));

    return accountIds
        .filter((id) => gstMap.has(id))
        .map((accountId) => {
            const agg = byParty.get(accountId)!;
            return {
                accountId,
                name: nameById.get(accountId) ?? `Account #${accountId}`,
                gstin: gstMap.get(accountId)!,
                purchaseBills: agg.bills.size,
                purchase: r2(agg.purchase),
            };
        })
        .sort((a, b) => b.purchase - a.purchase);
}

/** Purchase from GST parties only, bucketed by calendar month. */
export async function loadGstPurchaseByMonth(
    from: Date,
    to: Date,
    branchId?: string | null,
): Promise<Map<string, number>> {
    const purchases = await loadPurchaseLines({ from, to, branchId });
    const partyIds = [...new Set(purchases.map((p) => p.accountId).filter((id): id is number => id != null))];
    const gstMap = await gstinByAccountId(partyIds);
    const byMonth = new Map<string, number>();

    for (const p of purchases) {
        if (!p.accountId || !gstMap.has(p.accountId)) continue;
        const key = yearMonthFromDate(p.date);
        byMonth.set(key, r2((byMonth.get(key) ?? 0) + p.value));
    }
    return byMonth;
}

/** Total pre-tax sale (all customers, SALE_RETURN negated), bucketed by month. */
export async function loadSaleByMonth(
    from: Date,
    to: Date,
    branchId?: string | null,
): Promise<Map<string, number>> {
    const lines = await prisma.voucherInventoryLine.findMany({
        where: {
            universalVoucher: {
                type: { in: [...SALE_TYPES, SALE_RETURN_TYPE] },
                status: "POSTED",
                date: { gte: from, lte: to },
                ...(branchId ? { branchId } : {}),
            },
        },
        select: {
            amount: true,
            taxAmount: true,
            universalVoucher: { select: { type: true, date: true } },
        },
    });

    const byMonth = new Map<string, number>();
    for (const l of lines) {
        const sign = l.universalVoucher.type === SALE_RETURN_TYPE ? -1 : 1;
        const value = (toNumber(l.amount) - toNumber(l.taxAmount)) * sign;
        const key = yearMonthFromDate(l.universalVoucher.date);
        byMonth.set(key, r2((byMonth.get(key) ?? 0) + value));
    }
    return byMonth;
}

/** Sum DEBIT legs on one or more bank / OD ledgers in the period. */
export async function loadBankDepositsTotal(
    bankAccountIds: number[],
    from: Date,
    to: Date,
    branchId?: string | null,
): Promise<number> {
    if (bankAccountIds.length === 0) return 0;
    const agg = await prisma.voucherGlLine.aggregate({
        where: {
            accountId: { in: bankAccountIds },
            type: "DEBIT",
            universalVoucher: {
                status: "POSTED",
                date: { gte: from, lte: to },
                ...(branchId ? { branchId } : {}),
            },
        },
        _sum: { amount: true },
    });
    return r2(toNumber(agg._sum.amount ?? 0));
}

export async function loadBankAccountOptions(): Promise<BankLedgerOption[]> {
    const rows = await prisma.account.findMany({
        where: { isActive: true, group: { isActive: true } },
        select: { id: true, name: true, bankJson: true, group: { select: { name: true } } },
        orderBy: { name: "asc" },
    });
    return rows
        .filter((a) => isBankGroupName(a.group?.name))
        .map((a) => {
            const bank = a.bankJson as { accountNumber?: string } | null;
            return {
                id: a.id,
                name: a.name,
                accountNumber: typeof bank?.accountNumber === "string" ? bank.accountNumber : "",
                kind: isOdGroupName(a.group?.name) ? "od" as const : "bank" as const,
            };
        });
}

/** FY-start-year span of the earliest/latest voucher on record — drives the FY picker's range. */
export async function getGstPlanningDataFyRange(): Promise<{ min: number; max: number } | null> {
    const agg = await prisma.universalVoucher.aggregate({
        _min: { date: true },
        _max: { date: true },
    });
    if (!agg._min.date || !agg._max.date) return null;
    const toFyStart = (d: Date) => (d.getUTCMonth() + 1 >= 4 ? d.getUTCFullYear() : d.getUTCFullYear() - 1);
    return { min: toFyStart(agg._min.date), max: toFyStart(agg._max.date) };
}

export async function validateBankAccountIds(ids: number[]): Promise<boolean> {
    if (ids.length === 0) return true;
    const allowed = new Set((await loadBankAccountOptions()).map((b) => b.id));
    return ids.every((id) => allowed.has(id));
}

// ── stored rows ──────────────────────────────────────────────────────────────

export async function loadGstPlanningMonth(yearMonth: string) {
    return prisma.biGstPlanningMonth.findUnique({ where: { yearMonth } });
}

export async function loadGstPlanningMonths(yearMonths: string[]) {
    if (yearMonths.length === 0) return [];
    return prisma.biGstPlanningMonth.findMany({ where: { yearMonth: { in: yearMonths } } });
}

export interface MonthPatch {
    purchaseOverride?: number | null;
    saleOverride?: number | null;
    depositOverride?: number | null;
}

export async function upsertGstPlanningMonth(yearMonth: string, data: MonthPatch) {
    const writable = {
        ...(data.purchaseOverride !== undefined ? { purchaseOverride: data.purchaseOverride } : {}),
        ...(data.saleOverride !== undefined ? { saleOverride: data.saleOverride } : {}),
        ...(data.depositOverride !== undefined ? { depositOverride: data.depositOverride } : {}),
    };
    return prisma.biGstPlanningMonth.upsert({
        where: { yearMonth },
        create: { yearMonth, ...writable },
        update: writable,
    });
}

export async function loadFyRow(fyStartYear: number) {
    return prisma.biGstPlanningFy.findUnique({ where: { fyStartYear } });
}

export interface FyPatch {
    allowedDiff?: number;
}

export async function upsertFyRow(fyStartYear: number, data: FyPatch) {
    const writable = data.allowedDiff !== undefined ? { allowedDiff: data.allowedDiff } : {};
    return prisma.biGstPlanningFy.upsert({
        where: { fyStartYear },
        create: { fyStartYear, allowedDiff: 0, ...writable },
        update: writable,
    });
}

// ── maths ────────────────────────────────────────────────────────────────────

export interface MonthTax {
    valueAddition: number;
    outputTax: number;
    inputTax: number;
    cost: number;
}

/**
 * One month's tax. Output tax on sale less input tax on purchase — the same
 * thing as taxing the value addition — so a month that buys more than it sells
 * comes out negative and that surplus carries into the next month.
 */
export function monthTax(purchase: number, sale: number, taxRatePercent: number): MonthTax {
    const rate = taxRatePercent / 100;
    const outputTax = r2(Math.max(0, sale) * rate);
    const inputTax = r2(Math.max(0, purchase) * rate);
    return {
        valueAddition: r2(sale - purchase),
        outputTax,
        inputTax,
        cost: r2(outputTax - inputTax),
    };
}

/** Deposit ceiling — deposit must sit depositGap% below sale. */
export function depositCeiling(sale: number, depositGapPercent: number): number {
    return r2(Math.max(0, sale) * (1 - depositGapPercent / 100));
}

/**
 * The presumptive test for one base. The government deems presumptiveRate% of
 * the base to be income; while that deemed income stays under
 * incomeTaxFreeLimit, no income tax falls due. Inverting the rate gives the
 * ceiling to plan against.
 */
export function presumptiveCheck(base: number, config: GstPlanningConfig): PresumptiveCheck {
    const rate = config.presumptiveRatePercent / 100;
    const presumptiveIncome = r2(Math.max(0, base) * rate);
    const maxBase = rate > 0 ? r2(config.incomeTaxFreeLimit / rate) : 0;
    return {
        base: r2(base),
        presumptiveIncome,
        taxFreeLimit: r2(config.incomeTaxFreeLimit),
        maxBase,
        headroom: r2(maxBase - base),
        withinLimit: presumptiveIncome <= config.incomeTaxFreeLimit,
    };
}

/** Test sale and deposit together — either breaching means income tax starts. */
export function presumptiveVerdict(
    sale: number,
    deposit: number,
    config: GstPlanningConfig,
): PresumptiveVerdict {
    const saleCheck = presumptiveCheck(sale, config);
    const depositCheck = presumptiveCheck(deposit, config);
    return {
        sale: saleCheck,
        deposit: depositCheck,
        withinLimit: saleCheck.withinLimit && depositCheck.withinLimit,
    };
}

/**
 * Turn a yearly target into a pace. Months already gone have consumed part of
 * the allowance; what is left is spread over the months still to come — which
 * is exactly how an early overshoot gets corrected: it does not fail the year,
 * it just lowers the pace the rest of the year is allowed.
 */
export function yearlyAllowance(
    target: number,
    used: number,
    monthsLeft: number,
): YearlyAllowance {
    const left = r2(target - used);
    return {
        target: r2(target),
        used: r2(used),
        left,
        monthsLeft,
        perMonth: monthsLeft > 0 ? r2(left / monthsLeft) : 0,
        withinAllowance: left >= 0,
    };
}

/** An FY's cost — the sum of its months, each already signed. */
export function fyNetCost(months: Pick<GstPlanningMonthRow, "cost">[]): number {
    return r2(months.reduce((s, m) => s + m.cost, 0));
}

// ── FY assembly ──────────────────────────────────────────────────────────────

/**
 * Build the twelve month rows of one FY. `bankAccountIds` is the year's single
 * selection — one deposit aggregate per month runs against it. Pass an empty
 * array to skip the deposit queries entirely (cost doesn't depend on them).
 */
export async function loadFyMonthRows(
    fyStartYear: number,
    config: GstPlanningConfig,
    bankAccountIds: number[],
    branchId?: string | null,
): Promise<GstPlanningMonthRow[]> {
    const yearMonths = fyMonths(fyStartYear);
    const { from, to } = fyBounds(fyStartYear);

    const [savedRows, purchaseByMonth, saleByMonth] = await Promise.all([
        loadGstPlanningMonths(yearMonths),
        loadGstPurchaseByMonth(from, to, branchId),
        loadSaleByMonth(from, to, branchId),
    ]);
    const savedByMonth = new Map(savedRows.map((r) => [r.yearMonth, r]));

    // Figures first — the deposit aggregates are independent, so fetch in parallel.
    const base = await Promise.all(yearMonths.map(async (yearMonth) => {
        const saved = savedByMonth.get(yearMonth);
        const bounds = monthBounds(yearMonth);

        const purchase = figure(
            purchaseByMonth.get(yearMonth) ?? 0,
            saved?.purchaseOverride != null ? toNumber(saved.purchaseOverride) : null,
        );
        const sale = figure(
            saleByMonth.get(yearMonth) ?? 0,
            saved?.saleOverride != null ? toNumber(saved.saleOverride) : null,
        );
        const computedDeposit = saved?.depositOverride != null
            ? 0 // override wins — skip the query
            : await loadBankDepositsTotal(bankAccountIds, bounds.from, bounds.to, branchId);
        const deposit = figure(
            computedDeposit,
            saved?.depositOverride != null ? toNumber(saved.depositOverride) : null,
        );

        return { yearMonth, purchase, sale, deposit };
    }));

    return chainMonths(base, config);
}

/** The bare figures a month is built from — everything else is derived. */
export interface MonthBaseFigures {
    yearMonth: string;
    purchase: PlanningFigure;
    sale: PlanningFigure;
    deposit: PlanningFigure;
}

/**
 * Walk the months in order — each month opens with the running totals the
 * previous ones left behind, for cost and for deposit limit alike. Shared by the
 * actual rows and by the forecast replay, so both chain identically.
 */
export function chainMonths(
    base: MonthBaseFigures[],
    config: GstPlanningConfig,
): GstPlanningMonthRow[] {
    let carried = 0;
    let depositCarried = 0;
    return base.map((b) => {
        const tax = monthTax(b.purchase.effective, b.sale.effective, config.taxRatePercent);
        const carriedIn = carried;
        carried = r2(carriedIn + tax.cost);

        const maxDeposit = depositCeiling(b.sale.effective, config.depositGapPercent);
        const depositRoom = r2(maxDeposit - b.deposit.effective);
        const depositCarriedIn = depositCarried;
        depositCarried = r2(depositCarriedIn + depositRoom);

        return {
            yearMonth: b.yearMonth,
            monthLabel: monthLabel(b.yearMonth),
            purchase: b.purchase,
            sale: b.sale,
            deposit: b.deposit,
            ...tax,
            carriedIn,
            finalPayable: carried,
            maxDeposit,
            depositRoom,
            depositCarriedIn,
            depositLimitLeft: depositCarried,
            depositExcess: r2(Math.max(0, -depositRoom)),
            depositOk: depositCarried >= 0,
        };
    });
}

// ── purchase forecast ────────────────────────────────────────────────────────
//
// Purchase is the one figure that cannot be steered — it is whatever the
// suppliers bill. Months that have not finished hold no vouchers yet, so their
// purchase is predicted from the average of the last few months that DO have
// data. Sale and deposit are deliberately NOT forecast: they are controllable,
// so the plan states what they should be rather than guessing what they will be.
//
// Display-only — nothing is written, and a real voucher or a manual override
// always wins once it exists.

/** How many trailing months of real data the average is drawn from, at most. */
export const FORECAST_BASIS_MONTHS = 6;

export interface PurchaseForecast {
    /** The months the average came from, newest last. Empty = nothing to forecast from. */
    basisMonths: string[];
    /** Average monthly purchase across the basis months. */
    perMonth: number;
    /** Predicted purchase per unfinished month, keyed by yearMonth. */
    months: Record<string, number>;
    /** Purchase already on the books for finished months of this FY. */
    actualTotal: number;
    /** Predicted purchase across the FY's unfinished months. */
    forecastTotal: number;
    /** actualTotal + forecastTotal — the FY purchase the plan is built on. */
    total: number;
}

/** A month counts as "having data" only if purchase actually moved in it. */
const monthHasPurchase = (m: GstPlanningMonthRow) => m.purchase.effective > 0;

/**
 * A month is KNOWN once there is nothing left to predict about it: it is in the
 * past, or it already carries figures (booked or hand-entered). Known months
 * always use their actuals — including the current month, whose real trade must
 * never be replaced by a forecast. Only genuinely empty months get predicted.
 */
export function isKnownMonth(m: GstPlanningMonthRow, todayYearMonth: string): boolean {
    return m.yearMonth < todayYearMonth
        || m.purchase.isOverridden || m.sale.isOverridden || m.deposit.isOverridden
        || m.purchase.effective > 0 || m.sale.effective > 0 || m.deposit.effective > 0;
}

/**
 * Forecast the FY's purchase. `months` are that FY's rows and `earlierMonths`
 * the preceding FY's, used only when the FY itself does not yet hold enough
 * finished months to average (e.g. the current month is April).
 */
export function buildPurchaseForecast(
    months: GstPlanningMonthRow[],
    earlierMonths: GstPlanningMonthRow[],
    todayYearMonth: string,
): PurchaseForecast {
    // Basis = the newest months that have purchase and nothing left to predict.
    // The current month only qualifies once it is hand-entered — otherwise its
    // part-month figure would drag the average down.
    const basisRows = [...earlierMonths, ...months]
        .filter((m) => monthHasPurchase(m)
            && (m.yearMonth < todayYearMonth || m.purchase.isOverridden))
        .slice(-FORECAST_BASIS_MONTHS);

    const perMonth = basisRows.length === 0
        ? 0
        : r2(basisRows.reduce((s, m) => s + m.purchase.effective, 0) / basisRows.length);

    // Only a genuinely empty month is forecast — anything already known keeps
    // its own figures.
    const isForecastMonth = (m: GstPlanningMonthRow) =>
        basisRows.length > 0 && !isKnownMonth(m, todayYearMonth);

    const forecastMonths: Record<string, number> = {};
    let actualTotal = 0;
    let forecastTotal = 0;
    for (const m of months) {
        if (isForecastMonth(m)) {
            forecastMonths[m.yearMonth] = perMonth;
            forecastTotal = r2(forecastTotal + perMonth);
        } else {
            actualTotal = r2(actualTotal + m.purchase.effective);
        }
    }

    return {
        basisMonths: basisRows.map((m) => m.yearMonth),
        perMonth,
        months: forecastMonths,
        actualTotal,
        forecastTotal,
        total: r2(actualTotal + forecastTotal),
    };
}

/**
 * Per-month guidance: what a month should do, and how much of the year's
 * allowance survives it. Finished months carry no suggestion — they are done —
 * and simply draw down the limit by what actually happened.
 */
export interface MonthGuide {
    /** Pace this month should hit. Null for months already finished. */
    suggestedSale: number | null;
    suggestedDeposit: number | null;
    /** Year's sale allowance still unspent after this month. */
    saleLimitLeft: number;
    /** Year's deposit allowance still unspent after this month. */
    depositLimitLeft: number;
    /**
     * True when the month already has its own figures (past, booked, or
     * hand-entered). False means the row is pure projection — so the UI blanks
     * it when suggestions are switched off.
     */
    hasData: boolean;
}

/**
 * Walk the FY accruing each allowance as the trade that earns it happens.
 *
 * The limits are RUNNING BALANCES, not the yearly total less what is spent —
 * the year's full sale allowance is not available in April, because the
 * purchase that earns it has not been billed yet. So at any month:
 *
 *   sale limit left    = purchase to date + allowedDiff − sale to date
 *   deposit limit left = (sale to date less the gap %) − deposit to date
 *
 * Both land on zero at March once the suggested pace is followed, and both go
 * negative the moment you are running ahead of what has been earned.
 */
export function buildMonthGuides(
    months: GstPlanningMonthRow[],
    plan: GstPlanningFyPlan,
    purchaseForecast: PurchaseForecast,
    config: GstPlanningConfig,
    todayYearMonth: string,
): Record<string, MonthGuide> {
    const guides: Record<string, MonthGuide> = {};
    let purchaseToDate = 0;
    let saleToDate = 0;
    let depositToDate = 0;

    for (const m of months) {
        const known = isKnownMonth(m, todayYearMonth);
        // Known months state their own figures; only empty ones take a share of
        // what the year has left, split equally between them.
        const suggestedSale = known ? null : plan.sale.perMonth;
        const suggestedDeposit = known ? null : plan.deposit.perMonth;

        purchaseToDate = r2(purchaseToDate
            + (purchaseForecast.months[m.yearMonth] ?? m.purchase.effective));
        saleToDate = r2(saleToDate + (suggestedSale ?? m.sale.effective));
        depositToDate = r2(depositToDate + (suggestedDeposit ?? m.deposit.effective));

        guides[m.yearMonth] = {
            suggestedSale,
            suggestedDeposit,
            // Sale may run ahead of purchase only by the allowed difference.
            saleLimitLeft: r2(purchaseToDate + plan.allowedDiff - saleToDate),
            // Deposit must stay the gap % below the sale actually made.
            depositLimitLeft: r2(
                depositCeiling(saleToDate, config.depositGapPercent) - depositToDate,
            ),
            hasData: known,
        };
    }
    return guides;
}

/**
 * The slack standing after the last month that has figures, split equally over
 * every month still to run — the current one included, since it is not finished
 * and can still absorb part of it. This is the "how much extra may each month
 * take" number, as distinct from the suggested total for an empty month.
 */
export interface Headroom {
    /** Slack carried at the last month with data. */
    saleSlack: number;
    depositSlack: number;
    /** Months it is split across — current month through March. */
    months: number;
    /** saleSlack ÷ months. */
    salePerMonth: number;
    depositPerMonth: number;
}

export function buildHeadroom(
    months: GstPlanningMonthRow[],
    guides: Record<string, MonthGuide>,
    todayYearMonth: string,
): Headroom {
    // Slack as it stands after the last month that actually has figures.
    const known = months.filter((m) => guides[m.yearMonth]?.hasData);
    const last = known.length > 0 ? guides[known[known.length - 1].yearMonth] : undefined;
    const saleSlack = last?.saleLimitLeft ?? 0;
    const depositSlack = last?.depositLimitLeft ?? 0;

    // Every month from the current one to the end of the FY can still take a share.
    const open = months.filter((m) => m.yearMonth >= todayYearMonth).length;

    return {
        saleSlack,
        depositSlack,
        months: open,
        salePerMonth: open > 0 ? r2(saleSlack / open) : 0,
        depositPerMonth: open > 0 ? r2(depositSlack / open) : 0,
    };
}

/**
 * Build the whole FY plan from the forecast purchase and the one allowed
 * difference. Everything downstream — sale target, deposit ceiling, the pace
 * each still needs — falls out of those two figures.
 */
export function buildFyPlan(input: {
    purchase: PurchaseForecast;
    allowedDiff: number;
    saleUsed: number;
    depositUsed: number;
    monthsLeft: number;
    config: GstPlanningConfig;
}): GstPlanningFyPlan {
    const saleTarget = r2(input.purchase.total + input.allowedDiff);
    const depositTarget = depositCeiling(saleTarget, input.config.depositGapPercent);

    return {
        purchase: {
            actual: input.purchase.actualTotal,
            forecast: input.purchase.forecastTotal,
            total: input.purchase.total,
        },
        allowedDiff: r2(input.allowedDiff),
        sale: yearlyAllowance(saleTarget, input.saleUsed, input.monthsLeft),
        deposit: yearlyAllowance(depositTarget, input.depositUsed, input.monthsLeft),
        // Value addition across the year IS the allowed difference, so the GST
        // cost is simply that at the tax rate. Negative = credit in hand.
        cost: r2(input.allowedDiff * (input.config.taxRatePercent / 100)),
    };
}

export async function loadGstPlanningFy(
    fyStartYear: number,
    opts: { branchId?: string | null; lookbackYears?: number; todayYearMonth?: string } = {},
): Promise<{
    config: GstPlanningConfig;
    months: GstPlanningMonthRow[];
    fy: GstPlanningFyRow;
    totals: {
        purchase: number; sale: number; deposit: number; valueAddition: number;
        outputTax: number; inputTax: number; cost: number; maxDeposit: number;
        /** The FY's closing deposit limit — spare room left after every month. */
        depositLimitLeft: number;
    };
    presumptive: PresumptiveVerdict;
    plan: GstPlanningFyPlan;
    /** The same plan with the forecast dropped — purchase is only what is booked. */
    planBooked: GstPlanningFyPlan;
    /** Presumptive test run against `planBooked`, so it too carries no forecast. */
    presumptiveBooked: PresumptiveVerdict;
    purchaseForecast: PurchaseForecast;
    monthGuides: Record<string, MonthGuide>;
    headroom: Headroom;
}> {
    const config = await loadPlanningConfig();
    const [saved, months, earlierMonths] = await Promise.all([
        loadFyRow(fyStartYear),
        loadFyMonthRows(fyStartYear, config, config.bankAccountIds, opts.branchId),
        // Only needed so an FY that has barely started can still average the
        // months just before it.
        loadFyMonthRows(fyStartYear - 1, config, config.bankAccountIds, opts.branchId),
    ]);

    const totals = months.reduce(
        (t, m) => ({
            purchase: r2(t.purchase + m.purchase.effective),
            sale: r2(t.sale + m.sale.effective),
            deposit: r2(t.deposit + m.deposit.effective),
            valueAddition: r2(t.valueAddition + m.valueAddition),
            outputTax: r2(t.outputTax + m.outputTax),
            inputTax: r2(t.inputTax + m.inputTax),
            cost: r2(t.cost + m.cost),
            maxDeposit: r2(t.maxDeposit + m.maxDeposit),
            depositLimitLeft: m.depositLimitLeft,
        }),
        {
            purchase: 0, sale: 0, deposit: 0, valueAddition: 0,
            outputTax: 0, inputTax: 0, cost: 0, maxDeposit: 0, depositLimitLeft: 0,
        },
    );

    const todayYearMonth = opts.todayYearMonth ?? currentYearMonth();
    const allowedDiff = toNumber(saved?.allowedDiff ?? 0);
    const purchaseForecast = buildPurchaseForecast(months, earlierMonths, todayYearMonth);

    // Everything already known — past months, and the current one once it has
    // figures — counts as used. What is left is shared equally between the
    // months that are still empty, which are the only ones there is room to
    // steer. Purchase is forecast on the same split, so all three agree.
    const emptyMonths = months.filter((m) => !isKnownMonth(m, todayYearMonth));
    const monthsLeft = emptyMonths.length;
    const used = months
        .filter((m) => isKnownMonth(m, todayYearMonth))
        .reduce(
            (t, m) => ({
                sale: r2(t.sale + m.sale.effective),
                deposit: r2(t.deposit + m.deposit.effective),
            }),
            { sale: 0, deposit: 0 },
        );

    const plan = buildFyPlan({
        purchase: purchaseForecast,
        allowedDiff,
        saleUsed: used.sale,
        depositUsed: used.deposit,
        monthsLeft,
        config,
    });
    // Same plan with the prediction removed — purchase is only what suppliers
    // have actually billed. This is what the UI shows once the forecast is
    // hidden, so no card quietly keeps steering on numbers the table no longer
    // displays. Only the purchase side changes; used / months-left are facts.
    const planBooked = buildFyPlan({
        purchase: {
            ...purchaseForecast,
            forecastTotal: 0,
            total: purchaseForecast.actualTotal,
        },
        allowedDiff,
        saleUsed: used.sale,
        depositUsed: used.deposit,
        monthsLeft,
        config,
    });
    const monthGuides = buildMonthGuides(months, plan, purchaseForecast, config, todayYearMonth);

    return {
        config,
        months,
        fy: {
            fyStartYear,
            label: fyLabel(fyStartYear),
            allowedDiff,
            costThisFy: fyNetCost(months),
        },
        totals,
        // Both bases tested — the sale TARGET (what the plan commits you to) and
        // the deposit ceiling, since either can push deemed income over the limit.
        presumptive: presumptiveVerdict(plan.sale.target, plan.deposit.target, config),
        plan,
        planBooked,
        presumptiveBooked: presumptiveVerdict(
            planBooked.sale.target, planBooked.deposit.target, config,
        ),
        purchaseForecast,
        monthGuides,
        headroom: buildHeadroom(months, monthGuides, todayYearMonth),
    };
}
