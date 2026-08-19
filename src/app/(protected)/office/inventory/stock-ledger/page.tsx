"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
    BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { BreadcrumbBar } from "@/shared/components/BreadcrumbBar";
import { useEscape } from "@/shared/hooks";
import { fmt } from "@/utils/constants";

type Product = {
    id:   number;
    sku:  string;
    name: string;
    unit: { code: string; label: string };
};

type LedgerRow = {
    id:          number;
    date:        string;
    reference:   string;
    voucherType: string;
    description: string;
    partyName:   string | null;
    inQty:       number | null;
    outQty:      number | null;
    rate:        number;
    amount:      number;
    balance:     number;
};

type LedgerResponse = {
    product:     Product;
    from:        string;
    to:          string;
    openingQty:  number;
    closingQty:  number;
    rows:        LedgerRow[];
};

const VOUCHER_TYPE_LABELS: Record<string, string> = {
    PURCHASE:   "Purchase",
    SALE:       "Sale",
};

export default function StockLedgerPage() {
    const router = useRouter();
    useEscape(() => router.back());
    const [products, setProducts]   = useState<Product[]>([]);
    const [productId, setProductId] = useState<string>("");
    const [from, setFrom]           = useState(() => { const d = new Date(); return `${d.getFullYear()}-01-01`; });
    const [to,   setTo]             = useState(() => toIsoDate(new Date()));
    const [ledger, setLedger]       = useState<LedgerResponse | null>(null);
    const [loading, setLoading]     = useState(false);

    useEffect(() => {
        axios.get<Product[]>("/api/inventory/products")
            .then((r) => setProducts(r.data))
            .catch(() => toast.error("Failed to load products"));
    }, []);

    const load = () => {
        if (!productId) { toast.error("Select a product first"); return; }
        setLoading(true);
        axios.get<LedgerResponse>(`/api/inventory/stock-ledger/${productId}?from=${from}&to=${to}`)
            .then((r) => setLedger(r.data))
            .catch(() => toast.error("Failed to load stock ledger"))
            .finally(() => setLoading(false));
    };

    return (
        <div className="space-y-6 max-w-5xl">
            {/* Breadcrumb bar — uniform with the other inventory pages */}
            <BreadcrumbBar>
                <Breadcrumb>
                    <BreadcrumbList>
                        <BreadcrumbItem>
                            <BreadcrumbLink asChild>
                                <Link href="/office/inventory">Inventory</Link>
                            </BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                            <BreadcrumbPage>Stock Ledger</BreadcrumbPage>
                        </BreadcrumbItem>
                    </BreadcrumbList>
                </Breadcrumb>
            </BreadcrumbBar>

            <div>
                <h2 className="text-xl font-semibold flex items-center gap-2">
                    <BookOpen className="size-5" aria-hidden /> Stock Ledger
                </h2>
                <p className="text-muted-foreground text-sm mt-0.5">
                    Per-product transaction history — opening, movements, closing balance.
                </p>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-end gap-4 rounded-lg border border-border bg-card p-4">
                <div className="space-y-1 flex-1 min-w-[200px]">
                    <Label>Product</Label>
                    <Select value={productId} onValueChange={setProductId}>
                        <SelectTrigger>
                            <SelectValue placeholder="Select a product…" />
                        </SelectTrigger>
                        <SelectContent>
                            {products.map((p) => (
                                <SelectItem key={p.id} value={String(p.id)}>
                                    <span className="font-mono text-xs mr-2">{p.sku}</span>{p.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-1">
                    <Label>From</Label>
                    <TallyDateInput value={from} onValueChange={setFrom} className="w-36" />
                </div>
                <div className="space-y-1">
                    <Label>To</Label>
                    <TallyDateInput value={to} onValueChange={setTo} monthMode="end" className="w-36" />
                </div>
                <Button onClick={load} disabled={loading || !productId}>
                    {loading ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
                    Show Ledger
                </Button>
            </div>

            {/* Ledger table */}
            {ledger && (
                <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                        <div>
                            <span className="font-semibold">{ledger.product.name}</span>
                            <span className="ml-2 font-mono text-muted-foreground text-xs">{ledger.product.sku}</span>
                            <span className="ml-2 text-muted-foreground">· Unit: {ledger.product.unit.code}</span>
                        </div>
                        <div className="text-muted-foreground text-xs">
                            {new Date(ledger.from).toLocaleDateString()} – {new Date(ledger.to).toLocaleDateString()}
                        </div>
                    </div>

                    <div className="overflow-hidden rounded-lg border border-border bg-card shadow">
                        <table className="w-full text-sm">
                            <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-4 py-3 text-left font-medium">Date</th>
                                    <th className="px-4 py-3 text-left font-medium">Voucher</th>
                                    <th className="px-4 py-3 text-left font-medium">Type</th>
                                    <th className="px-4 py-3 text-left font-medium">Party</th>
                                    <th className="px-4 py-3 text-right font-medium">In Qty</th>
                                    <th className="px-4 py-3 text-right font-medium">Out Qty</th>
                                    <th className="px-4 py-3 text-right font-medium">Rate (₹)</th>
                                    <th className="px-4 py-3 text-right font-medium">Amount (₹)</th>
                                    <th className="px-4 py-3 text-right font-medium">Balance</th>
                                </tr>
                            </thead>
                            <tbody>
                                {/* Opening balance row */}
                                <tr className="bg-muted/60 border-b border-border">
                                    <td className="px-4 py-2 text-muted-foreground text-xs" colSpan={4}>
                                        Opening Balance as of {new Date(ledger.from).toLocaleDateString()}
                                    </td>
                                    <td colSpan={4} />
                                    <td className="px-4 py-2 text-right font-mono font-semibold">
                                        {ledger.openingQty}
                                    </td>
                                </tr>

                                {ledger.rows.length === 0 ? (
                                    <tr>
                                        <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                                            No stock movements in this period
                                        </td>
                                    </tr>
                                ) : (
                                    ledger.rows.map((row) => (
                                        <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30">
                                            <td className="px-4 py-2 text-muted-foreground">{new Date(row.date).toLocaleDateString()}</td>
                                            <td className="px-4 py-2 font-mono text-primary text-xs">{row.reference}</td>
                                            <td className="px-4 py-2">
                                                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                                                    row.voucherType === "PURCHASE" ? "bg-blue-100 text-blue-700" :
                                                    row.voucherType === "SALE"     ? "bg-orange-100 text-orange-700" :
                                                    "bg-muted text-muted-foreground"
                                                }`}>
                                                    {VOUCHER_TYPE_LABELS[row.voucherType] ?? row.voucherType}
                                                </span>
                                            </td>
                                            <td className="px-4 py-2 text-muted-foreground text-xs">{row.partyName ?? "—"}</td>
                                            <td className="px-4 py-2 text-right font-mono text-green-700">
                                                {row.inQty != null ? row.inQty : ""}
                                            </td>
                                            <td className="px-4 py-2 text-right font-mono text-red-600">
                                                {row.outQty != null ? row.outQty : ""}
                                            </td>
                                            <td className="px-4 py-2 text-right font-mono text-muted-foreground">{fmt(row.rate)}</td>
                                            <td className="px-4 py-2 text-right font-mono">{fmt(Math.abs(row.amount))}</td>
                                            <td className={`px-4 py-2 text-right font-mono font-semibold ${row.balance < 0 ? "text-destructive" : ""}`}>
                                                {row.balance}
                                            </td>
                                        </tr>
                                    ))
                                )}

                                {/* Closing balance row */}
                                <tr className="border-t-2 border-border bg-muted/60 font-semibold">
                                    <td className="px-4 py-2 text-xs text-muted-foreground" colSpan={4}>
                                        Closing Balance as of {new Date(ledger.to).toLocaleDateString()}
                                    </td>
                                    <td className="px-4 py-2 text-right font-mono text-green-700 text-xs">
                                        {ledger.rows.reduce((s, r) => s + (r.inQty ?? 0), 0) || ""}
                                    </td>
                                    <td className="px-4 py-2 text-right font-mono text-red-600 text-xs">
                                        {ledger.rows.reduce((s, r) => s + (r.outQty ?? 0), 0) || ""}
                                    </td>
                                    <td colSpan={2} />
                                    <td className={`px-4 py-2 text-right font-mono text-base ${ledger.closingQty < 0 ? "text-destructive" : ""}`}>
                                        {ledger.closingQty}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
