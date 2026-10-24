"use client";

import { useCallback, useState } from "react";
import axios from "axios";
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmt } from "@/shared/lib/format/moneyInr";
import { parseAmount, isAmountChars, parseSignedAmount, isSignedAmountChars } from "@/utils/numberInput";
import { useBiQuery } from "@/modules/bi/hooks/useBiQuery";
import { KpiCard } from "@/modules/bi/components/KpiCard";
import { useValueChange } from "@/shared/hooks/useValueChange";

interface BankOption {
    id: number;
    name: string;
    accountNumber: string;
    kind: "bank" | "od";
}

interface PartyRow {
    accountId: number;
    name: string;
    gstin: string;
    purchaseBills: number;
    purchase: number;
}

interface Figure {
    computed: number;
    override: number | null;
    effective: number;
}

interface PlanningConfig {
    taxRatePercent: number;
    depositGapPercent: number;
    presumptiveRatePercent: number;
    incomeTaxFreeLimit: number;
    bankAccountIds: number[];
}

interface PresumptiveCheck {
    base: number;
    presumptiveIncome: number;
    taxFreeLimit: number;
    maxBase: number;
    headroom: number;
    withinLimit: boolean;
}

interface MonthlyReport {
    yearMonth: string;
    monthLabel: string;
    config: PlanningConfig;
    figures: { purchase: Figure; sale: Figure; deposit: Figure };
    month: {
        valueAddition: number;
        outputTax: number;
        inputTax: number;
        cost: number;
        carriedIn: number;
        finalPayable: number;
        maxDeposit: number;
        depositRoom: number;
        depositCarriedIn: number;
        depositLimitLeft: number;
        depositExcess: number;
        depositOk: boolean;
    };
    fy: { fyStartYear: number; allowedDiff: number };
    meta: { purchaseBills: number; partyCount: number };
    rows: PartyRow[];
}

interface FyMonthRow {
    yearMonth: string;
    monthLabel: string;
    purchase: Figure & { isOverridden: boolean };
    sale: Figure & { isOverridden: boolean };
    deposit: Figure & { isOverridden: boolean };
    valueAddition: number;
    outputTax: number;
    inputTax: number;
    cost: number;
    carriedIn: number;
    finalPayable: number;
    maxDeposit: number;
    depositRoom: number;
    depositCarriedIn: number;
    depositLimitLeft: number;
    depositExcess: number;
    depositOk: boolean;
}

/** A yearly permission and the pace still needed to land on it. */
interface Allowance {
    target: number;
    used: number;
    left: number;
    monthsLeft: number;
    perMonth: number;
    withinAllowance: boolean;
}

/** The year's plan: purchase it rides on, and the two allowances that fall out. */
interface FyPlan {
    purchase: { actual: number; forecast: number; total: number };
    allowedDiff: number;
    sale: Allowance;
    deposit: Allowance;
    cost: number;
}

/** Both presumptive bases tested against the income-tax free limit. */
interface PresumptiveVerdict {
    sale: PresumptiveCheck;
    deposit: PresumptiveCheck;
    withinLimit: boolean;
}

interface FyReport {
    config: PlanningConfig;
    banks: BankOption[];
    dataRange: { min: number; max: number } | null;
    months: FyMonthRow[];
    fy: {
        fyStartYear: number;
        label: string;
        allowedDiff: number;
        costThisFy: number;
    };
    totals: {
        purchase: number; sale: number; deposit: number; valueAddition: number;
        outputTax: number; inputTax: number; cost: number; maxDeposit: number;
        depositLimitLeft: number;
    };
    presumptive: PresumptiveVerdict;
    /** Presumptive test on `planBooked` — shown while the forecast is hidden. */
    presumptiveBooked: PresumptiveVerdict;
    plan: FyPlan;
    /** The plan with the forecast dropped — purchase counts only what is booked. */
    planBooked: FyPlan;
    purchaseForecast: {
        basisMonths: string[];
        perMonth: number;
        months: Record<string, number>;
        actualTotal: number;
        forecastTotal: number;
        total: number;
    };
    monthGuides: Record<string, {
        suggestedSale: number | null;
        suggestedDeposit: number | null;
        saleLimitLeft: number;
        depositLimitLeft: number;
        hasData: boolean;
    }>;
    headroom: {
        saleSlack: number;
        depositSlack: number;
        months: number;
        salePerMonth: number;
        depositPerMonth: number;
    };
}

function currentYearMonth(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** FY runs April–March, so Jan–Mar still belong to the previous starting year. */
function fyStartYearOf(yearMonth: string): number {
    const [y, m] = yearMonth.split("-").map(Number);
    return m >= 4 ? y : y - 1;
}

const fyLabel = (fyStartYear: number) =>
    `FY ${fyStartYear}-${String((fyStartYear + 1) % 100).padStart(2, "0")}`;

/** Compact "2026-27" form for the FY dropdown (no "FY" prefix — the dropdown label already says it). */
const fyShortLabel = (fyStartYear: number) =>
    `${fyStartYear}-${String((fyStartYear + 1) % 100).padStart(2, "0")}`;

/** The 12 yearMonth keys (Apr–Mar) belonging to a financial year, for the month rail. */
function fyMonths(fyStartYear: number): string[] {
    const months: string[] = [];
    for (let m = 4; m <= 12; m++) months.push(`${fyStartYear}-${String(m).padStart(2, "0")}`);
    for (let m = 1; m <= 3; m++) months.push(`${fyStartYear + 1}-${String(m).padStart(2, "0")}`);
    return months;
}

const shortMonthLabel = (yearMonth: string) => {
    const [y, m] = yearMonth.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short" });
};

/** Amount box that shows the computed figure until you type your own. */
function OverrideField({
    label,
    figure,
    hint,
    saving,
    onSave,
    onClear,
}: {
    label: string;
    figure: Figure;
    hint?: string;
    saving: boolean;
    onSave: (value: number) => void;
    onClear: () => void;
}) {
    // Seeded once — the parent re-keys this field whenever the saved value moves,
    // so the draft never needs an effect to re-sync.
    const [draft, setDraft] = useState(figure.override === null ? "" : String(figure.override));

    const submit = () => {
        if (draft.trim() === "") {
            onClear();
            return;
        }
        onSave(parseAmount(draft));
    };

    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
                <Label className="text-xs text-muted-foreground">{label}</Label>
                {figure.override !== null && (
                    <button
                        type="button"
                        onClick={onClear}
                        disabled={saving}
                        className="inline-flex items-center gap-1 text-[11px] text-amber-600 hover:underline"
                        title="Clear the manual value and go back to the computed figure"
                    >
                        <RotateCcw size={11} /> manual
                    </button>
                )}
            </div>
            <div className="flex gap-2">
                <Input
                    type="text"
                    inputMode="decimal"
                    value={draft}
                    onChange={(e) => { if (isAmountChars(e.target.value)) setDraft(e.target.value); }}
                    onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                    placeholder={fmt(figure.computed)}
                    disabled={saving}
                />
                <Button size="icon" variant="secondary" onClick={submit} disabled={saving} title={`Save ${label}`}>
                    <Save size={16} />
                </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
                {figure.override !== null
                    ? `Manual — computed was ${fmt(figure.computed)}`
                    : `Computed${hint ? ` · ${hint}` : ""} — leave blank to keep using it`}
            </p>
        </div>
    );
}

/** Compact inline override box used inside a table cell — commits on blur/Enter. */
function FyOverrideCell({
    figure,
    saving,
    onSave,
    onClear,
}: {
    figure: Figure & { isOverridden: boolean };
    saving: boolean;
    onSave: (value: number) => void;
    onClear: () => void;
}) {
    const [draft, setDraft] = useState(figure.override === null ? "" : String(figure.override));

    const commit = () => {
        if (draft.trim() === "") {
            if (figure.isOverridden) onClear();
            return;
        }
        const n = parseAmount(draft);
        if (n === figure.override) return;
        onSave(n);
    };

    return (
        <input
            type="text"
            inputMode="decimal"
            value={draft}
            onChange={(e) => { if (isAmountChars(e.target.value)) setDraft(e.target.value); }}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === "Enter") { commit(); (e.target as HTMLInputElement).blur(); }
            }}
            onClick={(e) => e.stopPropagation()}
            placeholder={fmt(figure.computed)}
            disabled={saving}
            className={`w-24 rounded border bg-transparent px-1.5 py-1 text-right font-mono text-sm outline-none focus:ring-1 focus:ring-primary ${
                figure.isOverridden
                    ? "border-amber-400 text-amber-700 dark:text-amber-400"
                    : "border-transparent hover:border-border"
            }`}
        />
    );
}

/** A projected figure shown beside the real one — never saved, never editable. */
function ForecastFigure({ value }: { value: number }) {
    return (
        <span
            className="ml-1.5 shrink-0 font-mono text-[11px] text-sky-600 dark:text-sky-400"
            title="Forecast — averaged from the last months with data"
        >
            ~{fmt(value)}
        </span>
    );
}

/**
 * What a still-open month SHOULD do. Unlike the forecast this is not a
 * prediction — sale and deposit are controllable, so this is the instruction.
 */
function SuggestedFigure({ value }: { value: number }) {
    return (
        <span
            className="ml-1.5 shrink-0 font-mono text-[11px] font-medium text-violet-600 dark:text-violet-400"
            title="Suggested — the pace needed to land on the year's allowance"
        >
            →{fmt(value)}
        </span>
    );
}

/**
 * A yearly allowance spelled out as a pace. This is the guidance: what the year
 * permits, what is already gone, and what that leaves per remaining month — so
 * an early overshoot reads as "slow down to X" rather than a bare failure.
 */
function AllowanceCard({
    title,
    allowance,
    overLabel,
    underLabel,
    note,
}: {
    title: string;
    allowance: Allowance;
    overLabel: string;
    underLabel: string;
    note: string;
}) {
    const ok = allowance.withinAllowance;
    return (
        <div className={`rounded-lg border p-4 shadow-sm ${ok
            ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/30"
            : "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/30"
            }`}>
            <div className="flex items-center gap-2 text-sm font-medium">
                {ok ? <CheckCircle2 size={18} className="text-emerald-600" />
                    : <AlertTriangle size={18} className="text-amber-600" />}
                {title} — {ok ? underLabel : overLabel}
            </div>

            <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
                <div>
                    <div className="text-muted-foreground">Year&rsquo;s allowance</div>
                    <div className="font-mono text-sm text-foreground">{fmt(allowance.target)}</div>
                </div>
                <div>
                    <div className="text-muted-foreground" title="Finished months only — the current month is still open, so it counts as one to come">
                        Used (months closed)
                    </div>
                    <div className="font-mono text-sm text-foreground">{fmt(allowance.used)}</div>
                </div>
                <div>
                    <div className="text-muted-foreground">{ok ? "Left" : "Over by"}</div>
                    <div className={`font-mono text-sm ${ok ? "text-emerald-600" : "text-red-600"}`}>
                        {fmt(Math.abs(allowance.left))}
                    </div>
                </div>
            </div>

            <div className="mt-3 border-t pt-2 text-sm">
                {allowance.monthsLeft === 0 ? (
                    <span className="text-muted-foreground">No months left in this FY to adjust in.</span>
                ) : ok ? (
                    <>
                        <span className="font-medium text-foreground">{fmt(allowance.perMonth)}</span>
                        <span className="text-muted-foreground">
                            {" "}per month for the remaining {allowance.monthsLeft} month(s).
                        </span>
                    </>
                ) : (
                    <span className="text-amber-700 dark:text-amber-400">
                        The year&rsquo;s allowance is already spent, with {allowance.monthsLeft} month(s)
                        still to go — nothing further can be added without going over.
                    </span>
                )}
            </div>

            <p className="mt-2 text-[11px] text-muted-foreground">{note}</p>
        </div>
    );
}

/**
 * Each still-running month's equal share of the slack standing today. Shown on
 * the current month too — it is not finished, so it can still take its share.
 */
function HeadroomFigure({ value }: { value: number }) {
    return (
        <span
            className={`ml-1.5 shrink-0 font-mono text-[11px] font-medium ${
                value < 0 ? "text-red-500" : "text-amber-600 dark:text-amber-400"
            }`}
            title="Head room — today's slack split equally over the months still to run"
        >
            +{fmt(value)}
        </span>
    );
}

/** One presumptive base tested against the income-tax free limit. */
function PresumptiveBase({
    label,
    check,
    ratePercent,
}: {
    label: string;
    check: PresumptiveCheck;
    ratePercent: number;
}) {
    return (
        <div className="rounded-md border border-border/60 bg-background/40 p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                {check.withinLimit
                    ? <CheckCircle2 size={14} className="text-emerald-600" />
                    : <AlertTriangle size={14} className="text-amber-600" />}
                {label}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <div>
                    <div className="text-muted-foreground">Base</div>
                    <div className="font-mono text-foreground">{fmt(check.base)}</div>
                </div>
                <div>
                    <div className="text-muted-foreground">Deemed @ {ratePercent}%</div>
                    <div className="font-mono text-foreground">{fmt(check.presumptiveIncome)}</div>
                </div>
                <div>
                    <div className="text-muted-foreground">{check.headroom >= 0 ? "Headroom" : "Over by"}</div>
                    <div className={`font-mono ${check.headroom >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {fmt(Math.abs(check.headroom))}
                    </div>
                </div>
            </div>
        </div>
    );
}

/** One editable rule figure — saved together with the rest of the rules row. */
function RuleInput({
    label,
    hint,
    value,
    onChange,
    disabled,
    max,
}: {
    label: string;
    hint: string;
    value: string;
    onChange: (value: string) => void;
    disabled: boolean;
    max?: number;
}) {
    return (
        <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">{label}</Label>
            <Input
                type="text"
                inputMode="decimal"
                value={value}
                onChange={(e) => {
                    if (!isAmountChars(e.target.value)) return;
                    if (max !== undefined && parseAmount(e.target.value) > max) return;
                    onChange(e.target.value);
                }}
                disabled={disabled}
            />
            <p className="text-[10px] text-muted-foreground">{hint}</p>
        </div>
    );
}

export default function GstPurchasePlanningPage() {
    const [tab, setTab] = useState("monthly");
    const [month, setMonth] = useState(currentYearMonth);
    const [fyStartYear, setFyStartYear] = useState(() => fyStartYearOf(currentYearMonth()));
    const [bankDraft, setBankDraft] = useState<number[]>([]);
    const [diffDraft, setDiffDraft] = useState("");
    const [taxDraft, setTaxDraft] = useState("");
    const [gapDraft, setGapDraft] = useState("");
    const [presumptiveDraft, setPresumptiveDraft] = useState("");
    const [incomeLimitDraft, setIncomeLimitDraft] = useState("");
    const [saving, setSaving] = useState(false);
    const [showConfig, setShowConfig] = useState(false);
    // Forecast purchase and the suggested sale / deposit pace for months that
    // have not finished — shown beside the real figures, never in place of them.
    const [showForecast, setShowForecast] = useState(true);

    const { data, loading, reload } = useBiQuery<MonthlyReport>(`/api/bi/gst-purchase-planning?month=${month}`);
    const { data: fy, loading: fyLoading, reload: reloadFy } = useBiQuery<FyReport>(
        `/api/bi/gst-purchase-planning/fy?fy=${fyStartYear}`,
    );

    // Hiding the forecast hides it everywhere — the KPIs, the two allowance
    // cards and the presumptive test then read the booked-only plan, so nothing
    // on the page is steered by figures the table no longer shows.
    const plan = showForecast ? fy?.plan : fy?.planBooked;
    const presumptive = showForecast ? fy?.presumptive : fy?.presumptiveBooked;
    /** Word for the purchase every target is derived from, in the current view. */
    const purchaseWord = showForecast ? "forecast purchase" : "booked purchase";

    // A new year's figures reset the drafts — while rendering.
    if (useValueChange(fy) && fy) {
        setBankDraft(fy.config.bankAccountIds ?? []);
        setDiffDraft(String(fy.fy.allowedDiff || ""));
        setTaxDraft(String(fy.config.taxRatePercent));
        setGapDraft(String(fy.config.depositGapPercent));
        setPresumptiveDraft(String(fy.config.presumptiveRatePercent));
        setIncomeLimitDraft(String(fy.config.incomeTaxFreeLimit));
    }

    const reloadAll = useCallback(() => {
        reload();
        reloadFy();
    }, [reload, reloadFy]);

    const savePlan = useCallback(async (patch: Record<string, unknown>, yearMonth: string = month) => {
        setSaving(true);
        try {
            await axios.patch("/api/bi/gst-purchase-planning", { yearMonth, ...patch });
            toast.success("Saved");
            reloadAll();
        } catch {
            toast.error("Failed to save");
        } finally {
            setSaving(false);
        }
    }, [month, reloadAll]);

    const saveFy = useCallback(async (patch: { allowedDiff?: number }) => {
        setSaving(true);
        try {
            await axios.patch("/api/bi/gst-purchase-planning/fy", { fyStartYear, ...patch });
            toast.success("Saved");
            reloadAll();
        } catch {
            toast.error("Failed to save");
        } finally {
            setSaving(false);
        }
    }, [fyStartYear, reloadAll]);

    const saveConfig = useCallback(async (patch: { bankAccountIds?: number[] } = {}) => {
        const rates = {
            taxRatePercent: Number(taxDraft),
            depositGapPercent: Number(gapDraft),
            presumptiveRatePercent: Number(presumptiveDraft),
        };
        if (Object.values(rates).some((n) => !Number.isFinite(n) || n < 0 || n > 100)) {
            toast.error("Percentages must be between 0 and 100");
            return;
        }
        const incomeTaxFreeLimit = Number(incomeLimitDraft);
        if (!Number.isFinite(incomeTaxFreeLimit) || incomeTaxFreeLimit < 0) {
            toast.error("Income-tax free limit must be zero or more");
            return;
        }
        setSaving(true);
        try {
            await axios.patch("/api/bi/gst-purchase-planning/config", {
                ...rates,
                incomeTaxFreeLimit,
                ...patch,
            });
            toast.success("Saved");
            reloadAll();
        } catch {
            toast.error("Failed to save");
        } finally {
            setSaving(false);
        }
    }, [taxDraft, gapDraft, presumptiveDraft, incomeLimitDraft, reloadAll]);

    const toggleBank = (id: number, checked: boolean) => {
        setBankDraft((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));
    };

    const banksDirty = fy && (
        bankDraft.length !== fy.config.bankAccountIds.length
        || bankDraft.some((id) => !fy.config.bankAccountIds.includes(id))
    );

    const currentYM = currentYearMonth();

    const openMonth = (yearMonth: string) => {
        setMonth(yearMonth);
        setTab("monthly");
    };

    // Previous 1 + every FY that has voucher data + upcoming 1.
    const currentFyStart = fyStartYearOf(currentYM);
    const rangeMin = (fy?.dataRange?.min ?? currentFyStart) - 1;
    const rangeMax = (fy?.dataRange?.max ?? currentFyStart) + 1;
    const fyYearOptions = Array.from(
        new Set([
            fyStartYear,
            ...Array.from({ length: Math.max(0, rangeMax - rangeMin + 1) }, (_, i) => rangeMax - i),
        ]),
    ).sort((a, b) => b - a);

    const monthRail = fyMonths(fyStartYear);

    /** Picking an FY drags the month with it, so the Monthly tab never sits outside the chosen year. */
    const selectFy = (nextFy: number) => {
        setFyStartYear(nextFy);
        if (fyStartYearOf(month) === nextFy) return;
        const months = fyMonths(nextFy);
        setMonth(months.includes(currentYM) ? currentYM : months[0]);
    };

    return (
        <ScrollArea className="h-full" type="always">
            <div className="max-w-7xl mx-auto space-y-5 px-6 pt-3 pb-6">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">GST Purchase Planning</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Purchase from GST parties, total sale, and bank / OD deposit — each computed from vouchers,
                        each overridable by hand. Sale above purchase costs GST, budgeted per financial year;
                        anything the budget cannot absorb carries to the next FY.
                    </p>
                </div>

                <Tabs value={tab} onValueChange={setTab}>
                    {/* Tab switch + FY picker sit on one line, shared by both tabs so the
                        financial year stays visible and selectable wherever you are. */}
                    <div className="flex items-end gap-3 flex-wrap">
                        <TabsList>
                            <TabsTrigger value="monthly">Monthly</TabsTrigger>
                            <TabsTrigger value="fy">Financial year</TabsTrigger>
                        </TabsList>
                        <div className="space-y-1">
                            <Label htmlFor="plan-fy" className="text-xs text-muted-foreground">
                                Financial year
                            </Label>
                            <Select value={String(fyStartYear)} onValueChange={(v) => selectFy(Number(v))}>
                                <SelectTrigger id="plan-fy" className="w-28">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {fyYearOptions.map((y) => (
                                        <SelectItem key={y} value={String(y)}>{fyShortLabel(y)}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <TabsContent value="monthly" className="space-y-5 mt-4">
                        <div className="flex items-end justify-between gap-3 flex-wrap">
                            <div className="space-y-1">
                                <Label htmlFor="plan-month" className="text-xs text-muted-foreground">Month</Label>
                                <Input
                                    id="plan-month"
                                    type="month"
                                    value={month}
                                    onChange={(e) => {
                                        setMonth(e.target.value);
                                        if (e.target.value) setFyStartYear(fyStartYearOf(e.target.value));
                                    }}
                                    className="w-40"
                                />
                            </div>
                            <div className="flex items-center gap-2 flex-1 justify-end min-w-0">
                                <div className="flex gap-1 overflow-x-auto min-w-0">
                                    {monthRail.map((ym) => (
                                        <button
                                            key={ym}
                                            type="button"
                                            onClick={() => setMonth(ym)}
                                            className={`shrink-0 rounded px-2.5 py-1.5 text-xs font-medium ${
                                                ym === month
                                                    ? "bg-primary text-primary-foreground"
                                                    : ym === currentYM
                                                        ? "bg-primary/10 text-primary hover:bg-primary/20"
                                                        : "text-muted-foreground hover:bg-muted"
                                            }`}
                                        >
                                            {shortMonthLabel(ym)}
                                        </button>
                                    ))}
                                </div>
                                <Button variant="outline" size="sm" className="shrink-0" onClick={reload} disabled={loading}>
                                    {loading && <Loader2 className="animate-spin mr-1.5" size={14} />}
                                    Refresh
                                </Button>
                            </div>
                        </div>

                        {/* Only the first load blanks the tab — a refetch after saving keeps
                            the current figures on screen so the page doesn't blink. */}
                        {loading && !data && (
                            <div className="flex justify-center py-20">
                                <Loader2 className="animate-spin text-muted-foreground" size={28} />
                            </div>
                        )}

                        {data && (
                            <>
                                <div className="grid grid-cols-3 gap-3">
                                    <KpiCard
                                        label="Purchase (GST parties)"
                                        value={fmt(data.figures.purchase.effective)}
                                        sub={`${data.meta.partyCount} parties · ${data.meta.purchaseBills} bills`}
                                    />
                                    <KpiCard label="Sale" value={fmt(data.figures.sale.effective)} tone="primary" />
                                    <KpiCard
                                        label="Bank / OD deposit"
                                        value={fmt(data.figures.deposit.effective)}
                                        tone="default"
                                    />
                                </div>

                                <div className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-4">
                                    <div className="text-sm font-medium text-foreground">
                                        {data.monthLabel} — figures
                                    </div>
                                    <div className="grid gap-4 lg:grid-cols-3">
                                        <OverrideField
                                            key={`${data.yearMonth}-purchase-${data.figures.purchase.override}`}
                                            label="Purchase (pre-tax)"
                                            figure={data.figures.purchase}
                                            hint="GST parties only"
                                            saving={saving}
                                            onSave={(v) => void savePlan({ purchaseOverride: v })}
                                            onClear={() => void savePlan({ purchaseOverride: null })}
                                        />
                                        <OverrideField
                                            key={`${data.yearMonth}-sale-${data.figures.sale.override}`}
                                            label="Sale (pre-tax)"
                                            figure={data.figures.sale}
                                            hint="all sale vouchers"
                                            saving={saving}
                                            onSave={(v) => void savePlan({ saleOverride: v })}
                                            onClear={() => void savePlan({ saleOverride: null })}
                                        />
                                        <OverrideField
                                            key={`${data.yearMonth}-deposit-${data.figures.deposit.override}`}
                                            label="Bank / OD deposit"
                                            figure={data.figures.deposit}
                                            hint="selected ledgers"
                                            saving={saving}
                                            onSave={(v) => void savePlan({ depositOverride: v })}
                                            onClear={() => void savePlan({ depositOverride: null })}
                                        />
                                    </div>

                                    {/* No pass/fail here — sale and deposit limits are yearly now,
                                        so a single month is never judged on its own. */}
                                    <p className="pt-1 text-xs text-muted-foreground">
                                        Deposit is summed across the {data.config.bankAccountIds.length} ledger(s)
                                        selected on the Financial year tab. Sale and deposit limits run for the whole
                                        of {fyLabel(data.fy.fyStartYear)}, not per month — see the Financial year tab
                                        for how much allowance is left and the pace it leaves.
                                    </p>
                                </div>

                                <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                                    <div className="border-b bg-muted/40 px-3 py-2 text-sm font-medium text-foreground">
                                        GST party purchases — {data.monthLabel}
                                    </div>
                                    <table className="w-full text-sm">
                                        <thead className="border-b bg-muted text-xs text-muted-foreground">
                                            <tr>
                                                <th className="px-3 py-2 text-left font-medium">Party</th>
                                                <th className="px-3 py-2 text-left font-medium">GSTIN</th>
                                                <th className="px-3 py-2 text-right font-medium">Bills</th>
                                                <th className="px-3 py-2 text-right font-medium">Purchase (pre-tax)</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {data.rows.length === 0 ? (
                                                <tr>
                                                    <td colSpan={4} className="py-12 text-center text-muted-foreground text-sm">
                                                        No purchases from GST parties in this month.
                                                    </td>
                                                </tr>
                                            ) : data.rows.map((r) => (
                                                <tr key={r.accountId} className="border-b last:border-0 hover:bg-muted/40">
                                                    <td className="px-3 py-2.5 font-medium text-foreground">{r.name}</td>
                                                    <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{r.gstin}</td>
                                                    <td className="px-3 py-2.5 text-right text-muted-foreground">{r.purchaseBills}</td>
                                                    <td className="px-3 py-2.5 text-right font-mono">{fmt(r.purchase)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        {data.rows.length > 0 && (
                                            <tfoot className="border-t bg-muted/30 font-semibold">
                                                <tr>
                                                    <td className="px-3 py-2.5" colSpan={3}>Computed total (GST parties)</td>
                                                    <td className="px-3 py-2.5 text-right font-mono">{fmt(data.figures.purchase.computed)}</td>
                                                </tr>
                                            </tfoot>
                                        )}
                                    </table>
                                </div>
                            </>
                        )}
                    </TabsContent>

                    <TabsContent value="fy" className="space-y-5 mt-4">
                        <div className="flex items-center justify-end">
                            <Button variant="outline" size="sm" onClick={reloadFy} disabled={fyLoading}>
                                {fyLoading && <Loader2 className="animate-spin mr-1.5" size={14} />}
                                Refresh
                            </Button>
                        </div>

                        {fyLoading && !fy && (
                            <div className="flex justify-center py-20">
                                <Loader2 className="animate-spin text-muted-foreground" size={28} />
                            </div>
                        )}

                        {fy && plan && presumptive && (
                            <>
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                    <KpiCard
                                        label={showForecast ? "Purchase (forecast)" : "Purchase (booked)"}
                                        value={fmt(plan.purchase.total)}
                                        sub={showForecast
                                            ? `Actual ${fmt(plan.purchase.actual)} + forecast ${fmt(plan.purchase.forecast)}`
                                            : "Billed by GST parties so far — no forecast"}
                                    />
                                    <KpiCard
                                        label="Sale target"
                                        value={fmt(plan.sale.target)}
                                        sub={`Purchase ${plan.allowedDiff < 0 ? "−" : "+"} ${fmt(Math.abs(plan.allowedDiff))} allowed difference`}
                                        tone="primary"
                                    />
                                    <KpiCard
                                        label="Sale still to do"
                                        value={fmt(plan.sale.left)}
                                        sub={plan.sale.monthsLeft > 0
                                            ? `${fmt(plan.sale.perMonth)} / month × ${plan.sale.monthsLeft}`
                                            : "No months left in this FY"}
                                        tone={plan.sale.withinAllowance ? "default" : "negative"}
                                    />
                                    <KpiCard
                                        label="Deposit room left"
                                        value={fmt(plan.deposit.left)}
                                        sub={plan.deposit.monthsLeft > 0
                                            ? `${fmt(plan.deposit.perMonth)} / month × ${plan.deposit.monthsLeft}`
                                            : "No months left in this FY"}
                                        tone={plan.deposit.withinAllowance ? "primary" : "negative"}
                                    />
                                </div>

                                {/* The guidance the whole page exists for — what pace the rest
                                    of the year needs, given what the early months already spent. */}
                                <div className="grid gap-3 lg:grid-cols-2">
                                    <AllowanceCard
                                        title="Sale"
                                        allowance={plan.sale}
                                        overLabel="Already past the year's sale target"
                                        underLabel="On track — sell at this pace"
                                        note={`Target = ${purchaseWord} ${fmt(plan.purchase.total)} ${plan.allowedDiff < 0 ? "−" : "+"} ${fmt(Math.abs(plan.allowedDiff))}.`}
                                    />
                                    <AllowanceCard
                                        title="Bank / OD deposit"
                                        allowance={plan.deposit}
                                        overLabel="Already past the year's deposit ceiling"
                                        underLabel="Within the ceiling — deposit at this pace"
                                        note={`Ceiling = sale target ${fmt(plan.sale.target)} less ${fy.config.depositGapPercent}%.`}
                                    />
                                </div>

                                <div className="rounded-lg border border-border bg-card shadow-sm">
                                    <button
                                        type="button"
                                        onClick={() => setShowConfig((v) => !v)}
                                        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-foreground"
                                    >
                                        <span>Configuration — banks, cost limit &amp; rules</span>
                                        {showConfig ? <EyeOff size={14} className="text-muted-foreground" /> : <Eye size={14} className="text-muted-foreground" />}
                                    </button>
                                    {showConfig && (
                                    <div className="px-4 pb-4 grid gap-4 lg:grid-cols-3">
                                    <div className="space-y-2 lg:col-span-3">
                                        <div className="flex items-center justify-between gap-2 flex-wrap">
                                            <Label className="text-xs text-muted-foreground">
                                                Bank &amp; OD accounts — deposits summed across all
                                            </Label>
                                            {banksDirty && (
                                                <Button
                                                    size="sm"
                                                    variant="secondary"
                                                    onClick={() => void saveConfig({ bankAccountIds: bankDraft })}
                                                    disabled={saving}
                                                >
                                                    <Save size={14} className="mr-1" /> Save banks
                                                </Button>
                                            )}
                                        </div>
                                        <div className="max-h-40 overflow-y-auto rounded-md border border-border p-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                                            {fy.banks.length === 0 ? (
                                                <p className="text-xs text-muted-foreground px-1 py-2">No bank / OD ledgers found.</p>
                                            ) : fy.banks.map((b) => (
                                                <label
                                                    key={b.id}
                                                    className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-muted/50 cursor-pointer text-sm"
                                                >
                                                    <Checkbox
                                                        checked={bankDraft.includes(b.id)}
                                                        onCheckedChange={(c) => toggleBank(b.id, c === true)}
                                                        disabled={saving}
                                                    />
                                                    <span className="flex-1 truncate">{b.name}</span>
                                                    <span className={`text-[10px] uppercase tracking-wide shrink-0 ${
                                                        b.kind === "od" ? "text-amber-600" : "text-muted-foreground"
                                                    }`}>
                                                        {b.kind === "od" ? "OD" : "Bank"}
                                                    </span>
                                                    {b.accountNumber && (
                                                        <span className="text-xs text-muted-foreground font-mono shrink-0">{b.accountNumber}</span>
                                                    )}
                                                </label>
                                            ))}
                                        </div>
                                        <p className="text-[11px] text-muted-foreground">
                                            {bankDraft.length} selected · picked once and used for every month of
                                            every year.
                                        </p>
                                    </div>

                                    <div className="space-y-1 lg:col-span-2">
                                        <Label className="text-xs text-muted-foreground">
                                            Allowed purchase → sale difference for {fy.fy.label}
                                        </Label>
                                        <div className="flex gap-2">
                                            <Input
                                                type="text"
                                                inputMode="decimal"
                                                value={diffDraft}
                                                onChange={(e) => { if (isSignedAmountChars(e.target.value)) setDiffDraft(e.target.value); }}
                                                placeholder="0"
                                                disabled={saving}
                                            />
                                            <Button
                                                size="icon"
                                                variant="secondary"
                                                onClick={() => void saveFy({ allowedDiff: parseSignedAmount(diffDraft) })}
                                                disabled={saving}
                                                title="Save allowed difference"
                                            >
                                                <Save size={16} />
                                            </Button>
                                        </div>
                                        <p className="text-[11px] text-muted-foreground">
                                            Signed. Negative sells below purchase (input credit builds up); positive
                                            adds value and costs GST. Sale target = forecast purchase + this.
                                        </p>
                                    </div>

                                    <div className="space-y-1 lg:col-span-3 border-t pt-3">
                                        <div className="flex items-center justify-between gap-2">
                                            <Label className="text-xs text-muted-foreground">
                                                Rules — apply to every financial year
                                            </Label>
                                            <Button size="sm" variant="secondary" onClick={() => void saveConfig()} disabled={saving}>
                                                <Save size={14} className="mr-1" /> Save rules
                                            </Button>
                                        </div>
                                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                            <RuleInput
                                                label="GST rate %"
                                                hint="On (sale − purchase)"
                                                value={taxDraft}
                                                onChange={setTaxDraft}
                                                disabled={saving}
                                                max={100}
                                            />
                                            <RuleInput
                                                label="Deposit gap %"
                                                hint="Deposit stays this far below sale"
                                                value={gapDraft}
                                                onChange={setGapDraft}
                                                disabled={saving}
                                                max={100}
                                            />
                                            <RuleInput
                                                label="Presumptive rate %"
                                                hint="Of deposit, deemed income"
                                                value={presumptiveDraft}
                                                onChange={setPresumptiveDraft}
                                                disabled={saving}
                                                max={100}
                                            />
                                            <RuleInput
                                                label="Income-tax free limit"
                                                hint="Deemed income below this is free"
                                                value={incomeLimitDraft}
                                                onChange={setIncomeLimitDraft}
                                                disabled={saving}
                                            />
                                        </div>
                                    </div>
                                    </div>
                                    )}
                                </div>

                                <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                                    <div className="border-b bg-muted/40 px-3 py-2 flex items-center justify-between gap-3">
                                        <span className="text-sm font-medium text-foreground">
                                            {fy.fy.label} — month by month
                                        </span>
                                        {fy.purchaseForecast.basisMonths.length > 0 && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 text-xs text-muted-foreground"
                                                onClick={() => setShowForecast((v) => !v)}
                                                title={`Purchase averaged from ${fy.purchaseForecast.basisMonths.length} month(s) of real data`}
                                            >
                                                {showForecast ? <EyeOff size={14} className="mr-1.5" /> : <Eye size={14} className="mr-1.5" />}
                                                {showForecast ? "Hide forecast & suggestions" : "Show forecast & suggestions"}
                                            </Button>
                                        )}
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm min-w-176">
                                            <thead className="border-b bg-muted text-xs text-muted-foreground">
                                                <tr>
                                                    <th className="px-3 py-2 text-left font-medium">Month</th>
                                                    <th className="px-3 py-2 text-right font-medium">Purchase</th>
                                                    <th className="px-3 py-2 text-right font-medium">Sale</th>
                                                    <th className="px-3 py-2 text-right font-medium">Sale limit left</th>
                                                    <th className="px-3 py-2 text-right font-medium">Deposit</th>
                                                    <th className="px-3 py-2 text-right font-medium">Deposit limit left</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {fy.months.map((m) => {
                                                    const isCurrent = m.yearMonth === currentYM;
                                                    const purchaseF = showForecast
                                                        ? fy.purchaseForecast.months[m.yearMonth]
                                                        : undefined;
                                                    const g = fy.monthGuides[m.yearMonth];
                                                    // A row with no data of its own is pure projection, so
                                                    // with suggestions off it has nothing honest to show.
                                                    const projectedOnly = g !== undefined && !g.hasData;
                                                    const showLimits = g !== undefined && (g.hasData || showForecast);
                                                    const suggest = showForecast && projectedOnly;
                                                    // Every month from the current one on gets an equal share
                                                    // of the slack standing today.
                                                    const takesHeadroom = m.yearMonth >= currentYM;
                                                    return (
                                                    <tr
                                                        key={m.yearMonth}
                                                        className={`border-b last:border-0 hover:bg-muted/40 cursor-pointer ${
                                                            isCurrent ? "bg-primary/5 ring-1 ring-inset ring-primary/30" : ""
                                                        }`}
                                                        onClick={() => openMonth(m.yearMonth)}
                                                        title="Click to open the monthly detail"
                                                    >
                                                        <td className="px-3 py-2.5 font-medium text-foreground">
                                                            {m.monthLabel}
                                                            {isCurrent && <span className="ml-1.5 rounded bg-primary/15 px-1 py-0.5 text-[10px] font-medium text-primary">current</span>}
                                                        </td>
                                                        <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                                                            <div className="flex items-center justify-end gap-1.5">
                                                                <FyOverrideCell
                                                                    key={`${m.yearMonth}-purchase-${m.purchase.override}`}
                                                                    figure={m.purchase}
                                                                    saving={saving}
                                                                    onSave={(v) => void savePlan({ purchaseOverride: v }, m.yearMonth)}
                                                                    onClear={() => void savePlan({ purchaseOverride: null }, m.yearMonth)}
                                                                />
                                                                {purchaseF !== undefined && <ForecastFigure value={purchaseF} />}
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                                                            <div className="flex items-center justify-end gap-1.5">
                                                                <FyOverrideCell
                                                                    key={`${m.yearMonth}-sale-${m.sale.override}`}
                                                                    figure={m.sale}
                                                                    saving={saving}
                                                                    onSave={(v) => void savePlan({ saleOverride: v }, m.yearMonth)}
                                                                    onClear={() => void savePlan({ saleOverride: null }, m.yearMonth)}
                                                                />
                                                                {suggest && g.suggestedSale !== null && (
                                                                    <SuggestedFigure value={g.suggestedSale} />
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className={`px-3 py-2.5 text-right font-mono font-medium ${
                                                            !showLimits ? "text-muted-foreground"
                                                                : g.saleLimitLeft < 0 ? "text-red-600" : "text-emerald-600"
                                                        }`}>
                                                            {showLimits ? fmt(g.saleLimitLeft) : "—"}
                                                            {takesHeadroom && fy.headroom.months > 0 && (
                                                                <HeadroomFigure value={fy.headroom.salePerMonth} />
                                                            )}
                                                        </td>
                                                        <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                                                            <div className="flex items-center justify-end gap-1.5">
                                                                <FyOverrideCell
                                                                    key={`${m.yearMonth}-deposit-${m.deposit.override}`}
                                                                    figure={m.deposit}
                                                                    saving={saving}
                                                                    onSave={(v) => void savePlan({ depositOverride: v }, m.yearMonth)}
                                                                    onClear={() => void savePlan({ depositOverride: null }, m.yearMonth)}
                                                                />
                                                                {suggest && g.suggestedDeposit !== null && (
                                                                    <SuggestedFigure value={g.suggestedDeposit} />
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className={`px-3 py-2.5 text-right font-mono font-medium ${
                                                            !showLimits ? "text-muted-foreground"
                                                                : g.depositLimitLeft < 0 ? "text-red-600" : "text-emerald-600"
                                                        }`}>
                                                            {showLimits ? fmt(g.depositLimitLeft) : "—"}
                                                            {takesHeadroom && fy.headroom.months > 0 && (
                                                                <HeadroomFigure value={fy.headroom.depositPerMonth} />
                                                            )}
                                                        </td>
                                                    </tr>
                                                    );
                                                })}
                                            </tbody>
                                            <tfoot className="border-t bg-muted/30 font-semibold">
                                                <tr>
                                                    <td className="px-3 py-2.5">Booked so far</td>
                                                    <td className="px-3 py-2.5 text-right font-mono">{fmt(fy.totals.purchase)}</td>
                                                    <td className="px-3 py-2.5 text-right font-mono">{fmt(fy.totals.sale)}</td>
                                                    <td />
                                                    <td className="px-3 py-2.5 text-right font-mono">{fmt(fy.totals.deposit)}</td>
                                                    <td />
                                                </tr>
                                                {/* The year as planned — forecast purchase, and the sale
                                                    and deposit allowances those forecasts permit. */}
                                                {showForecast && fy.purchaseForecast.basisMonths.length > 0 && (
                                                    <tr className="border-t text-sky-700 dark:text-sky-400">
                                                        <td className="px-3 py-2.5 font-medium">FY allowance</td>
                                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(fy.plan.purchase.total)}</td>
                                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(fy.plan.sale.target)}</td>
                                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(fy.plan.sale.left)}</td>
                                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(fy.plan.deposit.target)}</td>
                                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(fy.plan.deposit.left)}</td>
                                                    </tr>
                                                )}
                                            </tfoot>
                                        </table>
                                    </div>
                                </div>

                                {/* Presumptive tax rides on BOTH bases — turnover is the statutory
                                    one, deposit the cash proxy — so either can breach first. */}
                                <div className={`rounded-lg border p-4 shadow-sm ${presumptive.withinLimit
                                    ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/30"
                                    : "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/30"
                                    }`}>
                                    <div className="flex items-center gap-2 text-sm font-medium">
                                        {presumptive.withinLimit
                                            ? <CheckCircle2 size={18} className="text-emerald-600" />
                                            : <AlertTriangle size={18} className="text-amber-600" />}
                                        {presumptive.withinLimit
                                            ? "Sale and bank deposit both within the income-tax free limit"
                                            : !presumptive.sale.withinLimit && !presumptive.deposit.withinLimit
                                                ? "Sale AND bank deposit both past the income-tax free limit"
                                                : !presumptive.sale.withinLimit
                                                    ? "Sale target passes the income-tax free limit"
                                                    : "Bank deposit passes the income-tax free limit"}
                                    </div>

                                    <div className="mt-3 grid gap-4 sm:grid-cols-2">
                                        <PresumptiveBase
                                            label="Sale target"
                                            check={presumptive.sale}
                                            ratePercent={fy.config.presumptiveRatePercent}
                                        />
                                        <PresumptiveBase
                                            label="Bank / OD deposit ceiling"
                                            check={presumptive.deposit}
                                            ratePercent={fy.config.presumptiveRatePercent}
                                        />
                                    </div>

                                    <p className="mt-3 text-xs text-muted-foreground">
                                        {fy.config.presumptiveRatePercent}% of the base counts as income under
                                        presumptive taxation, and income up to {fmt(presumptive.sale.taxFreeLimit)} pays
                                        no income tax — so either base can reach{" "}
                                        <span className="text-foreground font-mono">{fmt(presumptive.sale.maxBase)}</span>{" "}
                                        in {fy.fy.label} before tax starts.
                                        {!showForecast && (
                                            <> Both bases here stand on booked purchase only — the forecast is
                                            hidden, so they will rise as more bills arrive.</>
                                        )}
                                        {!presumptive.sale.withinLimit && (
                                            <> The sale target itself breaches this — lower the allowed difference, or
                                            accept the income tax.</>
                                        )}
                                    </p>
                                </div>

                                <div className="rounded-lg border border-border bg-card p-4 shadow-sm text-sm space-y-1.5">
                                    <div className="font-medium text-foreground">How {fy.fy.label} is steered</div>
                                    <p className="text-muted-foreground text-xs">
                                        {showForecast ? (
                                            <>
                                                Purchase cannot be controlled, so it is forecast:{" "}
                                                {fmt(plan.purchase.actual)} already billed plus{" "}
                                                {fmt(plan.purchase.forecast)} predicted ={" "}
                                                {fmt(plan.purchase.total)}
                                                {fy.purchaseForecast.basisMonths.length > 0 && (
                                                    <> — {fmt(fy.purchaseForecast.perMonth)} a month, averaged from the last{" "}
                                                    {fy.purchaseForecast.basisMonths.length} month(s) with data</>
                                                )}.
                                            </>
                                        ) : (
                                            <>
                                                Purchase cannot be controlled. The forecast is hidden, so only the{" "}
                                                {fmt(plan.purchase.total)} already billed is counted — every target
                                                below stands on that alone and will rise as more bills arrive.
                                            </>
                                        )}
                                    </p>
                                    <p className="text-muted-foreground text-xs">
                                        Sale and deposit CAN be controlled, so they are targets, not predictions. Sale
                                        target = {purchaseWord} {plan.allowedDiff < 0 ? "−" : "+"}{" "}
                                        {fmt(Math.abs(plan.allowedDiff))} = {fmt(plan.sale.target)}. Deposit
                                        ceiling = that less {fy.config.depositGapPercent}% = {fmt(plan.deposit.target)}.
                                    </p>
                                    <p className="text-muted-foreground text-xs">
                                        Both allowances are yearly, never monthly — a month only spends from the year&rsquo;s
                                        pool. Whatever an early month overspent simply lowers the pace left for the rest,
                                        which is what the two cards above state.
                                    </p>
                                    {fy.headroom.months > 0 && (
                                        <p className="text-muted-foreground text-xs">
                                            Head room: {fmt(fy.headroom.saleSlack)} of sale slack and{" "}
                                            {fmt(fy.headroom.depositSlack)} of deposit slack stand after the last month
                                            with figures, split equally over the {fy.headroom.months} month(s) still to
                                            run — {fmt(fy.headroom.salePerMonth)} sale and{" "}
                                            {fmt(fy.headroom.depositPerMonth)} deposit each, the current month included
                                            since it has not closed.
                                        </p>
                                    )}
                                    <p className="text-muted-foreground text-xs">
                                        In the table: &ldquo;M&rdquo; is a manual override, not the computed value;
                                        &ldquo;~&rdquo; is forecast purchase; &ldquo;→&rdquo; is the suggested total for
                                        a month with no figures yet; &ldquo;+&rdquo; is that month&rsquo;s share of the
                                        head room. The two &ldquo;limit left&rdquo; columns run the year&rsquo;s
                                        allowance down month by month. Nothing but your own overrides is ever saved.
                                    </p>
                                </div>
                            </>
                        )}
                    </TabsContent>
                </Tabs>
            </div>
        </ScrollArea>
    );
}
