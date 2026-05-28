"use client";

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
    Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
    BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useEscape } from "@/shared/hooks";
import { Box, Loader2, RefreshCw, AlertTriangle, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { fmt } from "@/utils/constants";
import { formatDate } from "@/shared/lib/format/formatDate";
import { cn } from "@/shared/lib/format/utils";
import { EntityListPanel } from "@/shared/components/EntityListPanel";
import { BreadcrumbBar } from "@/shared/components/BreadcrumbBar";
import { VoucherActionsMenu, editFormUrl } from "@/modules/inventory/components/VoucherActionsMenu";
import { InvProductDialog } from "@/modules/inventory/components/InvProductDialog";

// ── Types ────────────────────────────────────────────────────────────────────

type ProductListItem = {
    id: number;
    sku: string;
    name: string;
    stock: number;
    lowStockThreshold: number;
    isLow: boolean;
    unit: { code: string; label: string };
    brand: { name: string } | null;
    category: { name: string } | null;
};

type Transaction = {
    lineId: number;
    voucherId: number;
    type: string;
    reference: string;
    date: string;
    partyName: string | null;
    partyType: string | null;
    partyId: number | null;
    quantity: number;
    rate: number;
    amount: number;
    unitCode: string;
    paymentStatus: "PAID" | "PARTIAL" | "UNPAID" | "N/A";
};

type ProductDetail = {
    id: number;
    sku: string;
    name: string;
    stock: number | null;
    /** Derived from LAST_INWARD ledger walk (PR 4 enrichment of the transactions API). */
    lastPurchasePaise: number | null;
    pricePaise: number | null;
    lowStockThreshold: number;
    unit: { code: string; label: string };
    category: { name: string } | null;
    brand: { name: string } | null;
    branchStocks?: { stock: number; branch: { id: string; name: string } }[];
};

type DetailResponse = {
    product: ProductDetail;
    transactions: Transaction[];
};

// ── Helpers ──────────────────────────────────────────────────────────────────

// VOUCHER_URLS + voucherUrl are now exported from VoucherActionsMenu so both
// the link cell here and the dropdown menu share one source of truth.

const TYPE_COLORS: Record<string, string> = {
    SALE: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
    PURCHASE: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    SALE_RETURN: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
    PURCHASE_RETURN: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
    GRN: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300",
    CHALLAN: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
};

function typeLabel(type: string): string {
    return type
        .split("_")
        .map((w) => w[0] + w.slice(1).toLowerCase())
        .join(" ");
}

const STATUS_COLORS: Record<string, string> = {
    PAID: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
    PARTIAL: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    UNPAID: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

function today(): string {
    return new Date().toISOString().slice(0, 10);
}

function startOfYear(): string {
    return `${new Date().getFullYear()}-01-01`;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function InventoryDetailsPage() {
    const router = useRouter();
    const params = useSearchParams();
    const [products, setProducts] = useState<ProductListItem[]>([]);
    const [search, setSearch] = useState("");
    const [selectedId, setSelectedId] = useState<number | null>(() => {
        const id = params.get("productId");
        return id ? Number(id) : null;
    });
    const [detail, setDetail] = useState<DetailResponse | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [from, setFrom] = useState(startOfYear());
    const [to, setTo] = useState(today());
    const [editOpen, setEditOpen] = useState(false);

    useEffect(() => {
        axios
            .get<{ rows: ProductListItem[] }>("/api/inventory/reports/stock-summary")
            .then((r) => setProducts(r.data.rows))
            .catch(() => toast.error("Failed to load products"));
    }, []);

    const loadDetail = useCallback((id: number, f: string, t: string) => {
        setDetailLoading(true);
        axios
            .get<DetailResponse>(`/api/inventory/products/${id}/transactions?from=${f}&to=${t}`)
            .then((r) => setDetail(r.data))
            .catch(() => toast.error("Failed to load product transactions"))
            .finally(() => setDetailLoading(false));
    }, []);

    useEffect(() => {
        if (!selectedId) {
            setDetail(null);
            return;
        }
        loadDetail(selectedId, from, to);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId]);

    const handleRefresh = () => {
        if (selectedId) loadDetail(selectedId, from, to);
    };

    useEscape(() => {
        if (selectedId) setSelectedId(null);
        else router.back();
    });

    const filtered = search
        ? products.filter(
            (p) =>
                p.name.toLowerCase().includes(search.toLowerCase()) ||
                p.sku.toLowerCase().includes(search.toLowerCase()),
        )
        : products;

    return (
        <div className="flex h-full flex-col overflow-hidden bg-card">
            {/* Breadcrumb bar */}
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
                            {selectedId && detail ? (
                                <BreadcrumbLink asChild>
                                    <button type="button" onClick={() => setSelectedId(null)} className="transition-colors hover:text-foreground">
                                        Inventory Details
                                    </button>
                                </BreadcrumbLink>
                            ) : (
                                <BreadcrumbPage>Inventory Details</BreadcrumbPage>
                            )}
                        </BreadcrumbItem>
                        {selectedId && detail && (
                            <>
                                <BreadcrumbSeparator />
                                <BreadcrumbItem>
                                    <BreadcrumbPage>{detail.product.name}</BreadcrumbPage>
                                </BreadcrumbItem>
                            </>
                        )}
                    </BreadcrumbList>
                </Breadcrumb>
            </BreadcrumbBar>

            {/* Master-detail row */}
            <div className="flex flex-1 overflow-hidden">
            <EntityListPanel
                title="Products"
                icon={<Box size={15} className="text-primary" />}
                count={products.length}
                search={search}
                onSearchChange={setSearch}
                searchPlaceholder="Search name or SKU…"
                onAdd={() => router.push("/office/inventory/products")}
                addLabel="Add Product"
                isEmpty={filtered.length === 0}
                emptyMessage={search ? "No matches" : "No products"}
            >
                {filtered.map((p) => (
                    <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedId(p.id)}
                        className={cn(
                            "w-full text-left border-b px-4 py-3 transition-colors hover:bg-muted/50",
                            selectedId === p.id
                                ? "bg-primary/10 border-l-2 border-l-primary"
                                : "border-l-2 border-l-transparent",
                        )}
                    >
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">{p.name}</p>
                                <p className="font-mono text-xs text-muted-foreground">{p.sku}</p>
                            </div>
                            <span
                                className={cn(
                                    "shrink-0 rounded px-1.5 py-0.5 text-xs font-mono font-medium",
                                    p.isLow
                                        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                                        : "bg-muted text-muted-foreground",
                                )}
                            >
                                {p.stock ?? 0}
                                {p.isLow && <AlertTriangle size={10} className="inline ml-0.5" />}
                            </span>
                        </div>
                    </button>
                ))}
            </EntityListPanel>

            {/* ── Right section: product detail ── */}
            <section className="flex flex-1 flex-col overflow-hidden bg-muted/30">
                {!selectedId && (
                    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
                        <Box size={40} strokeWidth={1} />
                        <p className="text-sm">Select a product to view its ledger</p>
                    </div>
                )}

                {selectedId && detailLoading && (
                    <div className="flex flex-1 items-center justify-center text-muted-foreground">
                        <Loader2 size={22} className="animate-spin" />
                    </div>
                )}

                {selectedId && !detailLoading && detail && (
                    <>
                        {/* Product summary strip */}
                        <div className="border-b bg-card px-6 py-4">
                            <div className="flex items-start justify-between gap-4 flex-wrap">
                                <div>
                                    <h2 className="text-lg font-bold leading-tight">{detail.product.name}</h2>
                                    <p className="font-mono text-xs text-muted-foreground mt-0.5">{detail.product.sku}</p>
                                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                                        {detail.product.category && (
                                            <Badge variant="secondary" className="text-xs">{detail.product.category.name}</Badge>
                                        )}
                                        {detail.product.brand && (
                                            <Badge variant="outline" className="text-xs">{detail.product.brand.name}</Badge>
                                        )}
                                    </div>
                                </div>
                                <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                                    <Pencil size={13} className="mr-1.5" />
                                    Edit Product
                                </Button>
                            </div>

                            {/* 4-stat row */}
                            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                                <StatBox
                                    label="Sale Price"
                                    value={detail.product.pricePaise != null ? fmt(detail.product.pricePaise / 100) : "—"}
                                />
                                <StatBox
                                    label="Cost Price"
                                    value={detail.product.lastPurchasePaise != null ? fmt(detail.product.lastPurchasePaise / 100) : "—"}
                                />
                                <StatBox
                                    label="Stock Qty"
                                    value={`${detail.product.stock ?? 0} ${detail.product.unit.code}`}
                                    alert={(detail.product.stock ?? 0) <= detail.product.lowStockThreshold}
                                />
                                <StatBox
                                    label="Stock Value"
                                    value={
                                        detail.product.lastPurchasePaise != null && (detail.product.stock ?? 0) > 0
                                            ? fmt(((detail.product.stock ?? 0) * detail.product.lastPurchasePaise) / 100)
                                            : "—"
                                    }
                                />
                            </div>

                            {/* Per-branch stock breakdown */}
                            {detail.product.branchStocks && detail.product.branchStocks.length > 0 && (
                                <div className="mt-3 rounded-lg border border-border bg-muted/30 overflow-hidden">
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="border-b border-border bg-muted/60">
                                                <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Branch</th>
                                                <th className="px-3 py-1.5 text-right font-medium text-muted-foreground">Stock</th>
                                                <th className="px-3 py-1.5 text-right font-medium text-muted-foreground"></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {detail.product.branchStocks.map((bs) => {
                                                const isLow = bs.stock <= detail.product.lowStockThreshold;
                                                return (
                                                    <tr key={bs.branch.id} className="border-b last:border-0">
                                                        <td className="px-3 py-1.5 text-muted-foreground">{bs.branch.name}</td>
                                                        <td className={cn("px-3 py-1.5 text-right font-mono font-medium", isLow ? "text-amber-700 dark:text-amber-400" : "")}>
                                                            {bs.stock} {detail.product.unit.code}
                                                        </td>
                                                        <td className="px-3 py-1.5 text-right">
                                                            {isLow && <AlertTriangle size={11} className="inline text-amber-500" />}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        {/* Transactions */}
                        <div className="flex flex-1 flex-col overflow-hidden">
                            {/* Filter bar */}
                            <div className="flex items-center gap-3 border-b bg-card px-6 py-2.5 flex-wrap">
                                <span className="text-sm font-semibold shrink-0">Transactions</span>
                                <div className="flex items-center gap-2 ml-auto flex-wrap">
                                    <label className="text-xs text-muted-foreground">From</label>
                                    <TallyDateInput
                                        value={from}
                                        onValueChange={setFrom}
                                        className="h-7 w-36 text-xs"
                                    />
                                    <label className="text-xs text-muted-foreground">To</label>
                                    <TallyDateInput
                                        value={to}
                                        onValueChange={setTo}
                                        className="h-7 w-36 text-xs"
                                    />
                                    <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={handleRefresh}>
                                        <RefreshCw size={12} className="mr-1" />
                                        Refresh
                                    </Button>
                                </div>
                            </div>

                            {/* Table */}
                            <div className="flex-1 overflow-auto">
                                {detail.transactions.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                                        <Box size={32} strokeWidth={1} />
                                        <p className="text-sm">No posted transactions in this period</p>
                                    </div>
                                ) : (
                                    <table className="w-full text-sm">
                                        <thead className="sticky top-0 z-10">
                                            <tr className="bg-muted/60 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                                                <th className="px-4 py-2 text-left font-medium">Type</th>
                                                <th className="px-4 py-2 text-left font-medium">Invoice / Ref</th>
                                                <th className="px-4 py-2 text-left font-medium">Party</th>
                                                <th className="px-4 py-2 text-left font-medium">Date</th>
                                                <th className="px-4 py-2 text-right font-medium">Quantity</th>
                                                <th className="px-4 py-2 text-right font-medium">Rate</th>
                                                <th className="px-4 py-2 text-center font-medium">Status</th>
                                                <th className="px-2 py-2 w-10"></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                            {detail.transactions.map((tx) => {
                                                // Edit URL — trading vouchers (SALE/PURCHASE/RETURNS) land on the
                                                // full-page editable form with ?voucherId=; other types fall back to
                                                // their read-only detail. See editFormUrl in VoucherActionsMenu.
                                                const url = editFormUrl(tx.type, tx.voucherId);
                                                // Party link — only customer/supplier party types map to a Person
                                                // record under /office/customers/all?personId=. Account-type and
                                                // walk-in (null) parties render as plain text.
                                                const partyHref = tx.partyId != null
                                                    && (tx.partyType === "customer" || tx.partyType === "supplier")
                                                    ? `/office/customers/all?personId=${tx.partyId}`
                                                    : null;
                                                const typeClass = TYPE_COLORS[tx.type] ?? "bg-muted text-muted-foreground";
                                                const statusClass = STATUS_COLORS[tx.paymentStatus] ?? "bg-muted text-muted-foreground";
                                                return (
                                                    <tr key={tx.lineId} className="hover:bg-muted/40 transition-colors">
                                                        <td className="px-4 py-2.5">
                                                            <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${typeClass}`}>
                                                                {typeLabel(tx.type)}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-2.5">
                                                            {url ? (
                                                                <Link
                                                                    href={url}
                                                                    className="font-mono text-xs text-primary hover:underline"
                                                                >
                                                                    {tx.reference}
                                                                </Link>
                                                            ) : (
                                                                <span className="font-mono text-xs text-muted-foreground">{tx.reference}</span>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-2.5 text-sm">
                                                            {tx.partyName == null ? (
                                                                <span className="text-muted-foreground">—</span>
                                                            ) : partyHref ? (
                                                                <Link href={partyHref} className="text-primary hover:underline">
                                                                    {tx.partyName}
                                                                </Link>
                                                            ) : (
                                                                <span className="text-muted-foreground">{tx.partyName}</span>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                                                            {formatDate(tx.date)}
                                                        </td>
                                                        <td className="px-4 py-2.5 text-right font-mono text-xs">
                                                            {tx.quantity} {tx.unitCode}
                                                        </td>
                                                        <td className="px-4 py-2.5 text-right font-mono text-xs">
                                                            {fmt(tx.rate)}
                                                        </td>
                                                        <td className="px-4 py-2.5 text-center">
                                                            {tx.paymentStatus === "N/A" ? (
                                                                <span className="text-xs text-muted-foreground">—</span>
                                                            ) : (
                                                                <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${statusClass}`}>
                                                                    {tx.paymentStatus === "PAID"
                                                                        ? "Paid"
                                                                        : tx.paymentStatus === "PARTIAL"
                                                                            ? "Partial"
                                                                            : "Unpaid"}
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="px-2 py-2 text-right">
                                                            <VoucherActionsMenu
                                                                voucherId={tx.voucherId}
                                                                voucherType={tx.type}
                                                                voucherRef={tx.reference}
                                                                onChanged={handleRefresh}
                                                            />
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </section>
            </div>

            <InvProductDialog
                open={editOpen}
                onOpenChange={setEditOpen}
                editId={selectedId}
                onSaved={handleRefresh}
            />
        </div>
    );
}

// ── StatBox helper ────────────────────────────────────────────────────────────

function StatBox({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
    return (
        <div className={cn(
            "rounded-lg border px-3 py-2.5",
            alert ? "border-amber-300 bg-amber-50 dark:bg-amber-950/20" : "border-border bg-background",
        )}>
            <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
            <p className={cn("text-sm font-semibold font-mono", alert && "text-amber-700 dark:text-amber-400")}>
                {value}
                {alert && <AlertTriangle size={12} className="inline ml-1" />}
            </p>
        </div>
    );
}
