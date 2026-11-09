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
import { AI_BULK_BATCH_SIZE } from "@/shared/lib/constants/ai";
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
import { fetchAiCopy, type ProductCopy } from "@/modules/ecommerce/lib/aiCopyClient";
import { AiDraftNotes, mergeAiSpecs } from "@/modules/ecommerce/components/AiCopyPanel";
import { FlowButtons, PremiumSwitch, useCopyFlow, usePremiumAi } from "@/modules/ecommerce/components/AiCopyControls";
import { useValueChange } from "@/shared/hooks/useValueChange";

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

type Work = { draft?: ProductCopy; error?: string; saved?: boolean; discarded?: boolean; writing?: boolean };

const resolved = (w: Work | undefined) => !!(w?.saved || w?.discarded);

/** What Save will change — the online name only fills a blank (or stock-name copy), specs only add missing labels. */
function changeNote(p: ShopProductAdmin, d: ProductCopy) {
    const nameKept = !!p.subheading?.trim() && p.subheading.trim() !== p.name.trim();
    const have = new Set(Object.keys(p.specs).map((k) => k.trim().toLowerCase()));
    const newSpecs = Object.entries(d.specs).filter(([k, v]) => k.trim() && v.trim() && !have.has(k.trim().toLowerCase())).length;
    return `Display name: ${nameKept ? "kept (yours)" : "will be set"} · Specs: ${newSpecs ? `+${newSpecs} new` : "no new"}`;
}

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
    const [flow, setFlow] = useCopyFlow();
    const [premium, setPremium] = usePremiumAi();
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState({ done: 0, of: 0 });
    // The set sent by the last Generate: only these show (in tick order, no
    // rows in between) and the list stays locked until each is saved or dropped.
    const [batch, setBatch] = useState<number[] | null>(null);

    useEffect(() => {
        const ids = takeAiPick();
        if (ids?.length) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- the AI pick is a one-shot stash consumed (removed) here, once after mount (a render-time read would consume it twice in StrictMode)
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
    const rows = useMemo(() => {
        if (batch) {
            const byId = new Map(products.map((p) => [p.id, p]));
            return batch.map((id) => byId.get(id)).filter((p): p is ShopProductAdmin => !!p);
        }
        const f = { ...filters, query };
        return products
            .filter((p) => (pick ? pick.has(p.id) && !work[p.id]?.saved : !hasDescription(p) && p.shopStatus !== "DRAFT"))
            .filter((p) => matchesProductFilters(p, f, DEFAULT_SHOP_PUBLISH_RULES))
            .sort(priority);
    }, [products, pick, filters, query, work, batch]);
    const backlog = useMemo(() => products.filter((p) => p.isActive && !hasDescription(p) && p.shopStatus !== "DRAFT").length, [products]);
    const withPhoto = useMemo(() => products.filter((p) => p.isActive && !hasDescription(p) && p.shopStatus !== "DRAFT" && p.galleryUrls.length > 0).length, [products]);

    // A new filter / search / pick starts from the first batch again (while rendering).
    if ([useValueChange(filters), useValueChange(query), useValueChange(pick)].some(Boolean)) setShown(SHOW_STEP);

    const patchWork = (id: number, patch: Work) =>
        setWork((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

    /** One AI call; the message when the key itself is out (503), so the caller can stop. */
    const writeOne = async (r: ShopProductAdmin): Promise<string | null> => {
        patchWork(r.id, { writing: true, error: undefined });
        try {
            const draft = await fetchAiCopy({ productId: r.id, flow, bulk: true, premium });
            patchWork(r.id, { draft, writing: false });
            return null;
        } catch (e) {
            const msg = extractApiError(e, "AI failed");
            patchWork(r.id, { error: msg, writing: false });
            return axios.isAxiosError(e) && e.response?.status === 503 ? msg : null;
        }
    };

    const generate = async () => {
        const picked = rows.filter((r) => selected.has(r.id) && !work[r.id]?.saved);
        if (!picked.length) { toast.error("Tick the products to write"); return; }
        setBatch(picked.map((r) => r.id));
        setSelected(new Set());
        // A row that already has a draft costs nothing to keep — only write the rest.
        const todo = picked.filter((r) => !work[r.id]?.draft);
        setRunning(true);
        setProgress({ done: 0, of: todo.length });
        // 503 = the key itself is out (credit / limit / not set up) — every
        // further product would fail the same way, so stop and say why once.
        let stopped: string | null = null;
        // Each product is still its own call with all its photos (quality); a
        // free slot starts the next product at once (speed).
        await runPool(todo, AI_BULK_BATCH_SIZE, async (r) => {
            stopped = (await writeOne(r)) ?? stopped;
            setProgress((p) => ({ ...p, done: p.done + 1 }));
            return !stopped;
        });
        setRunning(false);
        if (stopped) toast.error(`Stopped: ${stopped}`);
    };

    const retry = async (r: ShopProductAdmin) => {
        const stopped = await writeOne(r);
        if (stopped) toast.error(stopped);
    };
    const discard = (ids: number[]) =>
        setWork((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, { ...prev[id], discarded: true }])) }));

    // Every row of the set saved or dropped → back to the list. Dropped rows
    // return to the backlog clean (their draft stays cached, so a retry is free).
    // Done while rendering (clearing the batch ends it); the toast follows in an effect.
    const [batchDone, setBatchDone] = useState<{ saved: number; dropped: number } | null>(null);
    if (batch && !running && batch.every((id) => resolved(work[id]))) {
        const saved = batch.filter((id) => work[id]?.saved).length;
        setBatchDone({ saved, dropped: batch.length - saved });
        setWork((prev) => {
            const next = { ...prev };
            for (const id of batch) if (!prev[id]?.saved) delete next[id];
            return next;
        });
        setBatch(null);
    }
    useEffect(() => {
        if (batchDone) toast.success(`Done: ${batchDone.saved} saved to draft, ${batchDone.dropped} not saved`);
    }, [batchDone]);

    const save = async (r: ShopProductAdmin): Promise<boolean> => {
        const draft = work[r.id]?.draft;
        if (!draft) return false;
        const specs = Object.fromEntries(
            mergeAiSpecs(Object.entries(r.specs).map(([k, v]) => ({ k, v })), draft.specs)
                .filter((x) => x.k.trim())
                .map((x) => [x.k, x.v]),
        );
        try {
            // Onto the product, which moves to Draft (off the shop) — staff finish it
            // with Save as ready on the product page.
            const { data } = await axios.patch<ShopProductAdmin>(`/api/ecommerce/products/${r.id}`, {
                draft: "save",
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
        const ready = rows.filter((r) => work[r.id]?.draft && !resolved(work[r.id]));
        let ok = 0;
        await runPool(ready, SAVE_POOL, async (r) => { if (await save(r)) ok++; });
        if (ok) toast.success(`Saved ${ok} product${ok === 1 ? "" : "s"} to draft — finish each with Save as ready`);
        if (ok < ready.length) toast.error(`${ready.length - ok} could not be saved — see the row`);
    };

    const visible = batch ? rows : rows.slice(0, shown);
    const open = rows.filter((r) => !work[r.id]?.saved);
    const locked = !!batch;
    const left = batch ? batch.filter((id) => !resolved(work[id])) : [];
    const allTicked = open.length > 0 && open.every((r) => selected.has(r.id));
    const draftsReady = rows.filter((r) => work[r.id]?.draft && !resolved(work[r.id])).length;
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
                    <PremiumSwitch value={premium} onChange={setPremium} disabled={locked} />
                    <FlowButtons value={flow} onChange={setFlow} disabled={locked} />
                    <Button onClick={() => void generate()} disabled={locked || selected.size === 0}>
                        <Sparkles className="size-4" />
                        {running ? `Writing ${progress.done}/${progress.of}…` : `Generate ${selected.size || ""}`.trim()}
                    </Button>
                    <Button variant="outline" onClick={() => void saveAll()} disabled={running || draftsReady === 0}>
                        Save all drafts ({draftsReady})
                    </Button>
                </div>
            </div>

            {batch && (
                <div className="border-primary/30 bg-primary/5 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm">
                    <span>
                        <b>{batch.length} in this set</b>
                        {" · "}{batch.filter((id) => work[id]?.saved).length} saved
                        {" · "}{batch.filter((id) => work[id]?.discarded).length} not saved
                        {" · "}{left.length} waiting
                    </span>
                    <span className="text-muted-foreground">Save or drop each one to get back to the list.</span>
                    <Button size="sm" variant="ghost" disabled={running} onClick={() => discard(left)}>
                        Discard the rest
                    </Button>
                </div>
            )}
            {/* One row: Tick all on the left, search + filters on the right. */}
            <div className={`flex flex-wrap items-center gap-2 ${locked ? "pointer-events-none opacity-50" : ""}`}>
                <label className="mr-auto flex items-center gap-2 text-sm">
                    <Checkbox
                        checked={allTicked}
                        disabled={locked}
                        onCheckedChange={(v) => setSelected(v ? new Set(open.map((r) => r.id)) : new Set())}
                    />
                    Tick all shown ({open.length})
                </label>
                <span className="text-muted-foreground text-sm">{rows.length} shown</span>
                <div className="relative w-full sm:w-72">
                    <Search className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
                    <Input
                        value={filters.query}
                        onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
                        placeholder="Search name, SKU, brand…"
                        className="pl-8"
                        disabled={locked}
                    />
                </div>
                <ProductFilterButton
                    open={showFilters}
                    filters={filters}
                    defaults={pick ? EMPTY_PRODUCT_FILTERS : AI_DEFAULT_FILTERS}
                    onToggle={() => setShowFilters((s) => !s)}
                />
            </div>
            {showFilters && !locked && (
                <ProductFilterPanel
                    value={filters}
                    onChange={setFilters}
                    options={options}
                    hide={pick ? [] : ["description"]}
                    defaults={pick ? EMPTY_PRODUCT_FILTERS : AI_DEFAULT_FILTERS}
                />
            )}
            {pick && !locked && (
                <div className="border-primary/30 bg-primary/5 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                    Showing the {pick.size} you ticked on Products. Saving replaces any description they already have.
                    <Button size="sm" variant="ghost" onClick={() => { setPick(null); setSelected(new Set()); setFilters(AI_DEFAULT_FILTERS); }}>
                        Show all without a description
                    </Button>
                </div>
            )}

            <div className="divide-y divide-border rounded-md border border-border">
                {visible.map((r) => {
                    const w = work[r.id] ?? {};
                    const photos = r.galleryUrls;
                    const forAi = photosForAi(photos).length;
                    return (
                        <div key={r.id} className={`flex gap-3 p-3 ${resolved(w) ? "opacity-50" : ""}`}>
                            {!locked && (
                                <Checkbox
                                    className="mt-1"
                                    checked={selected.has(r.id)}
                                    onCheckedChange={(v) => toggle(r.id, !!v)}
                                />
                            )}
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
                                {w.writing && <p className="text-muted-foreground text-xs">Writing…</p>}
                                {batch && !w.writing && !w.draft && !w.error && !resolved(w) && running && (
                                    <p className="text-muted-foreground text-xs">Waiting…</p>
                                )}
                                {batch && !w.writing && !w.draft && !resolved(w) && (w.error || !running) && (
                                    <div className="flex flex-wrap items-center gap-2">
                                        <p className={`text-xs ${w.error ? "text-destructive" : "text-muted-foreground"}`}>{w.error ?? "Not written — stopped"}</p>
                                        <Button size="sm" variant="outline" onClick={() => void retry(r)}>Try again</Button>
                                        <Button size="sm" variant="ghost" onClick={() => discard([r.id])}>Don&apos;t save</Button>
                                    </div>
                                )}
                                {w.error && w.draft && !resolved(w) && <p className="text-destructive text-xs">{w.error}</p>}
                                {w.saved && <p className="text-xs text-green-600">Saved to draft</p>}
                                {w.discarded && <p className="text-muted-foreground text-xs">Not saved</p>}
                                {w.draft && !resolved(w) && (
                                    <p className="text-xs font-medium text-blue-700 dark:text-blue-300">{changeNote(r, w.draft)}</p>
                                )}
                                {w.draft && !resolved(w) && (
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
                                        <div className="flex gap-2">
                                            <Button size="sm" onClick={() => void save(r)}>Save</Button>
                                            <Button size="sm" variant="ghost" onClick={() => discard([r.id])}>Don&apos;t save</Button>
                                        </div>
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
            {!batch && rows.length > shown && (
                <Button variant="outline" onClick={() => setShown((n) => n + SHOW_STEP)}>
                    Show more ({rows.length - shown} left)
                </Button>
            )}
        </div>
    );
}
