"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash2, X, CalendarRange, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { extractApiError } from "@/shared/lib/api";
import { parseDecimalInput } from "@/shared/lib/format";
import { DEFAULT_TIER_FROM_DAY, DEFAULT_TIER_TO_DAY } from "@/shared/lib/schemas/customerTierSchemas";
import { type TierCurrentSaleScope } from "@/shared/lib/pricing";

// A level inside a period — "Gold" of "Best of the month".
interface Level {
    id: number;
    name: string;
    minSpend: string | number;
    discountPct: string | number;
    enabled: boolean;
    sortOrder: number;
}

// A period: the title customers compete for, plus the bracket of days-ago it counts.
interface Period {
    id: number;
    name: string;
    fromDay: number;
    toDay: number;
    /** Who the bill on the counter counts for. Needs fromDay 0, or currentSaleOnly. */
    currentSaleScope: TierCurrentSaleScope;
    /** Score only the bill on the counter — history and the days are ignored. */
    currentSaleOnly: boolean;
    enabled: boolean;
    sortOrder: number;
    levels: Level[];
}

const onlyDigits = (s: string) => s.replace(/[^\d]/g, "");
const MAX_DAY = 3650;

export function CustomerTiers() {
    const [periods, setPeriods] = useState<Period[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);
    const [name, setName] = useState("");
    const [fromDay, setFromDay] = useState("");
    const [toDay, setToDay] = useState("");
    const [adding, setAdding] = useState(false);

    function load() {
        axios
            .get<Period[]>("/api/customer-tier-periods")
            .then((r) => setPeriods(r.data))
            .catch(() => toast.error("Failed to load periods"))
            .finally(() => setLoading(false));
    }
    useEffect(load, []);

    async function addPeriod() {
        if (!name.trim()) return toast.error("Name the period");
        const f = Number(fromDay || "0"), t = Number(toDay);
        if (!Number.isInteger(f) || f < 0 || f > MAX_DAY) return toast.error(`From-day must be 0 to ${MAX_DAY}`);
        if (!Number.isInteger(t) || t < 0 || t > MAX_DAY) return toast.error(`To-day must be 0 to ${MAX_DAY}`);
        if (t <= f) return toast.error("The bracket must end further back than it starts");
        setAdding(true);
        try {
            await axios.post("/api/customer-tier-periods", { name: name.trim(), fromDay: f, toDay: t });
            toast.success("Period added");
            setName(""); setFromDay(""); setToDay(""); setShowAdd(false);
            load();
        } catch (e) {
            toast.error(extractApiError(e, "Failed to add period"));
        } finally {
            setAdding(false);
        }
    }

    return (
        <div className="space-y-3">
            {/* Toolbar — the page header already explains the feature, so this only
                carries the stacking rule and the add action. */}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                    Each period counts one slice of the past and applies on its own — a customer&rsquo;s titles add up.
                    Tile the days (0&ndash;30, 30&ndash;90, …) so each sale is rewarded once.
                </p>
                <DiscountGuard />
                {!showAdd && (
                    <Button size="sm" variant="outline" className="shrink-0" onClick={() => setShowAdd(true)}>
                        <Plus size={14} className="mr-1" /> Add period
                    </Button>
                )}
            </div>

            {showAdd && (
                <div className="space-y-3 rounded-lg border border-dashed border-border/70 bg-muted/20 p-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">New period</span>
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setShowAdd(false)}><X size={14} /></Button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                        <div className="space-y-1">
                            <Label className="text-[11px] text-muted-foreground">Title</Label>
                            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Best of the quarter" className="h-9" />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-[11px] text-muted-foreground">Count spend from … to … days ago</Label>
                            <div className="flex items-center gap-1.5">
                                <Input inputMode="numeric" value={fromDay} onChange={(e) => setFromDay(onlyDigits(e.target.value))} placeholder={String(DEFAULT_TIER_FROM_DAY)} className="h-9 text-right" />
                                <span className="text-xs text-muted-foreground">to</span>
                                <Input inputMode="numeric" value={toDay} onChange={(e) => setToDay(onlyDigits(e.target.value))} placeholder={String(DEFAULT_TIER_TO_DAY)} className="h-9 text-right" />
                            </div>
                        </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                        0 is today. The levels are copied from the first period — then tune the amounts for this slice.
                    </p>
                    <div className="flex justify-end">
                        <Button size="sm" onClick={addPeriod} disabled={adding}><Plus size={14} className="mr-1" /> Add period</Button>
                    </div>
                </div>
            )}

            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : periods.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/70 py-8 text-center text-sm text-muted-foreground">
                    No periods — add one (say &ldquo;Best of the month&rdquo;) to start giving titles.
                </div>
            ) : (
                /* Each period is its own card, side by side — periods grow outwards
                   rather than pushing the page down. */
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {periods.map((p) => <PeriodCard key={p.id} period={p} onChanged={load} />)}
                </div>
            )}
        </div>
    );
}

// The global discount guard. Deliberately NOT a spend-tier setting of its own: it caps
// coupon + spend-tier + loyalty on a bill together, and the same value is edited from the
// Coupons page ("Discount guard" card). Kept here because stacked titles are the easiest
// way to run the bill away from you, so the ceiling belongs where the stack is built.
function DiscountGuard() {
    const [value, setValue] = useState("");   // "" = no cap (stored as null)
    const [saved, setSaved] = useState("");
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        axios.get<{ maxTotalDiscountPct: string | number | null }>("/api/coupons/config")
            .then((r) => {
                const v = r.data.maxTotalDiscountPct == null ? "" : String(Number(r.data.maxTotalDiscountPct));
                setValue(v);
                setSaved(v);
            })
            .catch(() => toast.error("Failed to load the discount guard"))
            .finally(() => setLoaded(true));
    }, []);

    async function save() {
        if (value === saved) return;
        const pct = value.trim() === "" ? null : Number(value);
        if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
            toast.error("Enter a cap between 0 and 100, or leave it blank for none");
            return setValue(saved);
        }
        try {
            await axios.patch("/api/coupons/config", { maxTotalDiscountPct: pct });
            setSaved(value);
            toast.success(pct === null ? "Discount cap removed" : `Total discount capped at ${pct}%`);
        } catch (e) {
            toast.error(extractApiError(e, "Failed to save the discount guard"));
            setValue(saved);
        }
    }

    if (!loaded) return null;
    return (
        <div
            className="flex shrink-0 items-center gap-1.5"
            title="Caps the total discount on any bill — spend-tier titles + coupon + loyalty combined — as a % of goods value. Shared with the Coupons page. Blank = no cap."
        >
            <Shield size={13} className="text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Max total discount</span>
            <div className="relative w-16">
                <Input
                    inputMode="decimal"
                    value={value}
                    onChange={(e) => setValue(parseDecimalInput(e.target.value))}
                    onBlur={save}
                    placeholder="none"
                    className="h-8 w-full pr-4 text-right text-xs"
                />
                <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
            </div>
        </div>
    );
}

// One period and the levels inside it. Every edit round-trips to the server and
// then asks the parent to reload, so the list always matches what is stored.
function PeriodCard({ period, onChanged }: { period: Period; onChanged: () => void }) {
    // Raw box text for the window; committed on blur and rolled back if rejected.
    const [fromInput, setFromInput] = useState(String(period.fromDay));
    const [toInput, setToInput] = useState(String(period.toDay));
    const [showAddLevel, setShowAddLevel] = useState(false);
    const [levelName, setLevelName] = useState("");
    const [minSpend, setMinSpend] = useState("");
    const [discountPct, setDiscountPct] = useState("");
    const [adding, setAdding] = useState(false);

    useEffect(() => { setFromInput(String(period.fromDay)); }, [period.fromDay]);
    useEffect(() => { setToInput(String(period.toDay)); }, [period.toDay]);

    async function patchPeriod(patch: Partial<Pick<Period, "name" | "enabled" | "fromDay" | "toDay" | "currentSaleScope" | "currentSaleOnly">>) {
        try {
            await axios.patch(`/api/customer-tier-periods/${period.id}`, patch);
            onChanged();
        } catch (e) {
            toast.error(extractApiError(e, "Failed to update period"));
        }
    }

    // One bracket edge at a time. Checked against the other stored edge so the slice
    // can never be saved inverted or empty; rolls back the box when it is.
    async function saveEdge(edge: "fromDay" | "toDay") {
        const raw = edge === "fromDay" ? fromInput : toInput;
        const reset = () => (edge === "fromDay" ? setFromInput(String(period.fromDay)) : setToInput(String(period.toDay)));
        const v = Number(raw);
        if (v === period[edge]) return;
        if (raw === "" || !Number.isInteger(v) || v < 0 || v > MAX_DAY) {
            toast.error(`Enter a day between 0 and ${MAX_DAY}`);
            return reset();
        }
        const fromDay = edge === "fromDay" ? v : period.fromDay;
        const toDay = edge === "toDay" ? v : period.toDay;
        if (toDay <= fromDay) {
            toast.error(`${fromDay} to ${toDay} days is an empty slice — the end must be further back than the start`);
            return reset();
        }
        await patchPeriod({ [edge]: v });
    }

    async function removePeriod() {
        try {
            await axios.delete(`/api/customer-tier-periods/${period.id}`);
            onChanged();
        } catch (e) {
            toast.error(extractApiError(e, "Failed to delete period"));
        }
    }

    async function addLevel() {
        if (!levelName.trim()) return toast.error("Name the level");
        const ms = Number(minSpend), dp = Number(discountPct);
        if (!Number.isFinite(ms) || !Number.isFinite(dp)) return toast.error("Enter a spend threshold and discount %");
        setAdding(true);
        try {
            await axios.post("/api/customer-tiers", { name: levelName.trim(), minSpend: ms, discountPct: dp, periodId: period.id });
            toast.success("Level added");
            setLevelName(""); setMinSpend(""); setDiscountPct(""); setShowAddLevel(false);
            onChanged();
        } catch (e) {
            toast.error(extractApiError(e, "Failed to add level"));
        } finally {
            setAdding(false);
        }
    }

    async function patchLevel(id: number, patch: Partial<Pick<Level, "name" | "enabled">> & { minSpend?: number; discountPct?: number }) {
        try {
            await axios.patch(`/api/customer-tiers/${id}`, patch);
            onChanged();
        } catch {
            toast.error("Failed to update level");
        }
    }

    async function removeLevel(id: number) {
        try {
            await axios.delete(`/api/customer-tiers/${id}`);
            onChanged();
        } catch {
            toast.error("Failed to delete level");
        }
    }

    return (
        <Card className={`gap-0 overflow-hidden py-0 ${period.enabled ? "" : "opacity-50"}`}>
            {/* Period header. Two rows: the title gets a whole line to itself so it is
                never the thing that gets squeezed, and the bracket + controls share the
                second. Cheaper than it looks — the row it replaces had already wrapped. */}
            <div className="space-y-1.5 border-b border-border/60 bg-muted/20 px-2.5 py-2">
                <div className="flex items-center gap-1.5">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                        <CalendarRange size={13} />
                    </span>
                    <Input
                        defaultValue={period.name}
                        key={period.name}
                        onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== period.name) patchPeriod({ name: v }); }}
                        className="h-8 min-w-0 flex-1 text-sm font-medium"
                        placeholder="Best of the month"
                    />
                    <Switch className="shrink-0" checked={period.enabled} onCheckedChange={(v) => patchPeriod({ enabled: v })} />
                    <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={removePeriod} title="Delete this period and its levels">
                        <Trash2 size={14} className="text-destructive" />
                    </Button>
                </div>
                {/* The days stop applying once the period scores the bill alone. */}
                <div className={`flex items-center gap-1.5 pl-[30px] ${period.currentSaleOnly ? "pointer-events-none opacity-40" : ""}`}>
                    <span className="text-[11px] text-muted-foreground" title="Only spend in this slice of the past counts towards this title. 0 is today.">
                        spend from
                    </span>
                    <Input
                        inputMode="numeric"
                        value={fromInput}
                        onChange={(e) => setFromInput(onlyDigits(e.target.value))}
                        onBlur={() => saveEdge("fromDay")}
                        className="h-7 w-12 text-right text-xs"
                        disabled={period.currentSaleOnly}
                    />
                    <span className="text-[11px] text-muted-foreground">to</span>
                    <Input
                        inputMode="numeric"
                        value={toInput}
                        onChange={(e) => setToInput(onlyDigits(e.target.value))}
                        onBlur={() => saveEdge("toDay")}
                        className="h-7 w-12 text-right text-xs"
                        disabled={period.currentSaleOnly}
                    />
                    <span className="text-[11px] text-muted-foreground">days ago</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-[30px]">
                    {/* The current sale is today, so a bracket must start at day 0 to hold
                        it — unless the period drops the bracket and scores the bill alone. */}
                    {(period.fromDay === 0 || period.currentSaleOnly) && (
                        <>
                            <span
                                className="text-[11px] text-muted-foreground"
                                title="Adds the bill being rung up (before discount) to this period's spend, so a customer can earn a level on that very bill."
                            >
                                current sale for
                            </span>
                            <select
                                value={period.currentSaleScope}
                                onChange={(e) => patchPeriod({ currentSaleScope: e.target.value as TierCurrentSaleScope })}
                                className="h-7 rounded-md border border-input bg-transparent px-1.5 text-[11px]"
                            >
                                <option value="NONE">no one</option>
                                <option value="NEW">new customers</option>
                                <option value="RETURNING">returning customers</option>
                                <option value="ALL">everyone</option>
                            </select>
                        </>
                    )}
                    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Checkbox
                            checked={period.currentSaleOnly}
                            onCheckedChange={(v) => patchPeriod({ currentSaleOnly: v === true })}
                            className="h-3.5 w-3.5"
                        />
                        <span title="Score ONLY the bill on the counter — ignore posted history and the days above. Makes a scoped period airtight: a customer the scope excludes has no bracket to earn a title through.">
                            only
                        </span>
                    </label>
                    {!showAddLevel && (
                        <Button size="sm" variant="ghost" className="ml-auto h-7 shrink-0 px-2 text-xs" onClick={() => setShowAddLevel(true)}>
                            <Plus size={13} className="mr-1" /> Level
                        </Button>
                    )}
                </div>
            </div>

            <div className="space-y-2 p-2.5">
                {showAddLevel && (
                    <div className="space-y-3 rounded-lg border border-dashed border-border/70 bg-muted/20 p-3">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground">New level in &ldquo;{period.name}&rdquo;</span>
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setShowAddLevel(false)}><X size={14} /></Button>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-3">
                            <div className="space-y-1">
                                <Label className="text-[11px] text-muted-foreground">Name</Label>
                                <Input value={levelName} onChange={(e) => setLevelName(e.target.value)} placeholder="Gold" className="h-9" />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-[11px] text-muted-foreground">Spend in days {period.fromDay}&ndash;{period.toDay} ≥</Label>
                                <div className="relative">
                                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span>
                                    <Input inputMode="decimal" value={minSpend} onChange={(e) => setMinSpend(parseDecimalInput(e.target.value))} placeholder="50000" className="h-9 pl-6 text-right" />
                                </div>
                            </div>
                            <div className="space-y-1">
                                <Label className="text-[11px] text-muted-foreground">Discount %</Label>
                                <Input inputMode="decimal" value={discountPct} onChange={(e) => setDiscountPct(parseDecimalInput(e.target.value))} placeholder="5" className="h-9 text-right" />
                            </div>
                        </div>
                        <div className="flex justify-end">
                            <Button size="sm" onClick={addLevel} disabled={adding}><Plus size={14} className="mr-1" /> Add level</Button>
                        </div>
                    </div>
                )}

                {period.levels.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/70 py-6 text-center text-xs text-muted-foreground">
                        No levels in this period yet — add one to give an automatic discount.
                    </div>
                ) : (
                    <ul className="divide-y rounded-lg border border-border/60">
                        {period.levels.map((t) => (
                            <li key={t.id} className={`flex items-center gap-1.5 px-2 py-1.5 ${t.enabled ? "" : "opacity-50"}`}>
                                <Input
                                    defaultValue={t.name}
                                    key={t.name}
                                    onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.name) patchLevel(t.id, { name: v }); }}
                                    className="h-8 w-24 shrink-0 text-xs font-medium"
                                />
                                <div className="relative min-w-0 flex-1" title={`Spend between ${period.fromDay} and ${period.toDay} days ago to reach this level`}>
                                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">₹</span>
                                    <Input
                                        defaultValue={String(Number(t.minSpend))}
                                        key={String(t.minSpend)}
                                        onBlur={(e) => { const v = Number(parseDecimalInput(e.target.value)); if (Number.isFinite(v) && v !== Number(t.minSpend)) patchLevel(t.id, { minSpend: v }); }}
                                        className="h-8 w-full pl-5 text-right text-xs"
                                    />
                                </div>
                                <div className="relative w-14 shrink-0" title="Discount % at this level">
                                    <Input
                                        defaultValue={String(Number(t.discountPct))}
                                        key={String(t.discountPct)}
                                        onBlur={(e) => { const v = Number(parseDecimalInput(e.target.value)); if (Number.isFinite(v) && v !== Number(t.discountPct)) patchLevel(t.id, { discountPct: v }); }}
                                        className="h-8 w-full pr-4 text-right text-xs"
                                    />
                                    <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                                </div>
                                <Switch className="shrink-0" checked={t.enabled} onCheckedChange={(v) => patchLevel(t.id, { enabled: v })} />
                                <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => removeLevel(t.id)}>
                                    <Trash2 size={13} className="text-destructive" />
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </Card>
    );
}
