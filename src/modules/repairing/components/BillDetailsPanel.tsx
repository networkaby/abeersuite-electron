"use client";

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Receipt, Plus, Trash2, ShoppingCart, Check, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { InvProductCombobox, type SelectedProduct } from "@/modules/inventory/components/InvProductCombobox";
import { usePosDraftStore } from "@/store/posDraftStore";
import { loadProductCatalog } from "@/shared/hooks";
import { type ProductOption, type PosServiceOption, type CartLine, type Snapshot } from "@/modules/pos/lib/posDraftTypes";

export interface BillProduct { productId: number; sku: string; name: string; qty: number; salePrice: number | null; }
// `price` is tax-INCLUSIVE ₹ (PosService.defaultPricePaise convention); null = catalogue default.
export interface BillService { serviceId: number; name: string; qty: number; price: number | null; note: string; }
export interface BillDraft { products: BillProduct[]; services: BillService[]; }

interface Props {
    ticketId: number;
    /** Customer's ledger account — needed to preload POS. Null → can't bill. */
    customerAccountId: number | null;
    /** Whether the ticket's status is at a "ready to bill" stage (workflow constant). */
    canGenerateBill: boolean;
    initial: BillDraft;
}

type ProdRow = BillProduct & { key: string };
type SvcRow = BillService & { key: string };
let SEQ = 0;
const k = () => `r${++SEQ}`;
const blankProd = (): ProdRow => ({ key: k(), productId: 0, sku: "", name: "", qty: 1, salePrice: null });
const blankSvc = (): SvcRow => ({ key: k(), serviceId: 0, name: "", qty: 1, price: null, note: "" });

const toNum = (s: string): number | null => {
    const t = s.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
};

// Rebuild a POS cart line from a lookup product — mirrors usePosBilling.addToCart
// (sale price is tax-inclusive; back out the pre-tax unit rate).
function buildProductLine(p: ProductOption, qty: number): CartLine {
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

// Rebuild a POS service cart line — mirrors usePosBilling.addServiceToCart
// (kind="service", negative line id, tax-inclusive price backed out to pre-tax).
function buildServiceLine(svc: PosServiceOption, s: BillService): CartLine {
    const inclusive = s.price ?? (svc.defaultPricePaise ? svc.defaultPricePaise / 100 : 0);
    const rate = svc.taxRate ?? 0;
    const unitPrice = rate > 0 ? inclusive / (1 + rate / 100) : inclusive;
    return {
        productId: -svc.id, sku: "SVC", name: svc.name, kind: "service",
        qty: s.qty, unitPrice, description: s.note,
        taxRate: rate,
    };
}

// Ongoing draft bill: real stock products + POS catalogue services (Settings →
// Services, each with its own GST + ledger). Draft only — Generate
// Bill preloads POS where the real price, discount, stock and ledger apply.
export default function BillDetailsPanel({ ticketId, customerAccountId, canGenerateBill, initial }: Props) {
    const router = useRouter();
    const [prods, setProds] = useState<ProdRow[]>(() =>
        initial.products.length ? initial.products.map((p) => ({ ...p, key: k() })) : [blankProd()],
    );
    const [svcs, setSvcs] = useState<SvcRow[]>(() =>
        initial.services.length ? initial.services.map((s) => ({ ...s, key: k() })) : [blankSvc()],
    );
    const [catalogue, setCatalogue] = useState<PosServiceOption[]>([]);
    const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
    const [generating, setGenerating] = useState(false);

    // Same catalogue POS uses (Settings → Services).
    useEffect(() => {
        axios.get<PosServiceOption[]>("/api/pos/services")
            .then((r) => setCatalogue(r.data))
            .catch(() => setCatalogue([]));
    }, []);

    const setProd = (key: string, patch: Partial<BillProduct>) =>
        setProds((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    const setSvc = (key: string, patch: Partial<BillService>) =>
        setSvcs((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

    const removeProd = (key: string) => setProds((rs) => (rs.length === 1 ? [blankProd()] : rs.filter((r) => r.key !== key)));
    const removeSvc = (key: string) => setSvcs((rs) => (rs.length === 1 ? [blankSvc()] : rs.filter((r) => r.key !== key)));

    const pickService = (key: string, serviceId: number) => {
        const svc = catalogue.find((c) => c.id === serviceId);
        setSvc(key, {
            serviceId,
            name: svc?.name ?? "",
            // Seed the editable price from the catalogue default (tax-inclusive ₹).
            price: svc?.defaultPricePaise != null ? svc.defaultPricePaise / 100 : null,
        });
    };

    const svcAmount = (r: SvcRow) => r.qty * (r.price ?? 0);
    const prodTotal = prods.reduce((s, r) => s + r.qty * (r.salePrice ?? 0), 0);
    const svcTotal = svcs.reduce((s, r) => s + svcAmount(r), 0);
    const total = prodTotal + svcTotal;

    const cleanProducts = (): BillProduct[] => prods.filter((r) => r.productId > 0).map(({ productId, sku, name, qty, salePrice }) => ({ productId, sku, name, qty: qty || 1, salePrice }));
    const cleanServices = (): BillService[] => svcs.filter((r) => r.serviceId > 0).map(({ serviceId, name, qty, price, note }) => ({ serviceId, name, qty: qty || 1, price, note: note.trim() }));

    const persist = async (products: BillProduct[], services: BillService[]) => {
        await axios.post(`/api/tickets/${ticketId}/bill-draft`, { products, services });
    };

    // Auto-save: debounced write on every edit (no Save button). Skips the first
    // render so opening the panel doesn't re-save unchanged data.
    const firstRender = useRef(true);
    useEffect(() => {
        if (firstRender.current) { firstRender.current = false; return; }
        const products = prods.filter((r) => r.productId > 0).map(({ productId, sku, name, qty, salePrice }) => ({ productId, sku, name, qty: qty || 1, salePrice }));
        const services = svcs.filter((r) => r.serviceId > 0).map(({ serviceId, name, qty, price, note }) => ({ serviceId, name, qty: qty || 1, price, note: note.trim() }));
        const t = setTimeout(() => {
            setSaveState("saving");
            axios.post(`/api/tickets/${ticketId}/bill-draft`, { products, services })
                .then(() => setSaveState("saved"))
                .catch(() => setSaveState("error"));
        }, 800);
        return () => clearTimeout(t);
    }, [prods, svcs, ticketId]);

    const handleGenerateBill = async () => {
        if (!customerAccountId) { toast.error("This ticket has no customer ledger — cannot bill"); return; }
        const products = cleanProducts();
        const services = cleanServices();
        if (!products.length && !services.length) { toast.error("Add at least one product or service first"); return; }
        setGenerating(true);
        try {
            await persist(products, services);

            const [{ data: snapshot }, prodCatalogue, { data: svcCatalogue }] = await Promise.all([
                axios.get<Snapshot>(`/api/pos/account-snapshot/${customerAccountId}`),
                loadProductCatalog<ProductOption>(),
                axios.get<PosServiceOption[]>(`/api/pos/services`),
            ]);

            const prodById = new Map(prodCatalogue.map((p) => [p.id, p]));
            const svcById = new Map(svcCatalogue.map((s) => [s.id, s]));
            const cart: CartLine[] = [];
            for (const r of products) {
                const p = prodById.get(r.productId);
                if (p) cart.push(buildProductLine(p, r.qty));
            }
            for (const s of services) {
                const svc = svcById.get(s.serviceId);
                if (svc) cart.push(buildServiceLine(svc, s));
            }

            // Preload the shared POS draft, then open the new-sale screen. The
            // ticketId rides through so the finished bill links back here.
            const draft = usePosDraftStore.getState();
            draft.reset();
            draft.setSnapshot(snapshot);
            draft.setCart(cart);
            draft.setTicketId(ticketId);
            router.push("/vouchers/pos/new");
        } catch (err) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : null;
            toast.error(msg ?? "Could not open POS with the bill");
            setGenerating(false);
        }
    };

    return (
        <div className="rounded-lg border-2 border-primary/40 bg-card p-5 shadow">
            <div className="mb-1 flex items-center gap-2">
                <Receipt size={16} className="text-primary" />
                <h2 className="font-semibold text-foreground">Bill Details</h2>
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">Ongoing</span>
                <span className="ml-auto text-sm font-semibold text-foreground">≈ ₹ {total.toFixed(2)}</span>
            </div>
            <p className="mb-4 text-xs text-muted-foreground">Add stock products and services as the repair runs. Amounts are indicative — Generate Bill opens POS where the real price &amp; discount apply.</p>

            {/* ── Products ── */}
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Products (from stock)</h3>
            <div className="space-y-1.5">
                {prods.map((r) => (
                    <div key={r.key} className="grid grid-cols-[1fr_64px_90px_28px] items-center gap-2">
                        <InvProductCombobox
                            value={r.productId || null}
                            allowCreate={false}
                            placeholder="Search item…"
                            className="flex h-9 items-center rounded-md border border-border bg-background px-2"
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

            {/* ── Services (POS catalogue — GST + income ledger from Settings) ── */}
            <h3 className="mb-1.5 mt-5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Services</h3>
            <div className="space-y-1.5">
                {svcs.map((r) => (
                    <div key={r.key} className="grid grid-cols-[1fr_1fr_52px_80px_28px] items-center gap-2">
                        <Select value={r.serviceId ? String(r.serviceId) : ""} onValueChange={(v) => pickService(r.key, Number(v))}>
                            <SelectTrigger className="h-9 w-full"><SelectValue placeholder="Select service…" /></SelectTrigger>
                            <SelectContent>
                                {catalogue.length === 0 && <SelectItem value="__none__" disabled>No services yet — add in Settings → Services</SelectItem>}
                                {catalogue.map((s) => (
                                    <SelectItem key={s.id} value={String(s.id)}>
                                        {s.name}{s.taxRate ? ` · GST ${s.taxRate}%` : ""}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Input className="h-9" value={r.note} placeholder="Note (optional)" onChange={(e) => setSvc(r.key, { note: e.target.value })} />
                        <Input className="h-9 text-right" inputMode="decimal" value={r.qty} placeholder="Qty" onChange={(e) => setSvc(r.key, { qty: toNum(e.target.value) ?? 0 })} />
                        <Input className="h-9 text-right" inputMode="decimal" value={r.price ?? ""} placeholder="Price" title="Tax-inclusive price — defaults from the catalogue" onChange={(e) => setSvc(r.key, { price: toNum(e.target.value) })} />
                        <Button variant="ghost" size="icon-sm" onClick={() => removeSvc(r.key)} className="text-muted-foreground hover:text-destructive hover:bg-destructive/10" title="Remove"><Trash2 size={14} /></Button>
                    </div>
                ))}
            </div>
            <Button variant="outline" size="sm" onClick={() => setSvcs((rs) => [...rs, blankSvc()])} className="mt-2"><Plus size={14} /> Add service</Button>

            {/* ── Footer ── */}
            <div className="mt-5 flex items-center justify-between border-t border-border pt-3">
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>Indicative total <span className="font-semibold text-foreground">≈ ₹ {total.toFixed(2)}</span></span>
                    <span className="flex items-center gap-1">
                        {saveState === "saving" && <><Loader2 size={12} className="animate-spin" /> Saving…</>}
                        {saveState === "saved" && <><Check size={12} className="text-green-600" /> Saved</>}
                        {saveState === "error" && <span className="flex items-center gap-1 text-destructive"><AlertCircle size={12} /> Save failed</span>}
                        {saveState === "idle" && <span className="opacity-70">Auto-saves</span>}
                    </span>
                </div>
                {canGenerateBill && (
                    <Button size="sm" onClick={handleGenerateBill} disabled={generating || !customerAccountId} title={!customerAccountId ? "No customer ledger on this ticket" : "Open POS preloaded with these lines"}>
                        <ShoppingCart size={14} /> {generating ? "Opening POS…" : "Generate Bill"}
                    </Button>
                )}
            </div>
        </div>
    );
}
