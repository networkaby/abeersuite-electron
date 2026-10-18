"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Camera, Search, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { extractApiError } from "@/shared/lib/api";
import { cloudinaryThumb } from "@/shared/lib/cloudinaryImage";
import { AI_BULK_BATCH_SIZE, type AiSearchMode } from "@/shared/lib/constants/ai";
import { useDebouncedValue } from "@/shared/hooks/useDebouncedValue";
import { runPool } from "@/shared/lib/runPool";
import { isAiSkipped, photosForAi } from "@/shared/lib/shop/photoMark";
import type { ShopProductAdmin } from "@/modules/ecommerce/lib/productAdmin";
import { DEFAULT_SHOP_PUBLISH_RULES } from "@/modules/ecommerce/lib/shopQualification";
import {
    EMPTY_PRODUCT_FILTERS,
    hasDescription,
    matchesProductFilters,
    productFilterOptions,
    type ProductFilters,
} from "@/modules/ecommerce/lib/productFilters";
import {
    cachedAdminProducts,
    fetchAdminProducts,
    patchCachedAdminProduct,
    takeAiPick,
} from "@/modules/ecommerce/lib/productListCache";
import { ProductFilterButton, ProductFilterPanel } from "@/modules/ecommerce/components/ProductFilterPanel";
import { fetchAiCopy, logAiPick, type AiVersion, type ProductCopy } from "@/modules/ecommerce/lib/aiCopyClient";
import { AiDraftNotes, mergeAiSpecs } from "@/modules/ecommerce/components/AiCopyPanel";
import { AbCompare, SearchModeButtons } from "@/modules/ecommerce/components/AiAbCompare";
import AiTestLog from "@/modules/ecommerce/components/AiTestLog";

// Bulk AI copy for products with no shop description (the one-time backlog,
// then each month's new items). Same filters as Products so staff pick what
// pays back first (in stock, with photos, one brand at a time). Runs
// AI_BULK_BATCH_SIZE at once, keeps each draft on screen, and writes nothing
// until staff press Save on a row or Save all.

// Start where a draft is best and sells soonest; Clear goes back to this.
const AI_DEFAULT_FILTERS: ProductFilters = { ...EMPTY_PRODUCT_FILTERS, active: "active", photos: "has" };
const SHOW_STEP = 50;
const STRIP_MAX = 8;
const SAVE_POOL = 4;

type Work = { draft?: ProductCopy; error?: string; saved?: boolean };

/** In stock first, then more photos (a better draft), then name. */
function priority(a: ShopProductAdmin, b: ShopProductAdmin) {
    const stocked = (p: ShopProductAdmin) => (p.stock !== null && p.stock > 0 ? 1 : 0);
    return stocked(b) - stocked(a) || b.galleryUrls.length - a.galleryUrls.length || a.name.localeCompare(b.name);
}

export default function AiBulkCopyPage() {
    const [products, setProducts] = useState<ShopProductAdmin[]>(() => cachedAdminProducts() ?? []);
    const [loading, setLoading] = useState(products.length === 0);
    const [work, setWork] = useState<Record<number, Work>>({});
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [pick, setPick] = useState<Set<number> | null>(null);
    const [filters, setFilters] = useState<ProductFilters>(AI_DEFAULT_FILTERS);
    const [showFilters, setShowFilters] = useState(false);
    const [shown, setShown] = useState(SHOW_STEP);
    const [search, setSearch] = useState<AiSearchMode>("off"); // off by default — see AiCopyPanel
    const [showLog, setShowLog] = useState(false);
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState({ done: 0, of: 0 });

    useEffect(() => {
        const ids = takeAiPick();
        if (ids?.length) {
            setPick(new Set(ids));
            setSelected(new Set(ids));
            setFilters(EMPTY_PRODUCT_FILTERS);
        }
        fetchAdminProducts()
            .then(setProducts)
            .catch((e) => toast.error(extractApiError(e, "Could not load products")))
            .finally(() => setLoading(false));
    }, []);

    const query = useDebouncedValue(filters.query, 250);
    const options = useMemo(() => productFilterOptions(products), [products]);
    // Rows saved this session stay on screen (faded) instead of vanishing.
    const rows = useMemo(() => {
        const f = { ...filters, query };
        return products
            .filter((p) => (pick ? pick.has(p.id) : !hasDescription(p) || work[p.id]?.saved))
            .filter((p) => matchesProductFilters(p, f, DEFAULT_SHOP_PUBLISH_RULES))
            .sort(priority);
    }, [products, pick, filters, query, work]);
    const backlog = useMemo(() => products.filter((p) => p.isActive && !hasDescription(p)).length, [products]);
    const withPhoto = useMemo(() => products.filter((p) => p.isActive && !hasDescription(p) && p.galleryUrls.length > 0).length, [products]);

    useEffect(() => setShown(SHOW_STEP), [filters, query, pick]);

    const patchWork = (id: number, patch: Work) =>
        setWork((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

    const generate = async () => {
        // A row that already has a draft costs nothing to keep — only write the rest.
        const todo = rows.filter((r) => selected.has(r.id) && !work[r.id]?.saved && !work[r.id]?.draft);
        if (!todo.length) { toast.error("Tick the products to write"); return; }
        setRunning(true);
        setProgress({ done: 0, of: todo.length });
        // 503 = the key itself is out (credit / limit / not set up) — every
        // further product would fail the same way, so stop and say why once.
        let stopped: string | null = null;
        // Each product is still its own call with all its photos (quality); a
        // free slot starts the next product at once (speed).
        await runPool(todo, AI_BULK_BATCH_SIZE, async (r) => {
            try {
                const draft = await fetchAiCopy({ productId: r.id, search });
                patchWork(r.id, { draft, error: undefined });
            } catch (e) {
                const msg = extractApiError(e, "AI failed");
                if (axios.isAxiosError(e) && e.response?.status === 503) stopped = msg;
                patchWork(r.id, { error: msg });
            } finally {
                setProgress((p) => ({ ...p, done: p.done + 1 }));
            }
            return !stopped;
        });
        setRunning(false);
        if (stopped) toast.error(`Stopped: ${stopped}`);
    };

    // `version` = the A/B pick; a single-version draft saves itself.
    const save = async (r: ShopProductAdmin, draft: AiVersion | undefined = work[r.id]?.draft): Promise<boolean> => {
        if (!draft) return false;
        const specs = Object.fromEntries(
            mergeAiSpecs(Object.entries(r.specs).map(([k, v]) => ({ k, v })), draft.specs)
                .filter((x) => x.k.trim())
                .map((x) => [x.k, x.v]),
        );
        try {
            const { data } = await axios.patch<ShopProductAdmin>(`/api/ecommerce/products/${r.id}`, {
                shopDescription: draft.shopDescription,
                // Staff-typed online name wins; the AI's SEO title fills a blank
                // one, or one that is only a copy of the stock name.
                ...(r.subheading?.trim() && r.subheading.trim() !== r.name.trim() ? {} : { shopSubheading: draft.title }),
                specs,
            });
            patchWork(r.id, { saved: true, error: undefined });
            setProducts((prev) => prev.map((x) => (x.id === data.id ? data : x)));
            patchCachedAdminProduct(data);
            setSelected((s) => { const n = new Set(s); n.delete(r.id); return n; });
            return true;
        } catch (e) {
            patchWork(r.id, { error: extractApiError(e, "Save failed") });
            return false;
        }
    };

    const saveAll = async () => {
        // Two-version rows wait for staff to keep one.
        const ready = rows.filter((r) => work[r.id]?.draft && !work[r.id]?.draft?.photoOnly && !work[r.id]?.saved);
        let ok = 0;
        await runPool(ready, SAVE_POOL, async (r) => { if (await save(r)) ok++; });
        if (ok) toast.success(`Saved ${ok} product${ok === 1 ? "" : "s"}`);
        if (ok < ready.length) toast.error(`${ready.length - ok} could not be saved — see the row`);
    };

    const visible = rows.slice(0, shown);
    const open = rows.filter((r) => !work[r.id]?.saved);
    const allTicked = open.length > 0 && open.every((r) => selected.has(r.id));
    const draftsReady = rows.filter((r) => work[r.id]?.draft && !work[r.id]?.draft?.photoOnly && !work[r.id]?.saved).length;
    const toggle = (id: number, on: boolean) => setSelected((s) => {
        const n = new Set(s);
        if (on) n.add(id); else n.delete(id);
        return n;
    });

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <Link href="/office/ecommerce/products" className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline">
                        <ArrowLeft className="size-4" /> Products
                    </Link>
                    <h1 className="text-2xl font-semibold tracking-tight">Write descriptions with AI</h1>
                    <p className="text-muted-foreground text-sm">
                        {loading && products.length === 0
                            ? "Loading…"
                            : `${backlog} active product${backlog === 1 ? "" : "s"} have no description · ${withPhoto} with photos. Tick, generate, check the draft, then save.`}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <SearchModeButtons value={search} onChange={setSearch} disabled={running} />
                    <Button onClick={() => void generate()} disabled={running || selected.size === 0}>
                        <Sparkles className="size-4" />
                        {running ? `Writing ${progress.done}/${progress.of}…` : `Generate ${selected.size || ""}`.trim()}
                    </Button>
                    <Button variant="outline" onClick={() => void saveAll()} disabled={running || draftsReady === 0}>
                        Save all drafts ({draftsReady})
                    </Button>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full sm:w-72">
                    <Search className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
                    <Input
                        value={filters.query}
                        onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
                        placeholder="Search name, SKU, brand…"
                        className="pl-8"
                    />
                </div>
                <ProductFilterButton
                    open={showFilters}
                    filters={filters}
                    defaults={pick ? EMPTY_PRODUCT_FILTERS : AI_DEFAULT_FILTERS}
                    onToggle={() => setShowFilters((s) => !s)}
                />
                <span className="text-muted-foreground text-sm">{rows.length} shown</span>
            </div>
            {showFilters && (
                <ProductFilterPanel
                    value={filters}
                    onChange={setFilters}
                    options={options}
                    hide={pick ? [] : ["description"]}
                    defaults={pick ? EMPTY_PRODUCT_FILTERS : AI_DEFAULT_FILTERS}
                />
            )}
            {pick && (
                <div className="border-primary/30 bg-primary/5 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                    Showing the {pick.size} you ticked on Products. Saving replaces any description they already have.
                    <Button size="sm" variant="ghost" onClick={() => { setPick(null); setSelected(new Set()); setFilters(AI_DEFAULT_FILTERS); }}>
                        Show all without a description
                    </Button>
                </div>
            )}

            <label className="flex items-center gap-2 text-sm">
                <Checkbox
                    checked={allTicked}
                    onCheckedChange={(v) => setSelected(v ? new Set(open.map((r) => r.id)) : new Set())}
                />
                Tick all shown ({open.length})
            </label>

            <div className="divide-y divide-border rounded-md border border-border">
                {visible.map((r) => {
                    const w = work[r.id] ?? {};
                    const photos = r.galleryUrls;
                    const forAi = photosForAi(photos).length;
                    return (
                        <div key={r.id} className={`flex gap-3 p-3 ${w.saved ? "opacity-50" : ""}`}>
                            <Checkbox
                                className="mt-1"
                                disabled={w.saved}
                                checked={selected.has(r.id)}
                                onCheckedChange={(v) => toggle(r.id, !!v)}
                            />
                            <div className="min-w-0 flex-1 space-y-1 text-sm">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div className="min-w-0 space-y-1">
                                        <Link href={`/office/ecommerce/products/${r.id}`} className="font-medium hover:underline">
                                            {r.name}
                                        </Link>
                                        <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
                                            <span className="font-mono">{r.sku}</span>
                                            {r.brandName && <Badge variant="outline">{r.brandName}</Badge>}
                                            <Badge variant="outline" className={r.stock !== null && r.stock > 0 ? "border-emerald-200 text-emerald-700" : ""}>
                                                {r.stock === null ? "Stock untracked" : `Stock ${r.stock}`}
                                            </Badge>
                                            <Badge variant="outline" className="gap-1">
                                                <Camera className="size-3" />
                                                {photos.length === 0
                                                    ? "No photo — AI works from the name only"
                                                    : `${photos.length} photo${photos.length === 1 ? "" : "s"}${forAi < photos.length ? ` · AI uses ${forAi}` : ""}`}
                                            </Badge>
                                        </div>
                                    </div>
                                    {photos.length > 0 && (
                                        <div className="flex flex-wrap justify-end gap-1">
                                            {photos.slice(0, STRIP_MAX).map((u) => (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img
                                                    key={u}
                                                    src={cloudinaryThumb(u, 96)}
                                                    alt=""
                                                    loading="lazy"
                                                    title={isAiSkipped(u) ? "Skip for AI — not sent" : undefined}
                                                    className={`size-12 rounded border object-cover ${isAiSkipped(u) ? "opacity-30 grayscale" : ""}`}
                                                />
                                            ))}
                                            {photos.length > STRIP_MAX && (
                                                <span className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded border text-xs">
                                                    +{photos.length - STRIP_MAX}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                                {w.error && <p className="text-destructive text-xs">{w.error}</p>}
                                {w.saved && <p className="text-xs text-green-600">Saved</p>}
                                {w.draft?.photoOnly && !w.saved && (
                                    <AbCompare
                                        draft={w.draft}
                                        pickLabel="Save this"
                                        onPick={(which, v) => {
                                            logAiPick(r.id, r.name, which, w.draft!);
                                            void save(r, v);
                                        }}
                                    />
                                )}
                                {w.draft && !w.draft.photoOnly && !w.saved && (
                                    <div className="bg-muted/40 space-y-1 rounded-md p-2">
                                        <p className="font-medium">{w.draft.title}</p>
                                        <p className="whitespace-pre-line">{w.draft.shopDescription}</p>
                                        {Object.keys(w.draft.specs).length > 0 && (
                                            <p className="text-muted-foreground text-xs">
                                                {Object.entries(w.draft.specs).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                                            </p>
                                        )}
                                        {w.draft.sources.length > 0 && (
                                            <p className="text-xs">
                                                {w.draft.sources.slice(0, 3).map((s) => (
                                                    <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="text-primary mr-3 hover:underline">
                                                        {s.title}
                                                    </a>
                                                ))}
                                            </p>
                                        )}
                                        <AiDraftNotes draft={w.draft} />
                                        <Button size="sm" onClick={() => { logAiPick(r.id, r.name, "only", w.draft!); void save(r); }}>Save</Button>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
                {!loading && rows.length === 0 && (
                    <p className="text-muted-foreground p-6 text-center text-sm">
                        {backlog === 0 ? "Every active product has a description." : "No products match these filters."}
                    </p>
                )}
            </div>
            {rows.length > shown && (
                <Button variant="outline" onClick={() => setShown((n) => n + SHOW_STEP)}>
                    Show more ({rows.length - shown} left)
                </Button>
            )}
            <div className="border-t border-border pt-3">
                <Button variant="ghost" size="sm" onClick={() => setShowLog((v) => !v)}>
                    {showLog ? "Hide" : "Show"} search test log
                </Button>
                {showLog && <AiTestLog />}
            </div>
        </div>
    );
}
