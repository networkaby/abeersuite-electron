"use client";
// Opening Balance management — summary + inline editor.
// Used during mid-year migration when an organisation switches to the app
// from another system. Set Books Beginning From on the company, then enter
// per-account / per-product opening figures here.

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, AlertTriangle, CheckCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmt } from "@/utils/constants";

type AccountRow = {
    id: number; code: string; name: string;
    openingBalance: number; openingBalanceType: "DEBIT" | "CREDIT" | null;
    openingBalanceDate: string | null;
};
type ProductRow = {
    id: number; sku: string; name: string;
    openingStock: number; openingRate: number | null; openingValue: number | null;
    openingStockDate: string | null;
    unit: { code: string; label: string };
};
type Summary = {
    accounts: AccountRow[];
    products: ProductRow[];
    openingDrTotal: number;
    openingCrTotal: number;
    openingStockTotal: number;
    difference: number;
    suspenseSide: "DEBIT" | "CREDIT" | null;
    suspenseAmount: number;
};

interface AllAccount { id: number; code: string; name: string }
interface AllProduct { id: number; sku: string; name: string; unit: { code: string } }

export default function OpeningBalancePage() {
    const [data, setData] = useState<Summary | null>(null);
    const [loading, setLoading] = useState(true);

    const [allAccounts, setAllAccounts] = useState<AllAccount[]>([]);
    const [allProducts, setAllProducts] = useState<AllProduct[]>([]);

    const load = useCallback(() => {
        setLoading(true);
        axios.get<Summary>("/api/finance/opening-balance")
            .then((r) => setData(r.data))
            .catch(() => toast.error("Failed to load summary"))
            .finally(() => setLoading(false));
    }, []);

    useEffect(load, [load]);

    useEffect(() => {
        axios.get<AllAccount[]>("/api/finance/gl-accounts")
            .then((r) => setAllAccounts(r.data))
            .catch(() => { /* page still useful without picker */ });
        axios.get<{ id: number; sku: string; name: string; unit: { code: string } }[]>("/api/inventory/products")
            .then((r) => setAllProducts(r.data))
            .catch(() => { /* same */ });
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="animate-spin text-muted-foreground" size={32} />
            </div>
        );
    }
    if (!data) return <div className="text-center py-24 text-muted-foreground">Failed to load</div>;

    const balanced = Math.abs(data.difference) < 0.005;

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div>
                <h1 className="text-2xl font-bold">Opening Balance</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                    Per-account opening figures for migration from another system. Set <strong>Books Beginning From</strong>
                    {" "}on the company, then enter balances here as of that date.
                </p>
            </div>

            {balanced ? (
                <div className="rounded-lg border border-green-200 bg-green-50 p-4 flex items-center gap-3 text-sm">
                    <CheckCircle size={18} className="text-green-700" />
                    <div>
                        <p className="font-medium text-green-700">Opening balances reconciled</p>
                        <p className="text-green-700/80 text-xs">Total debits equal total credits — no suspense balance.</p>
                    </div>
                </div>
            ) : (
                <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-4 flex items-start gap-3 text-sm">
                    <AlertTriangle size={18} className="text-yellow-700 mt-0.5" />
                    <div className="space-y-1">
                        <p className="font-medium text-yellow-800">Opening balance unreconciled</p>
                        <p className="text-yellow-800/80 text-xs">
                            ₹ {fmt(data.suspenseAmount)} {data.suspenseSide} parked in <strong>Difference in Opening Balances</strong> suspense ledger.
                            Reports show this as a balancing line. Reconcile by adding the missing capital / loan / equity entry below.
                        </p>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-3 gap-4">
                <SummaryCard label="Opening Debits"    value={data.openingDrTotal}    color="text-blue-700" />
                <SummaryCard label="Opening Credits"   value={data.openingCrTotal}    color="text-orange-700" />
                <SummaryCard label="Opening Stock"     value={data.openingStockTotal} color="text-foreground" />
            </div>

            <AccountOpeningSection
                accounts={data.accounts}
                allAccounts={allAccounts}
                onChanged={load}
                openingDrTotal={data.openingDrTotal}
                openingCrTotal={data.openingCrTotal}
                balanced={balanced}
                suspenseSide={data.suspenseSide}
                suspenseAmount={data.suspenseAmount}
            />

            <ProductOpeningSection
                products={data.products}
                allProducts={allProducts}
                onChanged={load}
                openingStockTotal={data.openingStockTotal}
            />
        </div>
    );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <div className="rounded-lg border border-border bg-card p-4 text-center shadow">
            <p className="text-xs text-muted-foreground mb-1">{label}</p>
            <p className={`text-xl font-bold font-mono ${color}`}>{fmt(value)}</p>
        </div>
    );
}

function AccountOpeningSection({
    accounts, allAccounts, onChanged, openingDrTotal, openingCrTotal, balanced, suspenseSide, suspenseAmount,
}: {
    accounts:        AccountRow[];
    allAccounts:     AllAccount[];
    onChanged:       () => void;
    openingDrTotal:  number;
    openingCrTotal:  number;
    balanced:        boolean;
    suspenseSide:    "DEBIT" | "CREDIT" | null;
    suspenseAmount:  number;
}) {
    const [showAdd, setShowAdd] = useState(false);
    const [form, setForm] = useState({
        accountId: 0,
        amount:    "",
        type:      "DEBIT" as "DEBIT" | "CREDIT",
        asOfDate:  new Date().toISOString().slice(0, 10),
    });
    const [saving, setSaving] = useState(false);

    // Pre-fill the form when an existing account is selected so editing is in-place.
    useEffect(() => {
        if (!form.accountId) return;
        const existing = accounts.find((a) => a.id === form.accountId);
        if (existing && existing.openingBalanceType) {
            setForm((f) => ({
                ...f,
                amount:   String(existing.openingBalance ?? ""),
                type:     existing.openingBalanceType ?? "DEBIT",
                asOfDate: existing.openingBalanceDate?.slice(0, 10) ?? f.asOfDate,
            }));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form.accountId]);

    const save = async () => {
        if (!form.accountId) { toast.error("Select an account"); return; }
        const amount = parseFloat(form.amount);
        if (!Number.isFinite(amount) || amount < 0) { toast.error("Enter a valid amount"); return; }
        setSaving(true);
        try {
            await axios.put(`/api/finance/accounts/${form.accountId}/opening`, {
                amount:   amount === 0 ? null : amount,
                type:     amount === 0 ? null : form.type,
                asOfDate: amount === 0 ? null : form.asOfDate,
            });
            toast.success("Opening balance saved");
            setShowAdd(false);
            setForm({ accountId: 0, amount: "", type: "DEBIT", asOfDate: form.asOfDate });
            onChanged();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow">
            <div className="border-b border-border bg-muted px-5 py-3 flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-semibold">Account Opening Balances</h3>
                    <p className="text-xs text-muted-foreground">{accounts.length} {accounts.length === 1 ? "account" : "accounts"} with opening balance</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setShowAdd((v) => !v)}>
                    <Plus size={14} /> {showAdd ? "Hide editor" : "Add / Edit"}
                </Button>
            </div>

            {showAdd && (
                <div className="border-b border-border bg-muted/30 px-5 py-4 grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
                    <div className="space-y-1.5 md:col-span-2">
                        <Label>Account</Label>
                        <Select
                            value={String(form.accountId)}
                            onValueChange={(v) => setForm((f) => ({ ...f, accountId: Number(v) }))}
                        >
                            <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="0">Select account</SelectItem>
                                {allAccounts.map((a) => (
                                    <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        <Label>Amount</Label>
                        <Input type="number" min="0" step="0.01" value={form.amount}
                            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                            placeholder="0 to clear" />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Dr / Cr</Label>
                        <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v as "DEBIT" | "CREDIT" }))}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="DEBIT">Debit</SelectItem>
                                <SelectItem value="CREDIT">Credit</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        <Label>As of</Label>
                        <Input type="date" value={form.asOfDate} onChange={(e) => setForm((f) => ({ ...f, asOfDate: e.target.value }))} />
                    </div>
                    <div className="md:col-span-5 flex justify-end gap-2 pt-1">
                        <Button variant="outline" onClick={() => setShowAdd(false)}>Close</Button>
                        <Button onClick={save} disabled={saving || !form.accountId}>
                            {saving && <Loader2 size={14} className="animate-spin" />} Save
                        </Button>
                    </div>
                </div>
            )}

            {accounts.length === 0 ? (
                <div className="px-5 py-8 text-center text-muted-foreground text-sm">
                    No opening balances yet. Click <strong>Add / Edit</strong> above to set one.
                </div>
            ) : (
                <table className="w-full text-sm">
                    <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
                        <tr>
                            <th className="px-5 py-2 text-left font-medium">Account</th>
                            <th className="px-5 py-2 text-left font-medium">As of</th>
                            <th className="px-5 py-2 text-right font-medium">Debit</th>
                            <th className="px-5 py-2 text-right font-medium">Credit</th>
                        </tr>
                    </thead>
                    <tbody>
                        {accounts.map((a) => (
                            <tr key={a.id} className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                                onClick={() => { setShowAdd(true); setForm((f) => ({ ...f, accountId: a.id })); }}>
                                <td className="px-5 py-2">
                                    <span className="font-mono text-muted-foreground mr-2">{a.code}</span>
                                    <span className="font-medium">{a.name}</span>
                                </td>
                                <td className="px-5 py-2 text-muted-foreground text-xs">
                                    {a.openingBalanceDate ? new Date(a.openingBalanceDate).toLocaleDateString("en-GB") : "—"}
                                </td>
                                <td className="px-5 py-2 text-right font-mono">
                                    {a.openingBalanceType === "DEBIT" ? fmt(Number(a.openingBalance)) : <span className="text-muted-foreground/40">—</span>}
                                </td>
                                <td className="px-5 py-2 text-right font-mono">
                                    {a.openingBalanceType === "CREDIT" ? fmt(Number(a.openingBalance)) : <span className="text-muted-foreground/40">—</span>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot className="bg-muted border-t-2 border-border font-semibold text-sm">
                        <tr>
                            <td colSpan={2} className="px-5 py-2 text-muted-foreground">Total</td>
                            <td className="px-5 py-2 text-right font-mono">{fmt(openingDrTotal)}</td>
                            <td className="px-5 py-2 text-right font-mono">{fmt(openingCrTotal)}</td>
                        </tr>
                        {!balanced && (
                            <tr>
                                <td colSpan={2} className="px-5 py-2 text-muted-foreground italic">Difference in Opening Balances (suspense)</td>
                                <td className="px-5 py-2 text-right font-mono">{suspenseSide === "DEBIT"  ? fmt(suspenseAmount) : ""}</td>
                                <td className="px-5 py-2 text-right font-mono">{suspenseSide === "CREDIT" ? fmt(suspenseAmount) : ""}</td>
                            </tr>
                        )}
                    </tfoot>
                </table>
            )}
        </div>
    );
}

function ProductOpeningSection({
    products, allProducts, onChanged, openingStockTotal,
}: {
    products:          ProductRow[];
    allProducts:       AllProduct[];
    onChanged:         () => void;
    openingStockTotal: number;
}) {
    const [showAdd, setShowAdd] = useState(false);
    const [form, setForm] = useState({
        productId: 0,
        qty:       "",
        rate:      "",
        asOfDate:  new Date().toISOString().slice(0, 10),
    });
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!form.productId) return;
        const existing = products.find((p) => p.id === form.productId);
        if (existing) {
            setForm((f) => ({
                ...f,
                qty:      String(existing.openingStock ?? ""),
                rate:     String(existing.openingRate ?? ""),
                asOfDate: existing.openingStockDate?.slice(0, 10) ?? f.asOfDate,
            }));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form.productId]);

    const save = async () => {
        if (!form.productId) { toast.error("Select a product"); return; }
        const qty = parseFloat(form.qty);
        const rate = parseFloat(form.rate);
        if (!Number.isFinite(qty) || qty < 0) { toast.error("Enter a valid qty"); return; }
        setSaving(true);
        try {
            await axios.put(`/api/inventory/products/${form.productId}/opening`, {
                qty:      qty === 0 ? null : qty,
                rate:     qty === 0 ? null : (Number.isFinite(rate) ? rate : null),
                asOfDate: qty === 0 ? null : form.asOfDate,
            });
            toast.success("Opening stock saved");
            setShowAdd(false);
            setForm({ productId: 0, qty: "", rate: "", asOfDate: form.asOfDate });
            onChanged();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow">
            <div className="border-b border-border bg-muted px-5 py-3 flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-semibold">Product Opening Stock</h3>
                    <p className="text-xs text-muted-foreground">{products.length} {products.length === 1 ? "product" : "products"} with opening stock</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setShowAdd((v) => !v)}>
                    <Plus size={14} /> {showAdd ? "Hide editor" : "Add / Edit"}
                </Button>
            </div>

            {showAdd && (
                <div className="border-b border-border bg-muted/30 px-5 py-4 grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
                    <div className="space-y-1.5 md:col-span-2">
                        <Label>Product</Label>
                        <Select
                            value={String(form.productId)}
                            onValueChange={(v) => setForm((f) => ({ ...f, productId: Number(v) }))}
                        >
                            <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="0">Select product</SelectItem>
                                {allProducts.map((p) => (
                                    <SelectItem key={p.id} value={String(p.id)}>{p.sku} — {p.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        <Label>Qty</Label>
                        <Input type="number" min="0" step="0.001" value={form.qty}
                            onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))}
                            placeholder="0 to clear" />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Rate</Label>
                        <Input type="number" min="0" step="0.01" value={form.rate}
                            onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))}
                            placeholder="0.00" />
                    </div>
                    <div className="space-y-1.5">
                        <Label>As of</Label>
                        <Input type="date" value={form.asOfDate} onChange={(e) => setForm((f) => ({ ...f, asOfDate: e.target.value }))} />
                    </div>
                    <div className="md:col-span-5 flex justify-end gap-2 pt-1">
                        <Button variant="outline" onClick={() => setShowAdd(false)}>Close</Button>
                        <Button onClick={save} disabled={saving || !form.productId}>
                            {saving && <Loader2 size={14} className="animate-spin" />} Save
                        </Button>
                    </div>
                </div>
            )}

            {products.length === 0 ? (
                <div className="px-5 py-8 text-center text-muted-foreground text-sm">
                    No opening stock yet. Click <strong>Add / Edit</strong> above to set qty + rate for a product.
                </div>
            ) : (
                <table className="w-full text-sm">
                    <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
                        <tr>
                            <th className="px-5 py-2 text-left font-medium">Product</th>
                            <th className="px-5 py-2 text-right font-medium">Qty</th>
                            <th className="px-5 py-2 text-right font-medium">Rate</th>
                            <th className="px-5 py-2 text-right font-medium">Value</th>
                        </tr>
                    </thead>
                    <tbody>
                        {products.map((p) => (
                            <tr key={p.id} className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                                onClick={() => { setShowAdd(true); setForm((f) => ({ ...f, productId: p.id })); }}>
                                <td className="px-5 py-2">
                                    <span className="font-mono text-muted-foreground mr-2">{p.sku}</span>
                                    <span className="font-medium">{p.name}</span>
                                </td>
                                <td className="px-5 py-2 text-right font-mono">
                                    {Number(p.openingStock)} <span className="text-muted-foreground text-xs">{p.unit.code}</span>
                                </td>
                                <td className="px-5 py-2 text-right font-mono">{p.openingRate ? fmt(Number(p.openingRate)) : "—"}</td>
                                <td className="px-5 py-2 text-right font-mono">{p.openingValue ? fmt(Number(p.openingValue)) : "—"}</td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot className="bg-muted border-t-2 border-border font-semibold text-sm">
                        <tr>
                            <td colSpan={3} className="px-5 py-2 text-muted-foreground">Total Inventory Value</td>
                            <td className="px-5 py-2 text-right font-mono">{fmt(openingStockTotal)}</td>
                        </tr>
                    </tfoot>
                </table>
            )}
        </div>
    );
}
