"use client";

// /office/admin/counters — POS counter management
//
// List every POS counter across every branch, create new counters
// (auto-creates the till GL account), rename, set default float,
// activate/deactivate, or delete (only if no shifts have ever used it).

import { useEffect, useState } from "react";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { toast } from "sonner";
import {
    Plus, Pencil, Trash2, X, Check, Monitor, Building2, ToggleLeft, ToggleRight, Lock, Unlock, Phone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/shared/components/NumericInput";
import { Badge } from "@/components/ui/badge";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmt } from "@/shared/lib/format/moneyInr";
import { GlAccountCombobox, type GlAccount } from "@/modules/accountancy/components/GlAccountCombobox";
import { CHANNEL_LABEL, channelNeedsVpa } from "@/modules/pos/lib/counterTenders";
import { getGatewayProvider } from "@/modules/pos/lib/paymentGateways";
import type { PosPayChannel } from "@/generated/prisma/client";
import { splitExtensions } from "@/shared/lib/counter/idRange";
import { confirmAction } from "@/shared/lib/ui/confirmStore";

type Branch = { id: string; number: number; name: string; isActive: boolean };

// A configured gateway from the Settings → Payment Methods catalog, filtered to
// the ones available at the counter. The counter picks one for a GATEWAY rail.
type CounterGateway = { id: number; displayName: string; provider: string; enabledForCounter: boolean; isActive: boolean };

// One entry of the counter "method" dropdown, built from Settings → Payment
// Methods. A gateway (Razorpay, PayU…) is its own entry and saves as
// GATEWAY + its id; a plain method (UPI, Card…) saves as its channel.
type MethodOption = { key: string; label: string; channel: PosPayChannel; gatewayId: number | null; on: boolean };

const methodKey = (channel: PosPayChannel, gatewayId: number | null) =>
    channel === "GATEWAY" ? `g:${gatewayId ?? "none"}` : `c:${channel}`;

function methodOptions(rows: CounterGateway[]): MethodOption[] {
    const out: MethodOption[] = [];
    for (const g of rows) {
        const prov = getGatewayProvider(g.provider);
        if (!prov?.supportsCounter) continue;
        const gatewayId = prov.channel === "GATEWAY" ? g.id : null;
        const key = methodKey(prov.channel, gatewayId);
        if (out.some((o) => o.key === key)) continue;
        out.push({ key, label: g.displayName, channel: prov.channel, gatewayId, on: g.enabledForCounter && g.isActive });
    }
    return out;
}

// A counter payment account as returned by the API.
type PaymentAccount = {
    id: number;
    channel: PosPayChannel;
    label: string;
    accountId: number;
    account: { id: number; name: string } | null;
    vpa: string | null;
    sortOrder: number;
    isActive: boolean;
    defaultVisible: boolean;
    gatewayId: number | null;
    gateway: { id: number; displayName: string; provider: string } | null;
};

type Counter = {
    id: number;
    counterNumber: number;
    name: string;
    branchId: string;
    branch: { id: string; name: string };
    isActive: boolean;
    epbxExtension: string | null;
    tillAccount: { id: number; name: string; balance: string };
    paymentAccounts: PaymentAccount[];
    allowedExpenseAccountIds: number[];
    totalShifts: number;
    activeShift: { id: number; status: string; user: { name: string } } | null;
    // Device lock — which PC is bound to this counter (null = free). Released here.
    boundDeviceId: string | null;
    boundDeviceLabel: string | null;
    boundAt: string | null;
};

const EMPTY_FORM = { branchId: "", counterNumber: "", name: "" };

// An editable payment-account row (accountId nullable until the ledger is picked).
// gatewayId links a GATEWAY rail to a configured catalog entry (null = none).
type EditPayAcct = { id?: number; channel: PosPayChannel; label: string; accountId: number | null; vpa: string; defaultVisible: boolean; gatewayId: number | null };

type EditForm = {
    name: string;
    counterNumber: string;
    epbxExtension: string;
    paymentAccounts: EditPayAcct[];
    allowedExpenseAccountIds: number[];
};
const EMPTY_EDIT: EditForm = {
    name: "",
    counterNumber: "",
    epbxExtension: "",
    paymentAccounts: [],
    allowedExpenseAccountIds: [],
};

export default function CountersAdminPage() {
    const [counters, setCounters] = useState<Counter[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [glAccounts, setGlAccounts] = useState<GlAccount[]>([]);
    const [expenseAccounts, setExpenseAccounts] = useState<GlAccount[]>([]);
    const [gateways, setGateways] = useState<CounterGateway[]>([]);
    const [loading, setLoading]   = useState(true);
    const [addingNew, setAddingNew] = useState(false);
    const [editId, setEditId]     = useState<number | null>(null);
    const [form, setForm]         = useState(EMPTY_FORM);
    const [editForm, setEditForm] = useState<EditForm>(EMPTY_EDIT);
    const [saving, setSaving]     = useState(false);

    const loadGlAccounts = async () => {
        try {
            const { data } = await axios.get<GlAccount[]>("/api/accountancy/gl-accounts?includeParties=false");
            // Any ASSET-group ledger can receive payment proceeds — Cash-in-Hand,
            // Bank Accounts, or a custom group like "Gateway" under Current Assets
            // (party ledgers already excluded by the API flag).
            setGlAccounts(data.filter((a) => a.group?.type === "ASSET"));
        } catch {
            setGlAccounts([]);
        }
    };

    const loadExpenseAccounts = async () => {
        try {
            const { data } = await axios.get<GlAccount[]>("/api/accountancy/gl-accounts?type=EXPENSE");
            setExpenseAccounts(data);
        } catch {
            setExpenseAccounts([]);
        }
    };

    // Every method under Settings → Payment Methods; the dropdown offers the ones
    // switched on for the counter.
    const loadGateways = async () => {
        try {
            const { data } = await axios.get<{ gateways: CounterGateway[] }>("/api/settings/payment-methods");
            setGateways(data.gateways);
        } catch {
            setGateways([]);
        }
    };

    // No `setLoading(true)` here — the spinner is for the first load only.
    // Re-showing it after every save blanked the list (blink).
    const load = async () => {
        try {
            const [cRes, bRes] = await Promise.all([
                axios.get<Counter[]>("/api/pos/counters?scope=all"),
                axios.get<Branch[]>("/api/branches"),
            ]);
            setCounters(cRes.data);
            setBranches(bRes.data.filter((b) => b.isActive !== false));
        } catch {
            toast.error("Failed to load counters");
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { void load(); void loadGlAccounts(); void loadExpenseAccounts(); void loadGateways(); }, []);

    // Another admin claiming a counter, releasing a lock or adding a payment row
    // announces `settings`; a new gateway under Settings → Payment Methods does
    // too. Re-read the LIST only — `form` / `editForm` are separate state, so an
    // editor that is open keeps whatever is being typed into it.
    useRealtimeTopics(["settings"], () => { void load(); void loadGateways(); });

    const getNextCounterSuffix = (branchId: string, bList = branches, cList = counters) => {
        const branch = bList.find((b) => b.id === branchId);
        const prefixStr = branch?.number != null ? String(branch.number) : "";
        const branchCounters = cList.filter((c) => c.branchId === branchId);
        
        let maxSuffix = 0;
        for (const c of branchCounters) {
            const cStr = String(c.counterNumber);
            if (prefixStr && cStr.startsWith(prefixStr) && cStr.length > prefixStr.length) {
                const s = parseInt(cStr.slice(prefixStr.length), 10);
                if (!isNaN(s) && s > maxSuffix) maxSuffix = s;
            } else if (c.counterNumber > maxSuffix) {
                maxSuffix = c.counterNumber;
            }
        }
        return maxSuffix + 1;
    };

    const startAdd = () => {
        const initialBranch = branches[0];
        const initialBranchId = initialBranch?.id ?? "";
        const nextSuffix = getNextCounterSuffix(initialBranchId);
        const prefix = initialBranch?.number != null ? String(initialBranch.number) : "";
        const combined = prefix ? `${prefix}${nextSuffix}` : String(nextSuffix);
        setForm({ ...EMPTY_FORM, branchId: initialBranchId, counterNumber: String(nextSuffix), name: `Counter ${combined}` });
        setEditId(null);
        setAddingNew(true);
    };
    const startEdit = (c: Counter) => {
        setEditForm({
            name: c.name,
            counterNumber: String(c.counterNumber ?? ""),
            epbxExtension: c.epbxExtension ?? "",
            paymentAccounts: (c.paymentAccounts ?? []).map((p) => ({
                id: p.id,
                channel: p.channel,
                label: p.label,
                accountId: p.accountId,
                vpa: p.vpa ?? "",
                defaultVisible: p.defaultVisible,
                gatewayId: p.gatewayId ?? null,
            })),
            allowedExpenseAccountIds: Array.isArray(c.allowedExpenseAccountIds) ? c.allowedExpenseAccountIds : [],
        });
        setEditId(c.id);
        setAddingNew(false);
    };
    const cancel = () => { setAddingNew(false); setEditId(null); };

    // Payment-account row editors (operate on editForm.paymentAccounts).
    const options = methodOptions(gateways);
    const addPayAcct = () => {
        const first = options.find((o) => o.on);
        setEditForm((f) => ({
            ...f,
            paymentAccounts: [...f.paymentAccounts, { channel: first?.channel ?? "UPI", label: "", accountId: null, vpa: "", defaultVisible: true, gatewayId: first?.gatewayId ?? null }],
        }));
    };
    const updatePayAcct = (idx: number, patch: Partial<EditPayAcct>) => setEditForm((f) => ({
        ...f,
        paymentAccounts: f.paymentAccounts.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    }));
    const removePayAcct = (idx: number) => setEditForm((f) => ({
        ...f,
        paymentAccounts: f.paymentAccounts.filter((_, i) => i !== idx),
    }));

    const selectedBranch = branches.find((b) => b.id === form.branchId);
    const branchPrefix = selectedBranch?.number != null ? String(selectedBranch.number) : "";
    const fullCounterNumber = branchPrefix ? `${branchPrefix}${form.counterNumber}` : form.counterNumber;

    const handleCreate = async () => {
        if (!form.branchId)    { toast.error("Pick a branch"); return; }
        const num = Number(fullCounterNumber);
        if (!fullCounterNumber || !Number.isInteger(num) || num <= 0) {
            toast.error("Counter number must be a valid integer greater than 0");
            return;
        }
        if (!form.name.trim()) { toast.error("Counter name is required"); return; }
        setSaving(true);
        try {
            await axios.post("/api/pos/counters", {
                branchId:      form.branchId,
                counterNumber: num,
                name:          form.name.trim(),
            });
            toast.success("Counter created");
            cancel();
            void load();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? (e.response?.data as { error?: string })?.error ?? "Failed to create counter" : "Failed to create counter");
        } finally {
            setSaving(false);
        }
    };

    const handleUpdate = async () => {
        if (editId == null) return;
        const num = Number(editForm.counterNumber);
        if (!editForm.counterNumber || !Number.isInteger(num) || num <= 0) {
            toast.error("Counter number must be a valid integer greater than 0");
            return;
        }
        if (!editForm.name.trim()) { toast.error("Counter name is required"); return; }
        // Only rows with a linked bank ledger are sent; an incomplete row is dropped.
        const dropped = editForm.paymentAccounts.filter((p) => !p.accountId).length;
        const paymentAccounts = editForm.paymentAccounts
            .filter((p) => p.accountId != null)
            .map((p, i) => ({
                ...(p.id ? { id: p.id } : {}),
                channel: p.channel,
                label: p.label.trim() || CHANNEL_LABEL[p.channel],
                accountId: p.accountId as number,
                vpa: p.vpa.trim() || null,
                // Gateway link only applies to the GATEWAY channel; cleared otherwise server-side too.
                gatewayId: p.channel === "GATEWAY" ? (p.gatewayId ?? null) : null,
                defaultVisible: p.defaultVisible,
                sortOrder: i,
            }));
        setSaving(true);
        try {
            await axios.patch(`/api/pos/counters/${editId}`, {
                name:                     editForm.name.trim(),
                counterNumber:            num,
                epbxExtension:            editForm.epbxExtension.trim() || null,
                paymentAccounts,
                allowedExpenseAccountIds: editForm.allowedExpenseAccountIds,
            });
            toast.success(dropped > 0 ? `Counter updated (${dropped} row without a ledger skipped)` : "Counter updated");
            cancel();
            void load();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? (e.response?.data as { error?: string })?.error ?? "Failed to update" : "Failed to update");
        } finally {
            setSaving(false);
        }
    };

    const handleToggle = async (c: Counter) => {
        try {
            await axios.patch(`/api/pos/counters/${c.id}`, { isActive: !c.isActive });
            toast.success(c.isActive ? "Counter deactivated" : "Counter activated");
            void load();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? (e.response?.data as { error?: string })?.error ?? "Failed to toggle" : "Failed to toggle");
        }
    };

    // Release the device lock so any PC can claim this counter on the next open.
    // Only the binding goes — boundDeviceId/boundDeviceLabel/boundAt, plus a releasedAt
    // stamp. The counter's number and the offline-write id block reserved from it are
    // left alone: counterNumber is permanent config and idRangeStart is derived from it,
    // so the range stays correct for whichever PC claims the counter next. Only a
    // counterNumber CHANGE invalidates it, and the route clears it there.
    const handleRelease = async (c: Counter) => {
        if (!(await confirmAction({ title: `Release "${c.name}" (${c.branch.name})?`, body: `The bound PC loses this counter, and the next computer to open a shift here claims it through counter setup. The counter number and its reserved offline id range stay unchanged.`, confirmLabel: "Release" }))) return;
        try {
            await axios.patch(`/api/pos/counters/${c.id}`, { releaseLock: true });
            toast.success("Counter released — device lock cleared");
            void load();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? (e.response?.data as { error?: string })?.error ?? "Failed to release counter" : "Failed to release counter");
        }
    };

    const handleDelete = async (c: Counter) => {
        if (!(await confirmAction({ title: `Delete counter "${c.name}" (${c.branch.name})?`, body: `Till account will be unlinked but kept for audit.`, confirmLabel: "Delete" }))) return;
        try {
            await axios.delete(`/api/pos/counters/${c.id}`);
            toast.success("Counter deleted");
            void load();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? (e.response?.data as { error?: string })?.error ?? "Failed to delete" : "Failed to delete");
        }
    };

    // Group counters by branch for display.
    const byBranch = counters.reduce<Record<string, Counter[]>>((acc, c) => {
        (acc[c.branch.name] ||= []).push(c);
        return acc;
    }, {});

    return (
        <ScrollArea className="h-full" type="always">
            <div className="space-y-6 px-6 pt-3 pb-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold flex items-center gap-2">
                        <Monitor size={28} /> POS Counters
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Physical billing stations. Each counter has its own GL till account; any cashier can work it.
                    </p>
                </div>
                <Button onClick={startAdd} disabled={addingNew || branches.length === 0}>
                    <Plus size={16} /> New Counter
                </Button>
            </div>

            {/* Create form */}
            {addingNew && (
                <div className="space-y-3 rounded-lg border border-primary bg-muted/30 p-4">
                    <p className="text-sm font-semibold">New Counter</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                            <label className="text-xs font-medium text-muted-foreground">Branch *</label>
                            <Select
                                value={form.branchId}
                                onValueChange={(v) => {
                                    const nextSuffix = getNextCounterSuffix(v);
                                    const branch = branches.find((b) => b.id === v);
                                    const p = branch?.number != null ? String(branch.number) : "";
                                    const combined = p ? `${p}${nextSuffix}` : String(nextSuffix);
                                    setForm((f) => ({ ...f, branchId: v, counterNumber: String(nextSuffix), name: `Counter ${combined}` }));
                                }}
                            >
                                <SelectTrigger className="mt-1"><SelectValue placeholder="Select branch…" /></SelectTrigger>
                                <SelectContent>
                                    {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-muted-foreground">Counter Number *</label>
                            <div className="flex items-center mt-1">
                                {branchPrefix && (
                                    <span className="inline-flex items-center px-3 py-2 border border-r-0 border-input rounded-l-md bg-muted text-muted-foreground font-mono text-sm font-semibold select-none">
                                        {branchPrefix}
                                    </span>
                                )}
                                <NumericInput
                                    value={form.counterNumber}
                                    onValueChange={(suffix) => {
                                        const combined = branchPrefix ? `${branchPrefix}${suffix}` : suffix;
                                        setForm((f) => ({
                                            ...f,
                                            counterNumber: suffix,
                                            name: `Counter ${combined}`,
                                        }));
                                    }}
                                    placeholder="12"
                                    className={`font-mono ${branchPrefix ? "rounded-l-none" : ""}`}
                                />
                            </div>
                            {branchPrefix && (
                                <p className="text-[10px] text-muted-foreground mt-1">
                                    Saves as <span className="font-mono font-semibold text-foreground">{fullCounterNumber || "..."}</span>
                                </p>
                            )}
                        </div>
                        <div>
                            <label className="text-xs font-medium text-muted-foreground">Name *</label>
                            <Input
                                value={form.name}
                                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                                placeholder="Counter 1"
                                className="mt-1"
                            />
                        </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Creates GL account <span className="font-mono">Cash – {form.name || "<Name>"} – {branches.find((b) => b.id === form.branchId)?.name ?? "<Branch>"}</span> under Cash-in-Hand.
                    </p>
                    <div className="flex gap-2 pt-1">
                        <Button size="sm" onClick={handleCreate} disabled={saving}><Check size={14} /> Save</Button>
                        <Button size="sm" variant="outline" onClick={cancel}><X size={14} /> Cancel</Button>
                    </div>
                </div>
            )}

            {/* List grouped by branch */}
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : counters.length === 0 && !addingNew ? (
                <p className="border-dashed text-sm text-muted-foreground py-8 text-center border border-border rounded-lg">
                    No counters yet. Create one above.
                </p>
            ) : (
                <div className="space-y-6">
                    {Object.entries(byBranch).map(([branchName, list]) => (
                        <section key={branchName} className="space-y-2">
                            <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                                <Building2 size={14} /> {branchName}
                            </h2>
                            <div className="space-y-2">
                                {list.map((c) => (
                                    <div
                                        key={c.id}
                                        className={`rounded-lg border border-border border-l-4 ${
                                            c.isActive ? "border-l-primary" : "border-l-muted-foreground opacity-60"
                                        } bg-card`}
                                    >
                                        {editId === c.id ? (
                                            <div className="p-4 space-y-4">
                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                                    <div>
                                                        <label className="text-xs font-medium text-muted-foreground">Counter Number *</label>
                                                        <NumericInput
                                                            value={editForm.counterNumber}
                                                            onValueChange={(v) => setEditForm((f) => ({ ...f, counterNumber: v }))}
                                                            placeholder="1"
                                                            className="mt-1"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-xs font-medium text-muted-foreground">Name *</label>
                                                        <Input
                                                            value={editForm.name}
                                                            onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                                                            className="mt-1"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-xs font-medium text-muted-foreground">EPBX extension(s)</label>
                                                        <Input
                                                            type="text"
                                                            inputMode="numeric"
                                                            value={editForm.epbxExtension}
                                                            onChange={(e) => setEditForm((f) => ({ ...f, epbxExtension: e.target.value }))}
                                                            placeholder="e.g. 21 or 21,22"
                                                            className="mt-1"
                                                        />
                                                        <p className="mt-1 text-[11px] text-muted-foreground">
                                                            Several phones on one counter — separate with commas. The same extension may be given to more than one counter when the phones are on a parallel line; a call on it then pops up at each of them.
                                                        </p>
                                                    </div>
                                                </div>
                                                <p className="text-xs text-muted-foreground">
                                                    Renaming the counter also renames its till GL account.
                                                </p>

                                                {/* Payment accounts — a flexible list. Each row: method
                                                    (UPI/Card/…), a cashier-facing label, the bank ledger it
                                                    settles to, and (UPI/gateway) the VPA the customer pays
                                                    into for the QR. Add two UPIs to collect into two banks.
                                                    Cash always routes to the till and isn't listed here. */}
                                                <div className="space-y-2 pt-2 border-t border-border">
                                                    <p className="text-xs font-semibold text-muted-foreground">Payment accounts accepted at this counter</p>
                                                    <p className="text-[11px] text-muted-foreground">
                                                        Each row = method + label + the bank ledger it&apos;s booked to (UPI/gateway also take a VPA for the share QR).
                                                        Cash routes to <span className="font-mono">{c.tillAccount.name}</span> automatically.
                                                    </p>
                                                    <div className="space-y-2">
                                                        {editForm.paymentAccounts.map((p, idx) => (
                                                            <div key={p.id ?? `new-${idx}`} className="rounded-md border border-border bg-muted/20 p-2 space-y-1.5">
                                                                <div className="grid grid-cols-[130px_1fr_auto] gap-2 items-center">
                                                                    <Select
                                                                        value={methodKey(p.channel, p.gatewayId)}
                                                                        onValueChange={(v) => {
                                                                            const o = options.find((x) => x.key === v);
                                                                            if (o) updatePayAcct(idx, { channel: o.channel, gatewayId: o.gatewayId });
                                                                        }}
                                                                    >
                                                                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                                                        <SelectContent>
                                                                            {options
                                                                                .filter((o) => o.on || o.key === methodKey(p.channel, p.gatewayId))
                                                                                .map((o) => (
                                                                                    <SelectItem key={o.key} value={o.key}>
                                                                                        {o.label}{o.on ? "" : " (off)"}
                                                                                    </SelectItem>
                                                                                ))}
                                                                            {/* An old gateway row with no gateway linked yet. */}
                                                                            {p.channel === "GATEWAY" && p.gatewayId == null && (
                                                                                <SelectItem value="g:none">Gateway (choose)</SelectItem>
                                                                            )}
                                                                        </SelectContent>
                                                                    </Select>
                                                                    <Input
                                                                        value={p.label}
                                                                        onChange={(e) => updatePayAcct(idx, { label: e.target.value })}
                                                                        placeholder={`Label (e.g. ${CHANNEL_LABEL[p.channel]} 1)`}
                                                                        className="h-8 text-xs"
                                                                        maxLength={40}
                                                                    />
                                                                    <Button variant="ghost" size="icon-sm" title="Remove" onClick={() => removePayAcct(idx)}>
                                                                        <Trash2 size={12} className="text-destructive" />
                                                                    </Button>
                                                                </div>
                                                                <GlAccountCombobox
                                                                    value={p.accountId}
                                                                    onChange={(acc) => updatePayAcct(idx, { accountId: acc?.id ?? null })}
                                                                    accounts={glAccounts}
                                                                    onMastersChanged={() => { void loadGlAccounts(); void loadExpenseAccounts(); }}
                                                                    placeholder="Linked bank ledger…"
                                                                    className="h-8 text-xs"
                                                                />
                                                                {channelNeedsVpa(p.channel) && (
                                                                    <Input
                                                                        value={p.vpa}
                                                                        onChange={(e) => updatePayAcct(idx, { vpa: e.target.value })}
                                                                        placeholder="name@bank — VPA for the Share QR (optional)"
                                                                        className="h-8 text-xs font-mono"
                                                                        maxLength={60}
                                                                    />
                                                                )}
                                                                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={p.defaultVisible}
                                                                        onChange={(e) => updatePayAcct(idx, { defaultVisible: e.target.checked })}
                                                                        className="h-3.5 w-3.5 accent-primary"
                                                                    />
                                                                    Show in checkout by default (else under &ldquo;Add payment line&rdquo;)
                                                                </label>
                                                            </div>
                                                        ))}
                                                    </div>
                                                    <Button variant="outline" size="sm" onClick={addPayAcct}>
                                                        <Plus size={14} /> Add payment account
                                                    </Button>
                                                </div>

                                                {/* Allowed expenditure ledgers (Exp button). The cashier can
                                                    only spend the drawer to these EXPENSE ledgers. Leave all
                                                    unticked = no restriction (every expense ledger allowed). */}
                                                <div className="space-y-2 pt-2 border-t border-border">
                                                    <p className="text-xs font-semibold text-muted-foreground">Expenditure ledgers allowed (Exp button)</p>
                                                    <p className="text-[11px] text-muted-foreground">
                                                        Which expense ledgers the cashier may spend the drawer to (tea, sundry donation…).
                                                        Leave all unticked to allow every expense ledger.
                                                    </p>
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {expenseAccounts.map((a) => {
                                                            const on = editForm.allowedExpenseAccountIds.includes(a.id);
                                                            return (
                                                                <button
                                                                    key={a.id}
                                                                    type="button"
                                                                    onClick={() => setEditForm((f) => ({
                                                                        ...f,
                                                                        allowedExpenseAccountIds: on
                                                                            ? f.allowedExpenseAccountIds.filter((x) => x !== a.id)
                                                                            : [...f.allowedExpenseAccountIds, a.id],
                                                                    }))}
                                                                    className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                                                                        on ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted"
                                                                    }`}
                                                                >
                                                                    {a.name}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                    <p className="text-[10px] text-muted-foreground">
                                                        {editForm.allowedExpenseAccountIds.length === 0
                                                            ? "All expense ledgers allowed."
                                                            : `${editForm.allowedExpenseAccountIds.length} ledger(s) allowed.`}
                                                    </p>
                                                </div>

                                                <div className="flex gap-2">
                                                    <Button size="sm" onClick={handleUpdate} disabled={saving}><Check size={14} /> Save</Button>
                                                    <Button size="sm" variant="outline" onClick={cancel}><X size={14} /> Cancel</Button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-4 px-4 py-3 flex-wrap">
                                                <div className="shrink-0 flex items-center gap-1.5">
                                                    <Badge variant="outline" className="font-mono text-xs font-semibold">
                                                        #{c.counterNumber}
                                                    </Badge>
                                                    <Badge className="font-mono text-xs"><Monitor size={11} className="mr-1" />{c.name}</Badge>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs font-mono text-muted-foreground truncate">
                                                        {c.tillAccount.name}
                                                    </p>
                                                    <div className="flex gap-3 mt-0.5 flex-wrap text-xs text-muted-foreground">
                                                        <span>Balance ₹{fmt(Number(c.tillAccount.balance))}</span>
                                                        <span>{c.totalShifts} shift{c.totalShifts === 1 ? "" : "s"}</span>
                                                        {c.epbxExtension && (
                                                            <span className="flex items-center gap-1">
                                                                <Phone size={11} /> Ext {splitExtensions(c.epbxExtension).join(", ")}
                                                            </span>
                                                        )}
                                                        {c.activeShift && (
                                                            <span className="text-amber-700 dark:text-amber-400">
                                                                · {c.activeShift.status === "AWAITING_HANDOVER" ? "awaiting handover" : `in use — ${c.activeShift.user.name}`}
                                                            </span>
                                                        )}
                                                        {c.boundDeviceId && (
                                                            <span className="flex items-center gap-1 text-foreground" title={`Locked to ${c.boundDeviceLabel ?? "a computer"}${c.boundAt ? ` since ${new Date(c.boundAt).toLocaleDateString()}` : ""}`}>
                                                                <Lock size={11} /> Locked to {c.boundDeviceLabel ?? "a computer"}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {/* Compact summary so the operator can see what's wired
                                                        without opening the edit form. CASH is always there. */}
                                                    <div className="flex gap-1 mt-1.5 flex-wrap">
                                                        <Badge variant="outline" className="text-[10px] font-normal">Cash</Badge>
                                                        {(c.paymentAccounts ?? []).map((p) => (
                                                            <Badge key={p.id} variant="outline" className="text-[10px] font-normal" title={`${CHANNEL_LABEL[p.channel]}${p.gateway ? ` · ${p.gateway.displayName}` : ""}${p.vpa ? ` · ${p.vpa}` : ""} → ${p.account?.name ?? ""}`}>
                                                                {p.label}{p.gateway ? ` (${p.gateway.displayName})` : ""} → {p.account?.name ?? "?"}
                                                            </Badge>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <Badge className={c.isActive ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}>
                                                        {c.isActive ? "Active" : "Inactive"}
                                                    </Badge>
                                                    <div className="flex gap-1">
                                                        {c.boundDeviceId && (
                                                            <Button variant="outline" size="icon-sm" title="Release device lock" onClick={() => handleRelease(c)}>
                                                                <Unlock size={14} />
                                                            </Button>
                                                        )}
                                                        <Button variant="outline" size="icon-sm" title={c.isActive ? "Deactivate" : "Activate"} onClick={() => handleToggle(c)}>
                                                            {c.isActive ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                                                        </Button>
                                                        <Button variant="outline" size="icon-sm" onClick={() => startEdit(c)}><Pencil size={14} /></Button>
                                                        <Button variant="destructive" size="icon-sm" onClick={() => handleDelete(c)} title="Delete (only if no shifts)">
                                                            <Trash2 size={14} />
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            )}
            </div>
        </ScrollArea>
    );
}
