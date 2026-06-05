"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import axios from "axios";
import Image from "next/image";
import Link from "next/link";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import type { ShopProductAdmin } from "@/modules/ecommerce/lib/productAdmin";
import { shopQualification } from "@/modules/ecommerce/lib/shopQualification";
import ProductForm from "@/modules/ecommerce/components/ProductForm";
import { PaginationBar } from "@/shared/components/PaginationBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    CheckCircle2,
    CircleDashed,
    Search,
    AlertCircle,
    Filter,
    ChevronRight,
    X,
} from "lucide-react";

// Sticky-header scroll frame (costing-page pattern): a plain overflow-auto div,
// with the shadcn Table's own container overflow overridden so the header stays
// put while the body scrolls — no right-side gutter.
const SCROLL_FRAME =
    "min-h-0 flex-1 overflow-auto rounded-lg border [&>[data-slot=table-container]]:overflow-x-visible";
const STICKY_HEAD =
    "sticky top-0 z-20 bg-muted/60 backdrop-blur [&_th]:bg-transparent [&_th]:shadow-[inset_0_-1px_0_var(--border)]";

const COL_COUNT = 9;
const PAGE_SIZE = 25;

type TabKey = "all" | "published" | "pending";
type StockFilter = "all" | "in" | "out" | "untracked";
type ActiveFilter = "all" | "active" | "inactive";
type StatusFilter = "all" | "live" | "ready" | "needs";

type ProductStatus = { kind: "live" | "ready" | "draft"; missing: string[] };

/** Per-row shop status, reusing the same qualification gate the server enforces. */
function productStatus(p: ShopProductAdmin): ProductStatus {
    const shopPricePaise = p.barcodePricePaise ?? p.pricePaise;
    const q = shopQualification({
        pricePaise: shopPricePaise,
        imageUrl: p.imageUrl,
        galleryUrls: p.galleryUrls,
        description: p.description,
    });
    if (p.isListedInShop && q.qualified) return { kind: "live", missing: [] };
    return { kind: q.qualified ? "ready" : "draft", missing: q.missing };
}

function StatusBadge({ status }: { status: ProductStatus }) {
    if (status.kind === "live") {
        return (
            <Badge variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700">
                <CheckCircle2 className="size-3" /> Live
            </Badge>
        );
    }
    if (status.kind === "ready") {
        return (
            <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 text-amber-700">
                <CircleDashed className="size-3" /> Ready
            </Badge>
        );
    }
    return (
        <Badge variant="outline" className="gap-1 border-border bg-muted/40 text-muted-foreground">
            <AlertCircle className="size-3" /> Needs info
        </Badge>
    );
}

export default function EcommerceProductsPage() {
    const [products, setProducts] = useState<ShopProductAdmin[]>([]);
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState<TabKey>("all");
    const [query, setQuery] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(PAGE_SIZE);
    const [expanded, setExpanded] = useState<Set<number>>(new Set());

    // Filter panel
    const [showFilters, setShowFilters] = useState(false);
    const [categoryFilter, setCategoryFilter] = useState("all");
    const [brandFilter, setBrandFilter] = useState("all");
    const [groupFilter, setGroupFilter] = useState("all");
    const [stockFilter, setStockFilter] = useState<StockFilter>("all");
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
    const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");

    const load = () => {
        axios
            .get<ShopProductAdmin[]>("/api/ecommerce/products")
            .then((r) => setProducts(r.data))
            .catch(() => setProducts([]));
    };

    useEffect(() => {
        load();
    }, []);

    const categories = useMemo(
        () => [...new Set(products.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
        [products]
    );
    const brands = useMemo(
        () => [...new Set(products.map((p) => p.brandName).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b)),
        [products]
    );
    const groups = useMemo(
        () => [...new Set(products.map((p) => p.groupName).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b)),
        [products]
    );

    const counts = useMemo(() => {
        let published = 0;
        for (const p of products) if (p.isListedInShop) published++;
        return { all: products.length, published, pending: products.length - published };
    }, [products]);

    const activeFilterCount =
        (categoryFilter !== "all" ? 1 : 0) +
        (brandFilter !== "all" ? 1 : 0) +
        (groupFilter !== "all" ? 1 : 0) +
        (stockFilter !== "all" ? 1 : 0) +
        (statusFilter !== "all" ? 1 : 0) +
        (activeFilter !== "all" ? 1 : 0);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return products.filter((p) => {
            if (tab === "published" && !p.isListedInShop) return false;
            if (tab === "pending" && p.isListedInShop) return false;
            if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
            if (brandFilter !== "all" && p.brandName !== brandFilter) return false;
            if (groupFilter !== "all" && p.groupName !== groupFilter) return false;
            if (stockFilter === "untracked" && p.stock !== null) return false;
            if (stockFilter === "in" && !(p.stock !== null && p.stock > 0)) return false;
            if (stockFilter === "out" && p.stock !== 0) return false;
            if (activeFilter === "active" && !p.isActive) return false;
            if (activeFilter === "inactive" && p.isActive) return false;
            if (statusFilter !== "all") {
                const k = productStatus(p).kind;
                if (statusFilter === "needs" ? k !== "draft" : k !== statusFilter) return false;
            }
            if (q && !`${p.name} ${p.sku} ${p.category} ${p.brandName ?? ""} ${p.groupName ?? ""}`.toLowerCase().includes(q))
                return false;
            return true;
        });
    }, [products, tab, query, categoryFilter, brandFilter, groupFilter, stockFilter, statusFilter, activeFilter]);

    useEffect(() => {
        setPage(1);
    }, [tab, query, categoryFilter, brandFilter, groupFilter, stockFilter, statusFilter, activeFilter]);

    const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

    const toggleExpand = (id: number) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const clearFilters = () => {
        setCategoryFilter("all");
        setBrandFilter("all");
        setGroupFilter("all");
        setStockFilter("all");
        setStatusFilter("all");
        setActiveFilter("all");
    };

    const tabs: { key: TabKey; label: string; count: number }[] = [
        { key: "all", label: "All", count: counts.all },
        { key: "published", label: "Published", count: counts.published },
        { key: "pending", label: "Pending", count: counts.pending },
    ];

    return (
        <div className="flex h-full flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
                    <p className="text-muted-foreground text-sm">
                        One catalogue across shop, POS and Sale vouchers. Publish a product once it’s shop-ready.
                    </p>
                </div>
                <Dialog open={open} onOpenChange={setOpen}>
                    <DialogTrigger asChild>
                        <Button type="button">Add product</Button>
                    </DialogTrigger>
                    <DialogContent className="max-h-[90vh] w-full max-w-2xl overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle>New product</DialogTitle>
                        </DialogHeader>
                        <div className="mt-4">
                            <ProductForm
                                submitLabel="Create product"
                                onSaved={() => {
                                    setOpen(false);
                                    load();
                                }}
                            />
                        </div>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Tabs + search + filter button */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5">
                    {tabs.map((t) => (
                        <button
                            key={t.key}
                            type="button"
                            onClick={() => setTab(t.key)}
                            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                                tab === t.key
                                    ? "bg-background text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            {t.label}
                            <span
                                className={`rounded-full px-1.5 py-0.5 text-xs tabular-nums ${
                                    tab === t.key ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                                }`}
                            >
                                {t.count}
                            </span>
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                    <div className="relative w-full sm:w-64">
                        <Search className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
                        <Input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search name, SKU, brand…"
                            className="pl-8"
                        />
                    </div>
                    <Button
                        type="button"
                        variant={showFilters || activeFilterCount > 0 ? "secondary" : "outline"}
                        onClick={() => setShowFilters((s) => !s)}
                        className="gap-2"
                    >
                        <Filter className="size-4" />
                        Filters
                        {activeFilterCount > 0 ? (
                            <span className="bg-primary text-primary-foreground rounded-full px-1.5 text-xs tabular-nums">
                                {activeFilterCount}
                            </span>
                        ) : null}
                    </Button>
                </div>
            </div>

            {/* Expandable filter panel */}
            {showFilters ? (
                <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/20 p-3">
                    <FilterSelect label="Category" value={categoryFilter} onChange={setCategoryFilter} allLabel="All categories" options={categories} />
                    <FilterSelect label="Brand" value={brandFilter} onChange={setBrandFilter} allLabel="All brands" options={brands} />
                    <FilterSelect label="Group" value={groupFilter} onChange={setGroupFilter} allLabel="All groups" options={groups} />
                    <div className="grid gap-1.5">
                        <label className="text-muted-foreground text-xs">Shop status</label>
                        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                            <SelectTrigger className="h-8 w-36 text-sm"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Any status</SelectItem>
                                <SelectItem value="live">Live</SelectItem>
                                <SelectItem value="ready">Ready to publish</SelectItem>
                                <SelectItem value="needs">Needs info</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid gap-1.5">
                        <label className="text-muted-foreground text-xs">Stock</label>
                        <Select value={stockFilter} onValueChange={(v) => setStockFilter(v as StockFilter)}>
                            <SelectTrigger className="h-8 w-36 text-sm"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Any stock</SelectItem>
                                <SelectItem value="in">In stock</SelectItem>
                                <SelectItem value="out">Out of stock</SelectItem>
                                <SelectItem value="untracked">Untracked</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid gap-1.5">
                        <label className="text-muted-foreground text-xs">Active</label>
                        <Select value={activeFilter} onValueChange={(v) => setActiveFilter(v as ActiveFilter)}>
                            <SelectTrigger className="h-8 w-32 text-sm"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All</SelectItem>
                                <SelectItem value="active">Active only</SelectItem>
                                <SelectItem value="inactive">Inactive only</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {activeFilterCount > 0 ? (
                        <Button type="button" variant="ghost" size="sm" onClick={clearFilters} className="gap-1">
                            <X className="size-3.5" /> Clear
                        </Button>
                    ) : null}
                </div>
            ) : null}

            {/* Scrollable table — fills remaining height, header pinned */}
            <div className={SCROLL_FRAME}>
                <Table>
                    <TableHeader className={STICKY_HEAD}>
                        <TableRow>
                            <TableHead className="w-8" />
                            <TableHead className="w-12" />
                            <TableHead>Name</TableHead>
                            <TableHead className="w-32">Brand</TableHead>
                            <TableHead className="w-32">Group</TableHead>
                            <TableHead className="w-32">Shop status</TableHead>
                            <TableHead className="w-28 text-right">Shop price</TableHead>
                            <TableHead className="w-20 text-right">Stock</TableHead>
                            <TableHead className="w-16" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {pageRows.map((p) => {
                            const status = productStatus(p);
                            const shopPricePaise = p.barcodePricePaise ?? p.pricePaise;
                            const img = p.galleryUrls[0] ?? p.imageUrl;
                            const isOpen = expanded.has(p.id);
                            return (
                                <Fragment key={p.id}>
                                    <TableRow
                                        className="cursor-pointer"
                                        aria-expanded={isOpen}
                                        onClick={() => toggleExpand(p.id)}
                                    >
                                        <TableCell className="text-muted-foreground">
                                            <ChevronRight
                                                className={`size-4 transition-transform ${isOpen ? "rotate-90" : ""}`}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <div className="relative size-9 overflow-hidden rounded-md border bg-muted">
                                                {img ? (
                                                    <Image src={img} alt="" fill className="object-cover" sizes="36px" unoptimized />
                                                ) : null}
                                            </div>
                                        </TableCell>
                                        <TableCell className="max-w-0">
                                            <div className="truncate font-medium">{p.name}</div>
                                            <div className="text-muted-foreground truncate text-xs">
                                                <span className="font-mono">{p.sku}</span>
                                                {!p.isActive ? " · inactive" : ""}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-muted-foreground max-w-[8rem] truncate text-sm">
                                            {p.brandName ?? "—"}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground max-w-[8rem] truncate text-sm">
                                            {p.groupName ?? "—"}
                                        </TableCell>
                                        <TableCell>
                                            <StatusBadge status={status} />
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">
                                            {shopPricePaise ? formatRupeesFromPaise(shopPricePaise) : "—"}
                                        </TableCell>
                                        <TableCell className="text-right text-sm tabular-nums">
                                            {p.stock === null ? "—" : p.stock}
                                        </TableCell>
                                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                                            <Button variant="outline" size="sm" asChild>
                                                <Link href={`/office/ecommerce/products/${p.id}`}>Edit</Link>
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                    {isOpen ? (
                                        <TableRow className="hover:bg-transparent">
                                            <TableCell colSpan={COL_COUNT} className="bg-muted/20 whitespace-normal">
                                                <div className="grid gap-4 px-4 py-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                                                    <Detail label="SKU" value={<span className="font-mono">{p.sku}</span>} />
                                                    <Detail label="Category" value={p.category} />
                                                    <Detail label="Brand" value={p.brandName ?? "—"} />
                                                    <Detail label="Group" value={p.groupName ?? "—"} />
                                                    <Detail
                                                        label="Shop price (barcode)"
                                                        value={p.barcodePricePaise != null ? formatRupeesFromPaise(p.barcodePricePaise) : "— (uses effective)"}
                                                    />
                                                    <Detail
                                                        label="Effective / MRP"
                                                        value={`${formatRupeesFromPaise(p.pricePaise)}${p.mrpPaise ? " / " + formatRupeesFromPaise(p.mrpPaise) : ""}`}
                                                    />
                                                    <Detail
                                                        label="Stock"
                                                        value={p.stock === null ? "Untracked" : `${p.stock} (low ≤ ${p.lowStockThreshold})`}
                                                    />
                                                    <Detail
                                                        label="Shop status"
                                                        value={
                                                            status.kind === "live"
                                                                ? "Live on storefront"
                                                                : status.kind === "ready"
                                                                  ? "Ready — flip the listing switch to publish"
                                                                  : `Needs ${status.missing.join(", ").toLowerCase()}`
                                                        }
                                                    />
                                                    <div className="sm:col-span-2 lg:col-span-4">
                                                        <p className="text-muted-foreground text-xs">Description</p>
                                                        <p className="mt-0.5 line-clamp-2">
                                                            {p.description?.trim() || <span className="text-muted-foreground italic">No description yet.</span>}
                                                        </p>
                                                    </div>
                                                    <div className="sm:col-span-2 lg:col-span-4">
                                                        <Button variant="outline" size="sm" asChild>
                                                            <Link href={`/office/ecommerce/products/${p.id}`}>Edit product</Link>
                                                        </Button>
                                                    </div>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : null}
                                </Fragment>
                            );
                        })}
                    </TableBody>
                </Table>
                {filtered.length === 0 ? (
                    <p className="text-muted-foreground p-8 text-center text-sm">
                        {query.trim() || activeFilterCount > 0
                            ? "No products match your filters."
                            : tab === "published"
                              ? "No products are published to the shop yet."
                              : tab === "pending"
                                ? "Nothing pending — every product is published."
                                : "No products."}
                    </p>
                ) : null}
            </div>

            {filtered.length > 0 ? (
                <PaginationBar
                    total={filtered.length}
                    page={page}
                    pageSize={pageSize}
                    onPageChange={setPage}
                    onPageSizeChange={setPageSize}
                    unitLabel="product"
                />
            ) : null}
        </div>
    );
}

function FilterSelect({
    label,
    value,
    onChange,
    allLabel,
    options,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    allLabel: string;
    options: string[];
}) {
    return (
        <div className="grid gap-1.5">
            <label className="text-muted-foreground text-xs">{label}</label>
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger className="h-8 w-40 text-sm">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">{allLabel}</SelectItem>
                    {options.map((o) => (
                        <SelectItem key={o} value={o}>
                            {o}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div>
            <p className="text-muted-foreground text-xs">{label}</p>
            <p className="mt-0.5">{value}</p>
        </div>
    );
}
