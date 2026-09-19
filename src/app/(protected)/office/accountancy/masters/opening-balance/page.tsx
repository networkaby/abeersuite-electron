"use client";
// Opening Balance management — summary + inline editor.
// Used during migration when an organisation switches to the app from
// another system. Universal opening — no per-account/per-product date;
// every figure here is always effective from the start of the books,
// whether imported or created fresh.

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { toast } from "sonner";
import { Loader2, AlertTriangle, CheckCircle, Plus, Search, ListTree, FileStack } from "lucide-react";
import { OpeningBillsDialog } from "@/modules/accountancy/components/OpeningBillsDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GlAccountCombobox, type GlAccount } from "@/modules/accountancy/components/GlAccountCombobox";
import { InvProductCombobox } from "@/modules/inventory/components/InvProductCombobox";
import { aliasMatches } from "@/modules/accountancy/lib/accountAlias";
import { useProductCatalog, loadProductCatalog } from "@/shared/hooks";
import { productMatchesSearch } from "@/shared/lib/inventory";
import { fmt } from "@/utils/constants";
import { parseRupeesToPaise } from "@/shared/lib/format";

type AccountRow = {
    id: number; name: string;
    openingBalance: number; openingBalanceType: "DEBIT" | "CREDIT" | null;
    /** Under Sundry Debtors or Sundry Creditors — the only ledgers that keep
     *  bill-wise details. A bank or capital opening has no bills behind it. */
    isParty: boolean;
};
type ProductRow = {
    id: number; sku: string; name: string;
    openingStock: number; openingRate: number | null; openingValue: number | null;
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

/** One row of the shared product catalogue — only the bit the stock-table
 *  filter needs, so a barcode the summary row doesn't carry still matches. */
type CatalogRow = { id: number; name: string; sku: string; codes?: { value: string }[] };

interface AccountGroupOpt { id: number; name: string; type: "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE"; parentId: number | null }
interface UnitOpt { id: number; code: string; label: string }

export default function OpeningBalancePage() {
    // Which ledger is on screen. Kept in the URL so a refresh — or a link
    // handed to someone else — lands back on the same tab.
    const router = useRouter();
    const search = useSearchParams();
    const tab = search.get("tab") === "stock" ? "stock" : "accounts";

    const [data, setData] = useState<Summary | null>(null);
    const [loading, setLoading] = useState(true);

    const [allAccounts, setAllAccounts] = useState<GlAccount[]>([]);

    // "Convert all to bills" — a party's opening figure is invisible to
    // Receivables, Payables and bill-wise linking until it becomes a real
    // voucher. Always asked TWICE: the first press only reports what would
    // happen, because converting moves Account.balance and that is what the POS
    // credit check reads at the counter.
    const [convert, setConvert] = useState<{ accounts: number; total: number; skipped: number } | null>(null);
    const [converting, setConverting] = useState(false);

    const previewConvert = async () => {
        setConverting(true);
        try {
            const { data: r } = await axios.post("/api/accountancy/opening-balance/to-bills", { dryRun: true });
            if (r.accounts === 0) {
                toast.info(r.skipped > 0
                    ? "Every party opening is already bill-wise."
                    : "No party opening balances to convert.");
                return;
            }
            setConvert({ accounts: r.accounts, total: r.total, skipped: r.skipped ?? 0 });
        } catch (err) {
            toast.error(axios.isAxiosError(err) ? err.response?.data?.error ?? "Failed" : "Failed");
        } finally { setConverting(false); }
    };

    const applyConvert = async () => {
        setConverting(true);
        try {
            const { data: r } = await axios.post("/api/accountancy/opening-balance/to-bills", { dryRun: false });
            const failed: { name: string; reason: string }[] = r.failed ?? [];
            toast.success(`${r.converted} opening balance(s) are now bills.`);
            if (failed.length > 0) toast.error(`${failed.length} could not be converted: ${failed[0].reason}`);
            setConvert(null);
            load();
        } catch (err) {
            toast.error(axios.isAxiosError(err) ? err.response?.data?.error ?? "Failed" : "Failed");
        } finally { setConverting(false); }
    };

    // Refetch without flipping `loading` — the full-page spinner is for the
    // first load only. `onChanged={load}` fires after every edit, and
    // re-showing it unmounted the whole summary (page blink).
    const load = useCallback(() => {
        axios.get<Summary>("/api/accountancy/opening-balance")
            .then((r) => setData(r.data))
            .catch(() => toast.error("Failed to load summary"))
            .finally(() => setLoading(false));
    }, []);

    // includeParties — a migrating shop's opening balances are mostly Sundry
    // Debtors / Creditors, and the default (pure GL) list hides every one of
    // them. It also carries aliases and party phones, which is what lets the
    // picker find a ledger by any identifier, not just its name.
    const loadAccounts = useCallback(() => {
        return axios.get<GlAccount[]>("/api/accountancy/gl-accounts?includeParties=true")
            .then((r) => setAllAccounts(r.data))
            .catch(() => { /* page still useful without picker */ });
    }, []);

    // Products come from the shared catalogue (IndexedDB + delta sync) that
    // every product picker already reads — this page keeps no second copy.
    const refreshProducts = useCallback(async () => { await loadProductCatalog(); }, []);

    useEffect(load, [load]);

    useEffect(() => { loadAccounts(); }, [loadAccounts]);

    // Opening balances move when a ledger is created or a party's opening bills
    // are entered on another machine — both announce `ledger`. The summary and
    // the picker list are read-only here; row dialogs keep their own state.
    useRealtimeTopics(["ledger"], () => { load(); loadAccounts(); });

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
        <ScrollArea className="h-full" type="always">
            <div className="max-w-5xl mx-auto space-y-6 px-0 pt-3 pb-6">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold">Opening Balance</h1>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            Per-account opening figures for migration from another system — always effective from the start of the books.
                        </p>
                    </div>
                    <Button size="sm" variant="outline" className="shrink-0" onClick={previewConvert} disabled={converting}>
                        {converting ? <Loader2 size={14} className="animate-spin" /> : <FileStack size={14} />} Convert all to bills
                    </Button>
                </div>

                {/* Asked twice on purpose. The first press writes nothing — it
                    only reports how many parties and how much, because
                    converting moves Account.balance, and that is the figure the
                    POS credit check reads at the counter. A customer who looks
                    clear today can start hitting their credit limit tomorrow:
                    correct, but it should not arrive as a surprise. */}
                {convert && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-2 text-sm">
                        <div className="flex items-start gap-3">
                            <AlertTriangle size={18} className="text-amber-700 mt-0.5 shrink-0" />
                            <div>
                                <p className="font-medium text-amber-800">
                                    Turn {convert.accounts} party opening balance{convert.accounts === 1 ? "" : "s"} into bills — ₹ {fmt(convert.total)} in all?
                                </p>
                                <p className="text-amber-800/80 text-xs mt-1">
                                    Each becomes one real opening bill, so it appears in Receivables and Payables and money can be
                                    settled against it. It also moves the ledger balance the counter&apos;s credit check reads, so a
                                    customer may start hitting their credit limit.
                                    {convert.skipped > 0 && ` ${convert.skipped} party already broken up bill-wise will be left alone.`}
                                </p>
                            </div>
                        </div>
                        <div className="flex gap-2 pl-8">
                            <Button size="sm" onClick={applyConvert} disabled={converting}>
                                {converting ? <Loader2 size={14} className="animate-spin mr-1" /> : null} Yes, convert
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setConvert(null)} disabled={converting}>
                                Cancel
                            </Button>
                        </div>
                    </div>
                )}

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
                    <SummaryCard label="Opening Debits" value={data.openingDrTotal} color="text-blue-700" />
                    <SummaryCard label="Opening Credits" value={data.openingCrTotal} color="text-orange-700" />
                    <SummaryCard label="Opening Stock" value={data.openingStockTotal} color="text-foreground" />
                </div>

                <Tabs value={tab} onValueChange={(v) => router.replace(`?tab=${v}`, { scroll: false })}>
                    <TabsList>
                        <TabsTrigger value="accounts">
                            Account Ledger <span className="ml-1.5 text-xs opacity-70">{data.accounts.length}</span>
                        </TabsTrigger>
                        <TabsTrigger value="stock">
                            Stock Ledger <span className="ml-1.5 text-xs opacity-70">{data.products.length}</span>
                        </TabsTrigger>
                    </TabsList>
                </Tabs>

                {tab === "accounts" ? (
                    <AccountOpeningSection
                        accounts={data.accounts}
                        allAccounts={allAccounts}
                        onChanged={load}
                        onAccountListChanged={loadAccounts}
                        openingDrTotal={data.openingDrTotal}
                        openingCrTotal={data.openingCrTotal}
                        balanced={balanced}
                        suspenseSide={data.suspenseSide}
                        suspenseAmount={data.suspenseAmount}
                    />
                ) : (
                    <ProductOpeningSection
                        products={data.products}
                        onChanged={load}
                        onProductListChanged={refreshProducts}
                        openingStockTotal={data.openingStockTotal}
                    />
                )}
            </div>
        </ScrollArea>
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
    accounts, allAccounts, onChanged, onAccountListChanged, openingDrTotal, openingCrTotal, balanced, suspenseSide, suspenseAmount,
}: {
    accounts: AccountRow[];
    allAccounts: GlAccount[];
    onChanged: () => void;
    onAccountListChanged: () => Promise<void> | void;
    openingDrTotal: number;
    openingCrTotal: number;
    balanced: boolean;
    suspenseSide: "DEBIT" | "CREDIT" | null;
    suspenseAmount: number;
}) {
    const [showAdd, setShowAdd] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    // Which ledger's opening is being broken into bills.
    const [billsForAccount, setBillsForAccount] = useState<number | null>(null);
    const [form, setForm] = useState({
        accountId: 0,
        amount: "",
        type: "DEBIT" as "DEBIT" | "CREDIT",
    });
    const [saving, setSaving] = useState(false);
    const [filter, setFilter] = useState("");

    // The table filter matches the same identifiers the picker searches — name,
    // alias, party mobile — so whatever finds a ledger in the dropdown also
    // finds its row below. Aliases and phones live on the full list only.
    const meta = useMemo(() => new Map(allAccounts.map((a) => [a.id, a])), [allAccounts]);
    const q = filter.trim().toLowerCase();
    const visible = q
        ? accounts.filter((a) => {
            const m = meta.get(a.id);
            return a.name.toLowerCase().includes(q)
                || aliasMatches(m?.aliases, q)
                || (m?.phones ?? []).some((p) => p.toLowerCase().includes(q));
        })
        : accounts;

    const handleAccountCreated = async (newId: number) => {
        await onAccountListChanged();
        setShowCreate(false);
        setShowAdd(true);
        setForm((f) => ({ ...f, accountId: newId }));
    };

    // Pre-fill the form when an existing account is selected so editing is in-place.
    useEffect(() => {
        if (!form.accountId) return;
        const existing = accounts.find((a) => a.id === form.accountId);
        setForm((f) => ({
            ...f,
            // A ledger with no opening yet starts empty — the previous ledger's
            // figure must never be left sitting in the box waiting to be saved.
            amount: existing?.openingBalanceType ? String(existing.openingBalance ?? "") : "",
            type: existing?.openingBalanceType ?? f.type,
        }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form.accountId]);

    const save = async () => {
        if (!form.accountId) { toast.error("Select an account"); return; }
        const amount = parseFloat(form.amount);
        if (!Number.isFinite(amount) || amount < 0) { toast.error("Enter a valid amount"); return; }
        setSaving(true);
        try {
            await axios.put(`/api/accountancy/accounts/${form.accountId}/opening`, {
                amount: amount === 0 ? null : amount,
                type: amount === 0 ? null : form.type,
            });
            toast.success("Opening balance saved");
            setShowAdd(false);
            setForm({ accountId: 0, amount: "", type: "DEBIT" });
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
                    <p className="text-xs text-muted-foreground">
                        {q
                            ? `${visible.length} of ${accounts.length} shown`
                            : `${accounts.length} ${accounts.length === 1 ? "account" : "accounts"} with opening balance`}
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
                        <Plus size={14} /> New account
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setShowAdd((v) => !v)}>
                        <Plus size={14} /> {showAdd ? "Hide editor" : "Add / Edit"}
                    </Button>
                </div>
            </div>

            <QuickCreateAccountDialog
                open={showCreate}
                onOpenChange={setShowCreate}
                onCreated={handleAccountCreated}
            />

            {showAdd && (
                <div className="border-b border-border bg-muted/30 px-5 py-4 grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
                    <div className="space-y-1.5 md:col-span-2">
                        <Label>Account</Label>
                        <GlAccountCombobox
                            value={form.accountId || null}
                            onChange={(a) => setForm((f) => ({ ...f, accountId: a?.id ?? 0 }))}
                            accounts={allAccounts}
                            placeholder="Search name, alias or mobile…"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Amount</Label>
                        <Input type="text" inputMode="decimal" value={form.amount}
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
                    <div className="md:col-span-4 flex justify-end gap-2 pt-1">
                        <Button variant="outline" onClick={() => setShowAdd(false)}>Close</Button>
                        <Button onClick={save} disabled={saving || !form.accountId}>
                            {saving && <Loader2 size={14} className="animate-spin" />} Save
                        </Button>
                    </div>
                </div>
            )}

            {accounts.length > 0 && (
                <div className="border-b border-border px-5 py-2">
                    <div className="relative max-w-xs">
                        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input value={filter} onChange={(e) => setFilter(e.target.value)}
                            className="h-8 pl-8" placeholder="Filter by name, alias or mobile…" />
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
                            <th className="px-5 py-2 text-right font-medium">Debit</th>
                            <th className="px-5 py-2 text-right font-medium">Credit</th>
                            <th className="px-5 py-2 text-right font-medium">Bill-wise</th>
                        </tr>
                    </thead>
                    <tbody>
                        {visible.length === 0 && (
                            <tr>
                                <td colSpan={4} className="px-5 py-6 text-center text-muted-foreground">
                                    No account matches “{filter}”.
                                </td>
                            </tr>
                        )}
                        {visible.map((a) => (
                            <tr key={a.id} className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                                onClick={() => { setShowAdd(true); setForm((f) => ({ ...f, accountId: a.id })); }}>
                                <td className="px-5 py-2">
                                    <span className="font-medium">{a.name}</span>
                                </td>
                                <td className="px-5 py-2 text-right font-mono">
                                    {a.openingBalanceType === "DEBIT" ? fmt(Number(a.openingBalance)) : <span className="text-muted-foreground/65">—</span>}
                                </td>
                                <td className="px-5 py-2 text-right font-mono">
                                    {a.openingBalanceType === "CREDIT" ? fmt(Number(a.openingBalance)) : <span className="text-muted-foreground/65">—</span>}
                                </td>
                                <td className="px-5 py-2 text-right">
                                    {/* Party ledgers only. Breaking a bank or capital opening into
                                        "bills" would be meaningless — there is nothing to age and
                                        nothing to settle it against. */}
                                    {a.isParty && (
                                        <button
                                            type="button"
                                            title="Bill-wise details for this opening balance"
                                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                                            onClick={(e) => { e.stopPropagation(); setBillsForAccount(a.id); }}
                                        >
                                            <ListTree size={14} />
                                        </button>
                                    )}
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
                                <td className="px-5 py-2 text-right font-mono">{suspenseSide === "DEBIT" ? fmt(suspenseAmount) : ""}</td>
                                <td className="px-5 py-2 text-right font-mono">{suspenseSide === "CREDIT" ? fmt(suspenseAmount) : ""}</td>
                            </tr>
                        )}
                    </tfoot>
                </table>
            )}

            {billsForAccount !== null && (
                <OpeningBillsDialog
                    open
                    onOpenChange={(v) => { if (!v) setBillsForAccount(null); }}
                    accountId={billsForAccount}
                    onSaved={onChanged}
                />
            )}
        </div>
    );
}

function ProductOpeningSection({
    products, onChanged, onProductListChanged, openingStockTotal,
}: {
    products: ProductRow[];
    onChanged: () => void;
    onProductListChanged: () => Promise<void> | void;
    openingStockTotal: number;
}) {
    const [showAdd, setShowAdd] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    const [form, setForm] = useState({
        productId: 0,
        qty: "",
        rate: "",
    });
    const [saving, setSaving] = useState(false);
    const [filter, setFilter] = useState("");

    // Barcodes / EANs are not on the summary row, so the filter borrows them
    // from the shared catalogue — the same rule the picker above matches on.
    const { products: catalog } = useProductCatalog<CatalogRow>();
    const codes = useMemo(() => new Map(catalog.map((p) => [p.id, p.codes ?? []])), [catalog]);
    const q = filter.trim().toLowerCase();
    const visible = q
        ? products.filter((p) => productMatchesSearch({ name: p.name, sku: p.sku, codes: codes.get(p.id) }, q))
        : products;

    const handleProductCreated = async (newId: number) => {
        await onProductListChanged();
        setShowCreate(false);
        setShowAdd(true);
        setForm((f) => ({ ...f, productId: newId }));
    };

    useEffect(() => {
        if (!form.productId) return;
        const existing = products.find((p) => p.id === form.productId);
        setForm((f) => ({
            ...f,
            // Product with no opening stock yet → empty boxes, never the last
            // product's qty and rate.
            qty: existing ? String(existing.openingStock ?? "") : "",
            rate: existing ? String(existing.openingRate ?? "") : "",
        }));
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
                qty: qty === 0 ? null : qty,
                rate: qty === 0 ? null : (Number.isFinite(rate) ? rate : null),
            });
            toast.success("Opening stock saved");
            setShowAdd(false);
            setForm({ productId: 0, qty: "", rate: "" });
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
                    <p className="text-xs text-muted-foreground">
                        {q
                            ? `${visible.length} of ${products.length} shown`
                            : `${products.length} ${products.length === 1 ? "product" : "products"} with opening stock`}
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
                        <Plus size={14} /> New product
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setShowAdd((v) => !v)}>
                        <Plus size={14} /> {showAdd ? "Hide editor" : "Add / Edit"}
                    </Button>
                </div>
            </div>

            <QuickCreateProductDialog
                open={showCreate}
                onOpenChange={setShowCreate}
                onCreated={handleProductCreated}
            />

            {showAdd && (
                <div className="border-b border-border bg-muted/30 px-5 py-4 grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
                    <div className="space-y-1.5 md:col-span-2">
                        <Label>Product</Label>
                        <InvProductCombobox
                            value={form.productId || null}
                            onChange={(p) => setForm((f) => ({ ...f, productId: p?.id ?? 0 }))}
                            placeholder="Search name, SKU or barcode…"
                            allowCreate={false}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Qty</Label>
                        <Input type="text" inputMode="decimal" value={form.qty}
                            onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))}
                            placeholder="0 to clear" />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Rate</Label>
                        <Input type="text" inputMode="decimal" value={form.rate}
                            onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))}
                            placeholder="0.00" />
                    </div>
                    <div className="md:col-span-4 flex justify-end gap-2 pt-1">
                        <Button variant="outline" onClick={() => setShowAdd(false)}>Close</Button>
                        <Button onClick={save} disabled={saving || !form.productId}>
                            {saving && <Loader2 size={14} className="animate-spin" />} Save
                        </Button>
                    </div>
                </div>
            )}

            {products.length > 0 && (
                <div className="border-b border-border px-5 py-2">
                    <div className="relative max-w-xs">
                        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input value={filter} onChange={(e) => setFilter(e.target.value)}
                            className="h-8 pl-8" placeholder="Filter by name, SKU or barcode…" />
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
                        {visible.length === 0 && (
                            <tr>
                                <td colSpan={4} className="px-5 py-6 text-center text-muted-foreground">
                                    No product matches “{filter}”.
                                </td>
                            </tr>
                        )}
                        {visible.map((p) => (
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

// ── Quick-create dialogs ─────────────────────────────────────────────────
// Bare-minimum forms so a user can add a missing master without leaving
// the opening-balance page. Full-featured forms still live on the
// dedicated master pages (/office/accountancy/, /office/inventory/products).

function QuickCreateAccountDialog({
    open, onOpenChange, onCreated,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    onCreated: (newId: number) => void | Promise<void>;
}) {
    const [groups, setGroups] = useState<AccountGroupOpt[]>([]);
    const [form, setForm] = useState({
        name: "",
        groupId: "",
        normalBalance: "DEBIT" as "DEBIT" | "CREDIT",
        // Optional opening balance — written straight to the new Account row.
        openingAmount: "",
        openingType: "DEBIT" as "DEBIT" | "CREDIT",
    });
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        // Flatten the group tree so the user picks a leaf-or-anywhere group easily.
        type Node = AccountGroupOpt & { children?: Node[] };
        axios.get<Node[]>("/api/accountancy/account-groups").then((r) => {
            const flat: AccountGroupOpt[] = [];
            const walk = (nodes: Node[]) => {
                for (const n of nodes) {
                    flat.push({ id: n.id, name: n.name, type: n.type, parentId: n.parentId });
                    if (n.children?.length) walk(n.children);
                }
            };
            walk(r.data);
            setGroups(flat);
        }).catch(() => toast.error("Failed to load groups"));
    }, [open]);

    const reset = () => setForm({
        name: "", groupId: "", normalBalance: "DEBIT",
        openingAmount: "", openingType: "DEBIT",
    });

    const save = async () => {
        if (!form.name.trim()) { toast.error("Name required"); return; }
        if (!form.groupId) { toast.error("Pick a group"); return; }
        const opening = parseFloat(form.openingAmount);
        const hasOpening = Number.isFinite(opening) && opening > 0;
        setSaving(true);
        try {
            const { data } = await axios.post<{ id: number }>("/api/accountancy/gl-accounts", {
                name: form.name.trim(),
                groupId: Number(form.groupId),
                normalBalance: form.normalBalance,
                openingBalance: hasOpening ? opening : null,
                openingBalanceType: hasOpening ? form.openingType : null,
            });
            toast.success(`Account "${form.name}" created`);
            reset();
            await onCreated(data.id);
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>New ledger account</DialogTitle></DialogHeader>
                <div className="space-y-3 pt-2">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label>Name</Label>
                            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Petty Cash" />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Dr / Cr (normal)</Label>
                            <Select value={form.normalBalance} onValueChange={(v) => setForm((f) => ({ ...f, normalBalance: v as "DEBIT" | "CREDIT" }))}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="DEBIT">Debit</SelectItem>
                                    <SelectItem value="CREDIT">Credit</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <Label>Group</Label>
                        <Select value={form.groupId} onValueChange={(v) => setForm((f) => ({ ...f, groupId: v }))}>
                            <SelectTrigger><SelectValue placeholder="Select group" /></SelectTrigger>
                            <SelectContent>
                                {groups.map((g) => (
                                    <SelectItem key={g.id} value={String(g.id)}>
                                        {g.name} <span className="text-muted-foreground text-xs">({g.type})</span>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    {/* Opening balance — written straight to Account columns. */}
                    <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                        <p className="text-xs font-medium">Opening balance <span className="text-muted-foreground font-normal">(optional)</span></p>
                        <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                                <Label className="text-xs">Amount (₹)</Label>
                                <Input
                                    type="text" inputMode="decimal"
                                    value={form.openingAmount}
                                    onChange={(e) => setForm((f) => ({ ...f, openingAmount: e.target.value }))}
                                    placeholder="0.00"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Dr / Cr</Label>
                                <Select value={form.openingType} onValueChange={(v) => setForm((f) => ({ ...f, openingType: v as "DEBIT" | "CREDIT" }))}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="DEBIT">Debit</SelectItem>
                                        <SelectItem value="CREDIT">Credit</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
                        <Button onClick={save} disabled={saving}>
                            {saving && <Loader2 size={14} className="animate-spin" />} Create
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function QuickCreateProductDialog({
    open, onOpenChange, onCreated,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    onCreated: (newId: number) => void | Promise<void>;
}) {
    const [units, setUnits] = useState<UnitOpt[]>([]);
    const [form, setForm] = useState({
        sku: "", name: "", unitId: "",
        priceRupees: "",
        openingQty: "", openingRate: "",
    });
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        axios.get<UnitOpt[]>("/api/inventory/units")
            .then((r) => setUnits(r.data))
            .catch(() => toast.error("Failed to load units"));
    }, [open]);

    const reset = () => setForm({
        sku: "", name: "", unitId: "", priceRupees: "",
        openingQty: "", openingRate: "",
    });

    const save = async () => {
        if (!form.sku.trim() || !form.name.trim()) { toast.error("SKU and name required"); return; }
        if (!form.unitId) { toast.error("Pick a unit"); return; }
        const openingQty = parseFloat(form.openingQty);
        const openingRate = parseFloat(form.openingRate);
        const hasOpening = Number.isFinite(openingQty) && openingQty > 0;
        setSaving(true);
        try {
            const { data } = await axios.post<{ id: number }>("/api/inventory/products", {
                sku: form.sku.trim(),
                name: form.name.trim(),
                unitId: Number(form.unitId),
                savedSalePricePaise: parseRupeesToPaise(form.priceRupees),
                openingStock: hasOpening ? openingQty : null,
                openingRate: hasOpening ? (Number.isFinite(openingRate) ? openingRate : null) : null,
            });
            toast.success(`Product "${form.name}" created`);
            reset();
            await onCreated(data.id);
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>New product</DialogTitle></DialogHeader>
                <div className="space-y-3 pt-2">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label>SKU</Label>
                            <Input value={form.sku} onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))} className="font-mono" placeholder="e.g. ENV_A4" />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Unit</Label>
                            <Select value={form.unitId} onValueChange={(v) => setForm((f) => ({ ...f, unitId: v }))}>
                                <SelectTrigger><SelectValue placeholder="Select unit" /></SelectTrigger>
                                <SelectContent>
                                    {units.map((u) => (
                                        <SelectItem key={u.id} value={String(u.id)}>
                                            {u.code} — {u.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <Label>Name</Label>
                        <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Envelope A4 — white" />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Sale price (₹) <span className="text-muted-foreground text-xs">— optional</span></Label>
                        <Input type="text" inputMode="decimal" value={form.priceRupees}
                            onChange={(e) => setForm((f) => ({ ...f, priceRupees: e.target.value }))} placeholder="0.00" />
                        <p className="text-[11px] text-muted-foreground">Cost comes from the Opening Rate below (or future Purchases).</p>
                    </div>
                    {/* Opening stock — written straight to InvProduct columns. */}
                    <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                        <p className="text-xs font-medium">Opening stock <span className="text-muted-foreground font-normal">(optional)</span></p>
                        <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                                <Label className="text-xs">Qty</Label>
                                <Input
                                    type="text" inputMode="decimal"
                                    value={form.openingQty}
                                    onChange={(e) => setForm((f) => ({ ...f, openingQty: e.target.value }))}
                                    placeholder="0"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Rate (₹)</Label>
                                <Input
                                    type="text" inputMode="decimal"
                                    value={form.openingRate}
                                    onChange={(e) => setForm((f) => ({ ...f, openingRate: e.target.value }))}
                                    placeholder="0.00"
                                />
                            </div>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                            Value = qty × rate ={" "}
                            <span className="font-mono">
                                ₹ {((parseFloat(form.openingQty) || 0) * (parseFloat(form.openingRate) || 0)).toFixed(2)}
                            </span>
                        </p>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
                        <Button onClick={save} disabled={saving}>
                            {saving && <Loader2 size={14} className="animate-spin" />} Create
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
