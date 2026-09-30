"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { extractApiError } from "@/shared/lib/api";
import { formatRupees } from "@/shared/lib/format/moneyInr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseDecimalInput, parseDigitsInput } from "@/shared/lib/format";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface CreditLimitConfig {
    id: number;
    autoEnabled: boolean;
    windowDays: number;
    pctOfSales: string | number;
    maxAutoLimit: string | number | null;
    roundToStep: number;
}

// Repo rule: no <input type="number"> — the shared sanitisers, digits + a single dot.
const digitsOnly = parseDigitsInput;
const decimalOnly = parseDecimalInput;

export function CreditLimitConfigForm() {
    const [data, setData] = useState<CreditLimitConfig | null>(null);
    const [draft, setDraft] = useState<CreditLimitConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const load = useCallback((silent = false) => {
        axios.get<CreditLimitConfig>("/api/settings/credit-limit")
            .then((res) => { setData(res.data); setDraft(res.data); })
            .catch(() => { if (!silent) toast.error("Failed to load credit-limit config"); })
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { load(); }, [load]);

    function set<K extends keyof CreditLimitConfig>(key: K, value: CreditLimitConfig[K]) {
        setDraft((d) => d && { ...d, [key]: value });
    }

    async function handleSave() {
        if (!draft) return;
        setSaving(true);
        try {
            const payload = {
                autoEnabled: draft.autoEnabled,
                windowDays: Number(draft.windowDays) || 1,
                pctOfSales: Number(draft.pctOfSales) || 0,
                maxAutoLimit:
                    draft.maxAutoLimit === null || String(draft.maxAutoLimit).trim() === ""
                        ? null
                        : Number(draft.maxAutoLimit),
                roundToStep: Number(draft.roundToStep) || 0,
            };
            const { data: saved } = await axios.patch<CreditLimitConfig>("/api/settings/credit-limit", payload);
            setData(saved);
            setDraft(saved);
            toast.success("Credit-limit settings saved");
        } catch (err) {
            toast.error(extractApiError(err, "Failed to save"));
        } finally {
            setSaving(false);
        }
    }

    const dirty = JSON.stringify(draft) !== JSON.stringify(data);

    // Credit policy is one shared setting — two admins on it at once should not
    // silently overwrite each other. Held back while this form is dirty, since
    // the reload replaces `draft` and would take the unsaved edit with it.
    useRealtimeTopics(["settings", "ledger"], () => { load(true); }, !dirty && !saving);

    if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
    if (!draft) return <p className="text-sm text-destructive">Failed to load settings.</p>;

    const pct = Number(draft.pctOfSales) || 0;
    const days = Number(draft.windowDays) || 0;
    // A worked example so the admin can read the formula back at a glance.
    const exampleSales = 100_000;
    const exampleAuto = Math.round((exampleSales * pct) / 100);

    return (
        <div className="space-y-6">
            {/* Master toggle */}
            <section className="rounded-lg border bg-card p-4 space-y-4">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <h2 className="text-sm font-semibold">Auto credit limit for all customers</h2>
                        <p className="text-xs text-muted-foreground">
                            When ON, every customer earns a credit limit sized from their own recent sales.
                            The limit enforced at the register is the <span className="font-medium">higher</span> of
                            this auto number and any manual limit set on the customer. When OFF, only manual
                            limits apply (no limit = cash-only).
                        </p>
                    </div>
                    <Switch
                        checked={draft.autoEnabled}
                        disabled={saving}
                        onCheckedChange={(v) => set("autoEnabled", v)}
                        aria-label="Enable auto credit limit"
                    />
                </div>
            </section>

            {/* Formula */}
            <section className={`rounded-lg border bg-card p-4 space-y-4 ${draft.autoEnabled ? "" : "opacity-60"}`}>
                <div>
                    <h2 className="text-sm font-semibold">Calculation</h2>
                    <p className="text-xs text-muted-foreground">
                        Auto limit = <span className="font-medium">Y%</span> of the customer&apos;s posted sales in
                        the last <span className="font-medium">X days</span>.
                    </p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                        <Label className="text-xs">Percent of sales (Y%)</Label>
                        <div className="flex items-center gap-2">
                            <Input
                                inputMode="decimal"
                                className="h-9 max-w-[140px]"
                                placeholder="e.g. 10"
                                value={String(draft.pctOfSales ?? "")}
                                onChange={(e) => set("pctOfSales", decimalOnly(e.target.value))}
                                disabled={!draft.autoEnabled}
                            />
                            <span className="text-sm text-muted-foreground">%</span>
                        </div>
                    </div>

                    <div className="space-y-1">
                        <Label className="text-xs">Sales window (X days)</Label>
                        <div className="flex items-center gap-2">
                            <Input
                                inputMode="numeric"
                                className="h-9 max-w-[140px]"
                                placeholder="e.g. 90"
                                value={String(draft.windowDays ?? "")}
                                onChange={(e) => set("windowDays", Number(digitsOnly(e.target.value)) || 0)}
                                disabled={!draft.autoEnabled}
                            />
                            <span className="text-sm text-muted-foreground">days</span>
                        </div>
                    </div>

                    <div className="space-y-1">
                        <Label className="text-xs">Round to nearest (₹) — optional</Label>
                        <Input
                            inputMode="numeric"
                            className="h-9 max-w-[140px]"
                            placeholder="0 = no rounding"
                            value={draft.roundToStep ? String(draft.roundToStep) : ""}
                            onChange={(e) => set("roundToStep", Number(digitsOnly(e.target.value)) || 0)}
                            disabled={!draft.autoEnabled}
                        />
                    </div>

                    <div className="space-y-1">
                        <Label className="text-xs">Maximum auto limit (₹) — optional</Label>
                        <Input
                            inputMode="decimal"
                            className="h-9 max-w-[180px]"
                            placeholder="No ceiling"
                            value={draft.maxAutoLimit == null ? "" : String(draft.maxAutoLimit)}
                            onChange={(e) => {
                                const v = decimalOnly(e.target.value);
                                set("maxAutoLimit", v === "" ? null : v);
                            }}
                            disabled={!draft.autoEnabled}
                        />
                    </div>
                </div>

                <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                    Example: a customer who bought {formatRupees(exampleSales)} in the last {days || "X"} days gets an
                    auto limit of <span className="font-medium text-foreground">{formatRupees(exampleAuto)}</span>
                    {" "}({pct || "Y"}% of sales)
                    {draft.roundToStep ? `, rounded to the nearest ${formatRupees(draft.roundToStep)}` : ""}
                    {draft.maxAutoLimit != null && String(draft.maxAutoLimit).trim() !== ""
                        ? `, capped at ${formatRupees(Number(draft.maxAutoLimit))}`
                        : ""}
                    .
                </p>
            </section>

            <div className="flex justify-end">
                <Button onClick={handleSave} disabled={saving || !dirty} size="sm">
                    <Save className="mr-1.5 size-3.5" />
                    {saving ? "Saving…" : "Save settings"}
                </Button>
            </div>
        </div>
    );
}
