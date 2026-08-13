// GST purchase planning — monthly purchase (GST parties only), sale, and bank /
// OD deposit, each computed from vouchers and each manually overridable.
//
// Two rules ride on top:
//   • Bank deposit must stay a configured % below sale (default 10%).
//   • Value addition (sale − purchase) costs GST at the configured rate
//     (default 18%). That cost is budgeted per financial year (April–March):
//     budget = costLimit + extraCostPaid. Cost the budget cannot absorb carries
//     into the next FY, and keeps carrying until a budget absorbs it.

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

/** The FY-level deposit test: deemed income against the tax-free limit. */
export interface PresumptiveCheck {
    deposit: number;
    presumptiveIncome: number;
    taxFreeLimit: number;
    /** The deposit at which deemed income exactly reaches the limit. */
    maxDeposit: number;
    /** Deposit still available before income tax starts. Negative once over. */
    headroom: number;
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
    costLimit: number;
    extraCostPaid: number;
    budget: number;
    carryIn: number;
    /** The FY's own cost — the sum of its twelve months, positive or negative. */
    costThisFy: number;
    costIncurred: number;
    costAbsorbed: number;
    carryOut: number;
    remainingBudget: number;
    withinBudget: boolean;
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
                deletedAt: null,
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
                deletedAt: null,
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
    costLimit?: number;
    extraCostPaid?: number;
}

export async function upsertFyRow(fyStartYear: number, data: FyPatch) {
    const writable = {
        ...(data.costLimit !== undefined ? { costLimit: data.costLimit } : {}),
        ...(data.extraCostPaid !== undefined ? { extraCostPaid: data.extraCostPaid } : {}),
    };
    return prisma.biGstPlanningFy.upsert({
        where: { fyStartYear },
        create: { fyStartYear, costLimit: 0, extraCostPaid: 0, ...writable },
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
 * The FY deposit test. The government deems presumptiveRate% of bank deposit to
 * be income; while that deemed income stays under incomeTaxFreeLimit, no income
 * tax falls due. Inverting the rate gives the deposit ceiling to plan against.
 */
export function presumptiveCheck(deposit: number, config: GstPlanningConfig): PresumptiveCheck {
    const rate = config.presumptiveRatePercent / 100;
    const presumptiveIncome = r2(Math.max(0, deposit) * rate);
    const maxDeposit = rate > 0 ? r2(config.incomeTaxFreeLimit / rate) : 0;
    return {
        deposit: r2(deposit),
        presumptiveIncome,
        taxFreeLimit: r2(config.incomeTaxFreeLimit),
        maxDeposit,
        headroom: r2(maxDeposit - deposit),
        withinLimit: presumptiveIncome <= config.incomeTaxFreeLimit,
    };
}

/**
 * Roll one FY's cost against its budget; whatever the budget misses carries on.
 * `costThisFy` is signed, so an FY whose purchases outrun its sales lands below
 * zero and consumes no budget at all.
 */
export function rollFyBudget(input: {
    costThisFy: number;
    carryIn: number;
    costLimit: number;
    extraCostPaid: number;
}): Pick<GstPlanningFyRow, "budget" | "costIncurred" | "costAbsorbed" | "carryOut" | "remainingBudget" | "withinBudget"> {
    const budget = r2(input.costLimit + input.extraCostPaid);
    const costIncurred = r2(input.costThisFy + input.carryIn);
    // Credit in hand can't "spend" budget backwards, so absorption floors at zero.
    const costAbsorbed = r2(Math.min(Math.max(0, costIncurred), budget));
    const carryOut = r2(Math.max(0, costIncurred - budget));
    return {
        budget,
        costIncurred,
        costAbsorbed,
        carryOut,
        remainingBudget: r2(budget - costAbsorbed),
        withinBudget: carryOut === 0,
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

    // Then walk the months in order — each month opens with the running totals
    // the previous ones left behind, for cost and for deposit limit alike.
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

/**
 * The cost carry chains FY to FY, so an FY's opening carry is only knowable by
 * replaying the earlier years. `lookbackYears` bounds that replay — anything
 * older than the window is treated as settled.
 */
export async function loadFyCarryIn(
    fyStartYear: number,
    config: GstPlanningConfig,
    lookbackYears: number,
    branchId?: string | null,
): Promise<number> {
    let carry = 0;
    for (let year = fyStartYear - lookbackYears; year < fyStartYear; year++) {
        // No bank ids — the replay only needs cost, which deposits never touch.
        const [months, saved] = await Promise.all([
            loadFyMonthRows(year, config, [], branchId),
            loadFyRow(year),
        ]);
        carry = rollFyBudget({
            costThisFy: fyNetCost(months),
            carryIn: carry,
            costLimit: toNumber(saved?.costLimit ?? 0),
            extraCostPaid: toNumber(saved?.extraCostPaid ?? 0),
        }).carryOut;
    }
    return carry;
}

export async function loadGstPlanningFy(
    fyStartYear: number,
    opts: { branchId?: string | null; lookbackYears?: number } = {},
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
    presumptive: PresumptiveCheck;
    depositBreachMonths: number;
}> {
    const config = await loadPlanningConfig();
    const [saved, carryIn, months] = await Promise.all([
        loadFyRow(fyStartYear),
        loadFyCarryIn(fyStartYear, config, opts.lookbackYears ?? 1, opts.branchId),
        loadFyMonthRows(fyStartYear, config, config.bankAccountIds, opts.branchId),
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

    const costLimit = toNumber(saved?.costLimit ?? 0);
    const extraCostPaid = toNumber(saved?.extraCostPaid ?? 0);
    const netCost = fyNetCost(months);
    const rolled = rollFyBudget({ costThisFy: netCost, carryIn, costLimit, extraCostPaid });

    return {
        config,
        months,
        fy: {
            fyStartYear,
            label: fyLabel(fyStartYear),
            costLimit,
            extraCostPaid,
            carryIn,
            costThisFy: netCost,
            ...rolled,
        },
        totals,
        presumptive: presumptiveCheck(totals.deposit, config),
        depositBreachMonths: months.filter((m) => !m.depositOk).length,
    };
}
