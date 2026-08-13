"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmt } from "@/utils/constants";
import { useBiQuery } from "@/modules/bi/hooks/useBiQuery";
import { KpiCard } from "@/modules/bi/components/KpiCard";

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
    deposit: number;
    presumptiveIncome: number;
    taxFreeLimit: number;
    maxDeposit: number;
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
    fy: { fyStartYear: number; costLimit: number; extraCostPaid: number };
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

interface FyReport {
    config: PlanningConfig;
    banks: BankOption[];
    months: FyMonthRow[];
    fy: {
        fyStartYear: number;
        label: string;
        costLimit: number;
        extraCostPaid: number;
        budget: number;
        carryIn: number;
        costThisFy: number;
        costIncurred: number;
        costAbsorbed: number;
        carryOut: number;
        remainingBudget: number;
        withinBudget: boolean;
    };
    totals: {
        purchase: number; sale: number; deposit: number; valueAddition: number;
        outputTax: number; inputTax: number; cost: number; maxDeposit: number;
        depositLimitLeft: number;
    };
    presumptive: PresumptiveCheck;
    depositBreachMonths: number;
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
        const n = Number(draft.replace(/,/g, ""));
        if (Number.isNaN(n) || n < 0) {
            toast.error("Enter a valid amount");
            return;
        }
        onSave(n);
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
                    type="number"
                    min={0}
                    step="0.01"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
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
                type="number"
                min={0}
                max={max}
                step="0.01"
                value={value}
                onChange={(e) => onChange(e.target.value)}
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
    const [limitDraft, setLimitDraft] = useState("");
    const [extraDraft, setExtraDraft] = useState("");
    const [taxDraft, setTaxDraft] = useState("");
    const [gapDraft, setGapDraft] = useState("");
    const [presumptiveDraft, setPresumptiveDraft] = useState("");
    const [incomeLimitDraft, setIncomeLimitDraft] = useState("");
    const [saving, setSaving] = useState(false);
    // Output tax and input tax are the working-out behind Cost this month —
    // folded away until asked for.
    const [showTaxDetail, setShowTaxDetail] = useState(false);

    const { data, loading, reload } = useBiQuery<MonthlyReport>(`/api/bi/gst-purchase-planning?month=${month}`);
    const { data: fy, loading: fyLoading, reload: reloadFy } = useBiQuery<FyReport>(
        `/api/bi/gst-purchase-planning/fy?fy=${fyStartYear}`,
    );

    useEffect(() => {
        if (!fy) return;
        setBankDraft(fy.config.bankAccountIds ?? []);
        setLimitDraft(String(fy.fy.costLimit || ""));
        setExtraDraft(String(fy.fy.extraCostPaid || ""));
        setTaxDraft(String(fy.config.taxRatePercent));
        setGapDraft(String(fy.config.depositGapPercent));
        setPresumptiveDraft(String(fy.config.presumptiveRatePercent));
        setIncomeLimitDraft(String(fy.config.incomeTaxFreeLimit));
    }, [fy?.fy.fyStartYear, fy?.fy.costLimit, fy?.fy.extraCostPaid, fy?.config]);

    const reloadAll = useCallback(() => {
        reload();
        reloadFy();
    }, [reload, reloadFy]);

    const savePlan = useCallback(async (patch: Record<string, unknown>) => {
        setSaving(true);
        try {
            await axios.patch("/api/bi/gst-purchase-planning", { yearMonth: month, ...patch });
            toast.success("Saved");
            reloadAll();
        } catch {
            toast.error("Failed to save");
        } finally {
            setSaving(false);
        }
    }, [month, reloadAll]);

    const saveFy = useCallback(async (patch: { costLimit?: number; extraCostPaid?: number }) => {
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

    const openMonth = (yearMonth: string) => {
        setMonth(yearMonth);
        setTab("monthly");
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
                    <TabsList>
                        <TabsTrigger value="monthly">Monthly</TabsTrigger>
                        <TabsTrigger value="fy">Financial year</TabsTrigger>
                    </TabsList>

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
                            <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
                                {loading && <Loader2 className="animate-spin mr-1.5" size={14} />}
                                Refresh
                            </Button>
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
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                    <KpiCard
                                        label="Purchase (GST parties)"
                                        value={fmt(data.figures.purchase.effective)}
                                        sub={`${data.meta.partyCount} parties · ${data.meta.purchaseBills} bills`}
                                    />
                                    <KpiCard label="Sale" value={fmt(data.figures.sale.effective)} tone="primary" />
                                    <KpiCard
                                        label="Bank / OD deposit"
                                        value={fmt(data.figures.deposit.effective)}
                                        sub={`Limit ${fmt(data.month.maxDeposit)} · left ${fmt(data.month.depositLimitLeft)}`}
                                        tone={data.month.depositOk ? "default" : "negative"}
                                    />
                                    <KpiCard
                                        label={`Cost this month @ ${data.config.taxRatePercent}%`}
                                        value={fmt(data.month.cost)}
                                        sub={`Final payable ${fmt(data.month.finalPayable)}`}
                                        tone={data.month.cost > 0 ? "negative" : "primary"}
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

                                    <div className="pt-1">
                                        <div className={`rounded-md border p-3 text-sm ${data.month.depositOk
                                            ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/30"
                                            : "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/30"
                                            }`}>
                                            <div className="flex items-center gap-2 font-medium">
                                                {data.month.depositOk
                                                    ? <CheckCircle2 size={18} className="text-emerald-600" />
                                                    : <AlertTriangle size={18} className="text-amber-600" />}
                                                {data.month.depositOk ? "Deposit within limit" : "Deposit over limit"}
                                            </div>
                                            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                                                <li>
                                                    Deposit must stay {data.config.depositGapPercent}% below sale — this
                                                    month&rsquo;s limit {fmt(data.month.maxDeposit)}.
                                                </li>
                                                <li>
                                                    Deposit now {fmt(data.figures.deposit.effective)}, from the{" "}
                                                    {data.config.bankAccountIds.length} ledger(s) selected on the
                                                    Financial year tab.
                                                </li>
                                                <li>
                                                    Carried forward {fmt(data.month.depositCarriedIn)} +{" "}
                                                    {fmt(data.month.depositRoom)} this month ={" "}
                                                    <span className={data.month.depositLimitLeft < 0 ? "text-red-600" : "text-emerald-600"}>
                                                        {fmt(data.month.depositLimitLeft)}
                                                    </span>{" "}
                                                    limit left.
                                                </li>
                                                {!data.month.depositOk && (
                                                    <li className="text-amber-600">
                                                        Past the running limit by {fmt(-data.month.depositLimitLeft)} —
                                                        bring deposit down by that much, or raise sale.
                                                    </li>
                                                )}
                                                <li className="pt-1 border-t mt-2 flex items-center justify-between gap-2 text-foreground">
                                                    <span>
                                                        Cost this month{" "}
                                                        <span className={data.month.cost > 0 ? "text-red-600" : "text-emerald-600"}>
                                                            {fmt(data.month.cost)}
                                                        </span>{" "}
                                                        — final payable {fmt(data.month.finalPayable)} in{" "}
                                                        {fyLabel(data.fy.fyStartYear)}.
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowTaxDetail((v) => !v)}
                                                        className="inline-flex items-center gap-1 shrink-0 text-[11px] text-muted-foreground hover:underline"
                                                    >
                                                        {showTaxDetail ? <EyeOff size={11} /> : <Eye size={11} />}
                                                        {showTaxDetail ? "hide" : "detail"}
                                                    </button>
                                                </li>
                                                {showTaxDetail && (
                                                    <li>
                                                        Output tax on sale {fmt(data.month.outputTax)} − input tax on
                                                        purchase {fmt(data.month.inputTax)} = {fmt(data.month.cost)};
                                                        carried forward {fmt(data.month.carriedIn)}.
                                                    </li>
                                                )}
                                            </ul>
                                        </div>
                                    </div>
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
                        <div className="flex items-end justify-between gap-3 flex-wrap">
                            <div className="space-y-1">
                                <Label htmlFor="plan-fy" className="text-xs text-muted-foreground">
                                    Financial year (April–March) — starting year
                                </Label>
                                <Input
                                    id="plan-fy"
                                    type="number"
                                    min={2000}
                                    max={2100}
                                    value={fyStartYear}
                                    onChange={(e) => setFyStartYear(Number(e.target.value) || fyStartYear)}
                                    className="w-28"
                                />
                            </div>
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

                        {fy && (
                            <>
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                    <KpiCard
                                        label="Cost budget"
                                        value={fmt(fy.fy.budget)}
                                        sub={`Limit ${fmt(fy.fy.costLimit)} + extra paid ${fmt(fy.fy.extraCostPaid)}`}
                                    />
                                    <KpiCard
                                        label="Net cost incurred"
                                        value={fmt(fy.fy.costIncurred)}
                                        sub={`This FY ${fmt(fy.fy.costThisFy)} + carried in ${fmt(fy.fy.carryIn)}`}
                                        tone="primary"
                                    />
                                    <KpiCard
                                        label="Budget left"
                                        value={fmt(fy.fy.remainingBudget)}
                                        sub={fy.fy.withinBudget ? "Within budget" : "Budget exhausted"}
                                        tone={fy.fy.withinBudget ? "primary" : "negative"}
                                    />
                                    <KpiCard
                                        label="Carries to next FY"
                                        value={fmt(fy.fy.carryOut)}
                                        sub={fy.fy.carryOut > 0
                                            ? `Pay ${fmt(fy.fy.carryOut)} extra to clear it`
                                            : "Nothing carried forward"}
                                        tone={fy.fy.carryOut > 0 ? "negative" : "primary"}
                                    />
                                </div>

                                <div className="rounded-lg border border-border bg-card p-4 shadow-sm grid gap-4 lg:grid-cols-3">
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

                                    <div className="space-y-1">
                                        <Label className="text-xs text-muted-foreground">
                                            Cost limit for {fy.fy.label}
                                        </Label>
                                        <div className="flex gap-2">
                                            <Input
                                                type="number"
                                                min={0}
                                                step="0.01"
                                                value={limitDraft}
                                                onChange={(e) => setLimitDraft(e.target.value)}
                                                placeholder="0"
                                                disabled={saving}
                                            />
                                            <Button
                                                size="icon"
                                                variant="secondary"
                                                onClick={() => void saveFy({ costLimit: Number(limitDraft) || 0 })}
                                                disabled={saving}
                                                title="Save cost limit"
                                            >
                                                <Save size={16} />
                                            </Button>
                                        </div>
                                        <p className="text-[11px] text-muted-foreground">GST cost you accept this FY.</p>
                                    </div>

                                    <div className="space-y-1">
                                        <Label className="text-xs text-muted-foreground">Extra cost paid</Label>
                                        <div className="flex gap-2">
                                            <Input
                                                type="number"
                                                min={0}
                                                step="0.01"
                                                value={extraDraft}
                                                onChange={(e) => setExtraDraft(e.target.value)}
                                                placeholder="0"
                                                disabled={saving}
                                            />
                                            <Button
                                                size="icon"
                                                variant="secondary"
                                                onClick={() => void saveFy({ extraCostPaid: Number(extraDraft) || 0 })}
                                                disabled={saving}
                                                title="Save extra cost paid"
                                            >
                                                <Save size={16} />
                                            </Button>
                                        </div>
                                        <p className="text-[11px] text-muted-foreground">
                                            Paid above the limit — clears carry instead of pushing it forward.
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

                                <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                                    <div className="border-b bg-muted/40 px-3 py-2 flex items-center justify-between gap-3">
                                        <span className="text-sm font-medium text-foreground">
                                            {fy.fy.label} — month by month
                                        </span>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 text-xs text-muted-foreground"
                                            onClick={() => setShowTaxDetail((v) => !v)}
                                        >
                                            {showTaxDetail ? <EyeOff size={14} className="mr-1.5" /> : <Eye size={14} className="mr-1.5" />}
                                            {showTaxDetail ? "Hide tax detail" : "Show tax detail"}
                                        </Button>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className={`w-full text-sm ${showTaxDetail ? "min-w-4xl" : "min-w-176"}`}>
                                            <thead className="border-b bg-muted text-xs text-muted-foreground">
                                                <tr>
                                                    <th className="px-3 py-2 text-left font-medium">Month</th>
                                                    <th className="px-3 py-2 text-right font-medium">Purchase</th>
                                                    <th className="px-3 py-2 text-right font-medium">Sale</th>
                                                    {showTaxDetail && (
                                                        <>
                                                            <th className="px-3 py-2 text-right font-medium">Output tax</th>
                                                            <th className="px-3 py-2 text-right font-medium">Input tax</th>
                                                        </>
                                                    )}
                                                    <th className="px-3 py-2 text-right font-medium">Cost this month</th>
                                                    <th className="px-3 py-2 text-right font-medium">Final payable</th>
                                                    <th className="px-3 py-2 text-right font-medium">Deposit</th>
                                                    <th className="px-3 py-2 text-right font-medium">Deposit limit</th>
                                                    <th className="px-3 py-2 text-right font-medium">Limit left</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {fy.months.map((m) => (
                                                    <tr
                                                        key={m.yearMonth}
                                                        className={`border-b last:border-0 hover:bg-muted/40 cursor-pointer ${!m.depositOk ? "bg-amber-50/30 dark:bg-amber-950/10" : ""}`}
                                                        onClick={() => openMonth(m.yearMonth)}
                                                        title="Click to open the monthly detail"
                                                    >
                                                        <td className="px-3 py-2.5 font-medium text-foreground">{m.monthLabel}</td>
                                                        <td className="px-3 py-2.5 text-right font-mono">
                                                            {fmt(m.purchase.effective)}
                                                            {m.purchase.isOverridden && <span className="ml-1 text-[10px] text-amber-600">M</span>}
                                                        </td>
                                                        <td className="px-3 py-2.5 text-right font-mono">
                                                            {fmt(m.sale.effective)}
                                                            {m.sale.isOverridden && <span className="ml-1 text-[10px] text-amber-600">M</span>}
                                                        </td>
                                                        {showTaxDetail && (
                                                            <>
                                                                <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{fmt(m.outputTax)}</td>
                                                                <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{fmt(m.inputTax)}</td>
                                                            </>
                                                        )}
                                                        <td className={`px-3 py-2.5 text-right font-mono ${m.cost > 0 ? "text-red-600" : "text-emerald-600"
                                                            }`}>
                                                            {fmt(m.cost)}
                                                        </td>
                                                        <td className={`px-3 py-2.5 text-right font-mono font-medium ${m.finalPayable > 0 ? "text-red-600" : "text-emerald-600"
                                                            }`}>
                                                            {fmt(m.finalPayable)}
                                                        </td>
                                                        <td className="px-3 py-2.5 text-right font-mono">
                                                            {fmt(m.deposit.effective)}
                                                            {m.deposit.isOverridden && <span className="ml-1 text-[10px] text-amber-600">M</span>}
                                                        </td>
                                                        <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                                                            {fmt(m.maxDeposit)}
                                                        </td>
                                                        <td className={`px-3 py-2.5 text-right font-mono font-medium ${
                                                            m.depositLimitLeft < 0 ? "text-red-600" : "text-emerald-600"
                                                        }`}>
                                                            {fmt(m.depositLimitLeft)}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                            <tfoot className="border-t bg-muted/30 font-semibold">
                                                <tr>
                                                    <td className="px-3 py-2.5">FY total</td>
                                                    <td className="px-3 py-2.5 text-right font-mono">{fmt(fy.totals.purchase)}</td>
                                                    <td className="px-3 py-2.5 text-right font-mono">{fmt(fy.totals.sale)}</td>
                                                    {showTaxDetail && (
                                                        <>
                                                            <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{fmt(fy.totals.outputTax)}</td>
                                                            <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{fmt(fy.totals.inputTax)}</td>
                                                        </>
                                                    )}
                                                    <td className={`px-3 py-2.5 text-right font-mono ${fy.fy.costThisFy > 0 ? "text-red-600" : "text-emerald-600"
                                                        }`}>
                                                        {fmt(fy.fy.costThisFy)}
                                                    </td>
                                                    <td className={`px-3 py-2.5 text-right font-mono ${fy.fy.costThisFy > 0 ? "text-red-600" : "text-emerald-600"
                                                        }`}>
                                                        {fmt(fy.fy.costThisFy)}
                                                    </td>
                                                    <td className="px-3 py-2.5 text-right font-mono">{fmt(fy.totals.deposit)}</td>
                                                    <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                                                        {fmt(fy.totals.maxDeposit)}
                                                    </td>
                                                    <td className={`px-3 py-2.5 text-right font-mono ${
                                                        fy.totals.depositLimitLeft < 0 ? "text-red-600" : "text-emerald-600"
                                                    }`}>
                                                        {fmt(fy.totals.depositLimitLeft)}
                                                    </td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </div>
                                </div>

                                <div className={`rounded-lg border p-4 shadow-sm ${fy.presumptive.withinLimit
                                    ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/30"
                                    : "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/30"
                                    }`}>
                                    <div className="flex items-center gap-2 text-sm font-medium">
                                        {fy.presumptive.withinLimit
                                            ? <CheckCircle2 size={18} className="text-emerald-600" />
                                            : <AlertTriangle size={18} className="text-amber-600" />}
                                        {fy.presumptive.withinLimit
                                            ? "Bank deposit within the income-tax free limit"
                                            : "Bank deposit past the income-tax free limit"}
                                    </div>
                                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                                        <div>
                                            <div className="text-muted-foreground">Deposit this FY</div>
                                            <div className="font-mono text-sm text-foreground">{fmt(fy.presumptive.deposit)}</div>
                                        </div>
                                        <div>
                                            <div className="text-muted-foreground">
                                                Deemed income @ {fy.config.presumptiveRatePercent}%
                                            </div>
                                            <div className="font-mono text-sm text-foreground">{fmt(fy.presumptive.presumptiveIncome)}</div>
                                        </div>
                                        <div>
                                            <div className="text-muted-foreground">Tax-free limit</div>
                                            <div className="font-mono text-sm text-foreground">{fmt(fy.presumptive.taxFreeLimit)}</div>
                                        </div>
                                        <div>
                                            <div className="text-muted-foreground">
                                                {fy.presumptive.headroom >= 0 ? "Deposit headroom" : "Deposit over by"}
                                            </div>
                                            <div className={`font-mono text-sm ${fy.presumptive.headroom >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                                                {fmt(Math.abs(fy.presumptive.headroom))}
                                            </div>
                                        </div>
                                    </div>
                                    <p className="mt-3 text-xs text-muted-foreground">
                                        {fy.config.presumptiveRatePercent}% of bank deposit counts as income under
                                        presumptive taxation, and income up to {fmt(fy.presumptive.taxFreeLimit)} pays no
                                        income tax — so deposit can reach{" "}
                                        <span className="text-foreground font-mono">{fmt(fy.presumptive.maxDeposit)}</span>{" "}
                                        in {fy.fy.label} before tax starts.
                                    </p>
                                </div>

                                <div className="rounded-lg border border-border bg-card p-4 shadow-sm text-sm space-y-1.5">
                                    <div className="font-medium text-foreground">How {fy.fy.label} settles</div>
                                    <p className="text-muted-foreground text-xs">
                                        Cost this FY {fmt(fy.fy.costThisFy)} plus {fmt(fy.fy.carryIn)} carried in
                                        = {fmt(fy.fy.costIncurred)} against a
                                        budget of {fmt(fy.fy.budget)}. Budget absorbs {fmt(fy.fy.costAbsorbed)};{" "}
                                        {fy.fy.carryOut > 0
                                            ? `${fmt(fy.fy.carryOut)} carries into ${fyLabel(fy.fy.fyStartYear + 1)} unless you pay it as extra cost.`
                                            : "nothing carries forward."}
                                    </p>
                                    <p className="text-muted-foreground text-xs">
                                        A month costs (sale − purchase) × {fy.config.taxRatePercent}% — negative when
                                        purchase leads. Final payable carries that forward month by month.
                                    </p>
                                    <p className="text-muted-foreground text-xs">
                                        Three rules to hold: GST cost under the FY budget · bank deposit at least{" "}
                                        {fy.config.depositGapPercent}% below sale each month · bank deposit under{" "}
                                        {fmt(fy.presumptive.maxDeposit)} for the FY, so deemed income stays inside the
                                        income-tax free limit.
                                    </p>
                                    <p className="text-muted-foreground text-xs">
                                        &ldquo;M&rdquo; against a figure means it is a manual override, not the computed value.
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
