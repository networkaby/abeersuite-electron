"use client";

// Settings → Services — manage the catalogue of services the business sells or
// buys. Each service = name + ledger + GST rate (+ optional default tax-inclusive
// price). Added by name from "Add service" on the POS cart and on every office
// trading voucher; posts GL-only (never stock) as a tax-bearing charge row.
//
// ONE ledger covers both sides of the trade. Selling the service CREDITS it and
// buying it DEBITS the same ledger, because postInvVoucher takes a charge row's
// direction from the voucher type. So the ledger reads as what the work earned
// NET — sold minus bought — and no second "expense" ledger is configured here.

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/shared/components/NumericInput";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GlAccountCombobox, type GlAccount } from "@/modules/accountancy/components/GlAccountCombobox";
import { extractApiError } from "@/shared/lib/api";
import { confirmAction } from "@/shared/lib/ui/confirmStore";

type GstRateOpt = { id: number; rate: string | number; label: string; isActive: boolean };

type ServiceRow = {
    id: number;
    name: string;
    accountId: number;
    gstRateId: number | null;
    defaultPricePaise: number | null;
    sortOrder: number;
    isActive: boolean;
    account: { id: number; name: string };
    gstRate: { id: number; rate: string | number; label: string } | null;
};

const NO_TAX = "none"; // Select sentinel — SelectItem can't carry an empty value

export function PosServicesManager() {
    const [rows, setRows] = useState<ServiceRow[]>([]);
    const [incomeAccounts, setIncomeAccounts] = useState<GlAccount[]>([]);
    const [gstRates, setGstRates] = useState<GstRateOpt[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Draft for the "add service" row.
    const [draftName, setDraftName] = useState("");
    const [draftAccountId, setDraftAccountId] = useState<number | null>(null);
    const [draftGstRateId, setDraftGstRateId] = useState<number | null>(null);
    const [draftPriceStr, setDraftPriceStr] = useState("");

    // Default the draft's tax to the 18% rate once the rates load.
    const default18 = useMemo(
        () => gstRates.find((r) => Number(r.rate) === 18) ?? null,
        [gstRates],
    );
    useEffect(() => {
        if (default18 && draftGstRateId === null) setDraftGstRateId(default18.id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [default18]);

    const load = useCallback((silent = false) => {
        Promise.all([
            axios.get<ServiceRow[]>("/api/settings/pos-services"),
            axios.get<GlAccount[]>("/api/accountancy/gl-accounts?includeParties=false&type=INCOME"),
            axios.get<GstRateOpt[]>("/api/inventory/gst-rates"),
        ])
            .then(([svc, accts, rates]) => {
                setRows(svc.data);
                setIncomeAccounts(accts.data);
                setGstRates(rates.data.filter((r) => r.isActive));
            })
            .catch(() => { if (!silent) toast.error("Could not load POS services"); })
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { load(); }, [load]);

    // Services, their income ledgers and the GST rates behind them are all
    // shared config. The draft row being typed above is separate state.
    useRealtimeTopics(["catalogue", "ledger"], () => { load(true); });

    const addService = async () => {
        const name = draftName.trim();
        if (!name) { toast.error("Give the service a name"); return; }
        if (draftAccountId == null) { toast.error("Pick the income ledger"); return; }
        const price = parseFloat(draftPriceStr);
        setSaving(true);
        try {
            const { data } = await axios.post<ServiceRow>("/api/settings/pos-services", {
                name,
                accountId: draftAccountId,
                gstRateId: draftGstRateId,
                defaultPricePaise: Number.isFinite(price) && price > 0 ? Math.round(price * 100) : null,
            });
            setRows((p) => [...p, data]);
            setDraftName("");
            setDraftAccountId(null);
            setDraftGstRateId(default18?.id ?? null);
            setDraftPriceStr("");
            toast.success(`Service "${data.name}" added`);
        } catch (e) {
            toast.error(extractApiError(e, "Could not add the service"));
        } finally {
            setSaving(false);
        }
    };

    const patchService = async (id: number, patch: Record<string, unknown>) => {
        try {
            const { data } = await axios.patch<ServiceRow>(`/api/settings/pos-services/${id}`, patch);
            setRows((p) => p.map((r) => (r.id === id ? data : r)));
        } catch (e) {
            toast.error(extractApiError(e, "Could not update the service"));
        }
    };

    const removeService = async (row: ServiceRow) => {
        if (!(await confirmAction({ title: `Delete service "${row.name}"?`, body: `Posted sales are not affected.`, confirmLabel: "Delete" }))) return;
        try {
            await axios.delete(`/api/settings/pos-services/${row.id}`);
            setRows((p) => p.filter((r) => r.id !== row.id));
        } catch (e) {
            toast.error(extractApiError(e, "Could not delete the service"));
        }
    };

    if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

    return (
        <div className="space-y-4">
            {/* Existing services */}
            <div className="rounded-lg border border-border">
                <div className="grid grid-cols-[1.2fr_1.4fr_150px_120px_70px_40px] items-center gap-2 border-b border-border bg-muted/50 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    <span>Service</span>
                    <span>Income ledger</span>
                    <span>GST</span>
                    <span>Default price ₹</span>
                    <span>Active</span>
                    <span />
                </div>
                {rows.length === 0 && (
                    <p className="px-3 py-4 text-sm text-muted-foreground">No services yet — add the first one below.</p>
                )}
                {rows.map((row) => (
                    <div key={row.id} className="grid grid-cols-[1.2fr_1.4fr_150px_120px_70px_40px] items-center gap-2 border-b border-border px-3 py-2 last:border-b-0">
                        <Input
                            defaultValue={row.name}
                            onBlur={(e) => {
                                const v = e.target.value.trim();
                                if (v && v !== row.name) void patchService(row.id, { name: v });
                            }}
                            className="h-8 text-sm"
                        />
                        <GlAccountCombobox
                            value={row.accountId}
                            onChange={(acc) => { if (acc) void patchService(row.id, { accountId: acc.id }); }}
                            accounts={incomeAccounts}
                            placeholder="Income ledger"
                            className="h-8 text-sm"
                        />
                        <Select
                            value={row.gstRateId != null ? String(row.gstRateId) : NO_TAX}
                            onValueChange={(v) => void patchService(row.id, { gstRateId: v === NO_TAX ? null : Number(v) })}
                        >
                            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NO_TAX}>No tax</SelectItem>
                                {gstRates.map((r) => (
                                    <SelectItem key={r.id} value={String(r.id)}>{r.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Input
                            defaultValue={row.defaultPricePaise != null ? (row.defaultPricePaise / 100).toFixed(2) : ""}
                            placeholder="cashier types"
                            inputMode="decimal"
                            onBlur={(e) => {
                                const v = parseFloat(e.target.value);
                                const paise = Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
                                if (paise !== row.defaultPricePaise) void patchService(row.id, { defaultPricePaise: paise });
                            }}
                            className="h-8 text-right text-sm"
                        />
                        <Switch
                            checked={row.isActive}
                            onCheckedChange={(v) => void patchService(row.id, { isActive: v })}
                        />
                        <Button variant="ghost" size="icon-sm" onClick={() => void removeService(row)} title="Delete">
                            <Trash2 size={14} className="text-destructive" />
                        </Button>
                    </div>
                ))}
            </div>

            {/* Add row */}
            <div className="rounded-lg border border-dashed border-border p-3">
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Add service</p>
                <div className="grid grid-cols-[1.2fr_1.4fr_150px_120px_auto] items-center gap-2">
                    <Input
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        placeholder="e.g. Installation, Repair Charge"
                        className="h-8 text-sm"
                    />
                    <GlAccountCombobox
                        value={draftAccountId}
                        onChange={(acc) => setDraftAccountId(acc?.id ?? null)}
                        accounts={incomeAccounts}
                        placeholder="Income ledger (e.g. Service Charges)"
                        className="h-8 text-sm"
                    />
                    <Select
                        value={draftGstRateId != null ? String(draftGstRateId) : NO_TAX}
                        onValueChange={(v) => setDraftGstRateId(v === NO_TAX ? null : Number(v))}
                    >
                        <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="GST" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value={NO_TAX}>No tax</SelectItem>
                            {gstRates.map((r) => (
                                <SelectItem key={r.id} value={String(r.id)}>{r.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <NumericInput
                        mode="decimal"
                        min={0}
                        value={draftPriceStr}
                        onValueChange={setDraftPriceStr}
                        placeholder="Price ₹ (optional)"
                        className="h-8 text-right text-sm"
                    />
                    <Button size="sm" onClick={() => void addService()} disabled={saving}>
                        <Plus size={14} className="mr-1" /> Add
                    </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                    Price is tax-inclusive (what the customer pays). GST defaults to 18% — change it per service if needed.
                    The same ledger is credited when you sell the service and debited when you buy it, so it shows the net.
                </p>
            </div>
        </div>
    );
}
