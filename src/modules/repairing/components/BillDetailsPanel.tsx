"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Receipt, Plus, Trash2, Save, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InvProductCombobox, type SelectedProduct } from "@/modules/inventory/components/InvProductCombobox";
import { GlAccountCombobox, type GlAccount } from "@/modules/accountancy/components/GlAccountCombobox";
import { usePosDraftStore } from "@/store/posDraftStore";
import { type ProductOption, type CartLine, type ChargeRow, type Snapshot } from "@/modules/pos/lib/posDraftTypes";

export interface BillProduct { productId: number; sku: string; name: string; qty: number; salePrice: number | null; }
export interface BillCharge { accountId: number; name: string; description: string; amount: number; }
export interface BillDraft { products: BillProduct[]; charges: BillCharge[]; }

interface Props {
    ticketId: number;
    /** Customer's ledger account — needed to preload POS. Null → can't bill. */
    customerAccountId: number | null;
    initial: BillDraft;
    onSaved: () => void;
}

type ProdRow = BillProduct & { key: string };
type ChargeRowUi = BillCharge & { key: string };
let SEQ = 0;
const k = () => `r${++SEQ}`;
const blankProd = (): ProdRow => ({ key: k(), productId: 0, sku: "", name: "", qty: 1, salePrice: null });
const blankCharge = (): ChargeRowUi => ({ key: k(), accountId: 0, name: "", description: "", amount: 0 });

const toNum = (s: string): number | null => {
    const t = s.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
};

// Rebuild a POS cart line from a lookup product — mirrors usePosBilling.addToCart
// (sale price is tax-inclusive; back out the pre-tax unit rate).
function buildCartLine(p: ProductOption, qty: number): CartLine {
    const inclusive = p.effectiveSalePricePaise ? p.effectiveSalePricePaise / 100 : 0;
    const taxRate = p.taxRate ?? 0;
    const unitPrice = taxRate > 0 ? inclusive / (1 + taxRate / 100) : inclusive;
    const wt = p.warrantyTerm;
    const warrantyLabel = wt
        ? (wt.durationDays
            ? (wt.durationDays % 365 === 0 ? `${wt.durationDays / 365}y`
                : wt.durationDays % 30 === 0 ? `${wt.durationDays / 30}m`
                    : `${wt.durationDays}d`)
            : wt.name)
        : null;
    return {
        productId: p.id, sku: p.sku, name: p.name,
        qty, unitPrice, description: "",
        taxRate,
        costPaise: p.costPaise ?? null,
        mrpPaise: p.mrpPaise ?? null,
        barcodePaise: p.barcodePricePaise ?? null,
        warrantyLabel,
        redeemCapPct: p.redeemCapPct ?? null,
    };
}

// Ongoing draft bill: real stock products + additional/service charges on an
// income ledger. Draft only — Generate Bill preloads POS where the real price,
// discount, stock and ledger posting happen.
export default function BillDetailsPanel({ ticketId, customerAccountId, initial, onSaved }: Props) {
    const router = useRouter();
    const [prods, setProds] = useState<ProdRow[]>(() =>
        initial.products.length ? initial.products.map((p) => ({ ...p, key: k() })) : [blankProd()],
    );
    const [charges, setCharges] = useState<ChargeRowUi[]>(() =>
        initial.charges.length ? initial.charges.map((c) => ({ ...c, key: k() })) : [blankCharge()],
    );
    const [incomeAccounts, setIncomeAccounts] = useState<GlAccount[]>([]);
    const [saving, setSaving] = useState(false);
    const [generating, setGenerating] = useState(false);

    // Income ledgers for the service-charge picker (server filters by group type).
    useEffect(() => {
        axios.get<GlAccount[]>("/api/accountancy/gl-accounts?includeParties=false&type=INCOME")
            .then((r) => setIncomeAccounts(r.data))
            .catch(() => setIncomeAccounts([]));
    }, []);

    const setProd = (key: string, patch: Partial<BillProduct>) =>
        setProds((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    const setCharge = (key: string, patch: Partial<BillCharge>) =>
        setCharges((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

    const removeProd = (key: string) => setProds((rs) => (rs.length === 1 ? [blankProd()] : rs.filter((r) => r.key !== key)));
    const removeCharge = (key: string) => setCharges((rs) => (rs.length === 1 ? [blankCharge()] : rs.filter((r) => r.key !== key)));

    const prodTotal = prods.reduce((s, r) => s + r.qty * (r.salePrice ?? 0), 0);
    const chargeTotal = charges.reduce((s, r) => s + (Number.isFinite(r.amount) ? r.amount : 0), 0);
    const total = prodTotal + chargeTotal;

    // Cleaned lines ready to persist / bill.
    const cleanProducts = (): BillProduct[] => prods.filter((r) => r.productId > 0).map(({ productId, sku, name, qty, salePrice }) => ({ productId, sku, name, qty: qty || 1, salePrice }));
    const cleanCharges = (): BillCharge[] => charges.filter((r) => r.accountId > 0).map(({ accountId, name, description, amount }) => ({ accountId, name, description: description.trim(), amount: amount || 0 }));

    const persist = async (products: BillProduct[], chg: BillCharge[]) => {
        await axios.post(`/api/tickets/${ticketId}/bill-draft`, { products, charges: chg });
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await persist(cleanProducts(), cleanCharges());
            toast.success("Bill saved");
            onSaved();
        } catch (err) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : null;
            toast.error(msg ?? "Failed to save bill");
        } finally {
            setSaving(false);
        }
    };

    const handleGenerateBill = async () => {
        if (!customerAccountId) { toast.error("This ticket has no customer ledger — cannot bill"); return; }
        const products = cleanProducts();
        const chg = cleanCharges();
        if (!products.length && !chg.length) { toast.error("Add at least one product or charge first"); return; }
        setGenerating(true);
        try {
            await persist(products, chg);

            const [{ data: snapshot }, { data: catalogue }] = await Promise.all([
                axios.get<Snapshot>(`/api/pos/account-snapshot/${customerAccountId}`),
                axios.get<ProductOption[]>(`/api/inventory/products/lookup`),
            ]);

            const byId = new Map(catalogue.map((p) => [p.id, p]));
            const cart: CartLine[] = [];
            for (const r of products) {
                const p = byId.get(r.productId);
                if (p) cart.push(buildCartLine(p, r.qty));
            }
            const posCharges: ChargeRow[] = chg.map((c) => ({
                id: Math.random().toString(36).slice(2, 10),
                accountId: c.accountId,
                description: c.description || c.name,
                amount: c.amount ? String(c.amount) : "",
            }));

            // Preload the shared POS draft, then open the new-sale screen.
            const draft = usePosDraftStore.getState();
            draft.reset();
            draft.setSnapshot(snapshot);
            draft.setCart(cart);
            draft.setCharges(posCharges);
            router.push("/vouchers/pos/new");
        } catch (err) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : null;
            toast.error(msg ?? "Could not open POS with the bill");
            setGenerating(false);
        }
    };

    const cellBox = "flex h-9 items-center rounded-md border border-border bg-background px-2";

    return (
        <div className="rounded-lg border-2 border-primary/40 bg-card p-5 shadow">
            <div className="mb-1 flex items-center gap-2">
                <Receipt size={16} className="text-primary" />
                <h2 className="font-semibold text-foreground">Bill Details</h2>
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">Ongoing</span>
                <span className="ml-auto text-sm font-semibold text-foreground">≈ ₹ {total.toFixed(2)}</span>
            </div>
            <p className="mb-4 text-xs text-muted-foreground">Add stock products and service charges as the repair runs. Amounts are indicative — Generate Bill opens POS where the real price &amp; discount apply.</p>

            {/* ── Products ── */}
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Products (from stock)</h3>
            <div className="space-y-1.5">
                {prods.map((r) => (
                    <div key={r.key} className="grid grid-cols-[1fr_64px_90px_28px] items-center gap-2">
                        <InvProductCombobox
                            value={r.productId || null}
                            allowCreate={false}
                            placeholder="Search item…"
                            className={cellBox}
                            onChange={(sp: SelectedProduct | null) =>
                                setProd(r.key, { productId: sp?.id ?? 0, sku: sp?.sku ?? "", name: sp?.name ?? "", salePrice: sp?.salePrice ?? null })
                            }
                        />
                        <Input className="h-9 text-right" inputMode="decimal" value={r.qty} placeholder="Qty" onChange={(e) => setProd(r.key, { qty: toNum(e.target.value) ?? 0 })} />
                        <span className="text-right text-sm tabular-nums text-muted-foreground">{(r.qty * (r.salePrice ?? 0)).toFixed(2)}</span>
                        <Button variant="ghost" size="icon-sm" onClick={() => removeProd(r.key)} className="text-muted-foreground hover:text-destructive hover:bg-destructive/10" title="Remove"><Trash2 size={14} /></Button>
                    </div>
                ))}
            </div>
            <Button variant="outline" size="sm" onClick={() => setProds((rs) => [...rs, blankProd()])} className="mt-2"><Plus size={14} /> Add product</Button>

            {/* ── Service / additional charges ── */}
            <h3 className="mb-1.5 mt-5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Service &amp; additional charges (income ledger)</h3>
            <div className="space-y-1.5">
                {charges.map((r) => (
                    <div key={r.key} className="grid grid-cols-[1fr_1fr_90px_28px] items-center gap-2">
                        <GlAccountCombobox
                            value={r.accountId || null}
                            accounts={incomeAccounts}
                            placeholder="Income ledger…"
                            className={cellBox}
                            onChange={(a: GlAccount | null) => setCharge(r.key, { accountId: a?.id ?? 0, name: a?.name ?? "" })}
                        />
                        <Input className="h-9" value={r.description} placeholder="Note (e.g. Labour)" onChange={(e) => setCharge(r.key, { description: e.target.value })} />
                        <Input className="h-9 text-right" inputMode="decimal" value={r.amount ? r.amount : ""} placeholder="0" onChange={(e) => setCharge(r.key, { amount: toNum(e.target.value) ?? 0 })} />
                        <Button variant="ghost" size="icon-sm" onClick={() => removeCharge(r.key)} className="text-muted-foreground hover:text-destructive hover:bg-destructive/10" title="Remove"><Trash2 size={14} /></Button>
                    </div>
                ))}
            </div>
            <Button variant="outline" size="sm" onClick={() => setCharges((rs) => [...rs, blankCharge()])} className="mt-2"><Plus size={14} /> Add charge</Button>

            {/* ── Footer ── */}
            <div className="mt-5 flex items-center justify-between border-t border-border pt-3">
                <span className="text-xs text-muted-foreground">Indicative total <span className="font-semibold text-foreground">≈ ₹ {total.toFixed(2)}</span></span>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handleSave} disabled={saving || generating}>
                        <Save size={14} /> {saving ? "Saving…" : "Save"}
                    </Button>
                    <Button size="sm" onClick={handleGenerateBill} disabled={generating || saving || !customerAccountId} title={!customerAccountId ? "No customer ledger on this ticket" : "Open POS preloaded with these lines"}>
                        <ShoppingCart size={14} /> {generating ? "Opening POS…" : "Generate Bill"}
                    </Button>
                </div>
            </div>
        </div>
    );
}
