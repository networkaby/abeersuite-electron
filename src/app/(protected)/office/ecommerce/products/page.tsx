"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import axios from "axios";
import Image from "next/image";
import { imageLoaderFor, isCloudinaryUrl } from "@/shared/lib/cloudinaryImage";
import Link from "next/link";
import { LinkContextMenu, useLinkContextMenu } from "@/shared/components/LinkContextMenu";
import { useCanOpenPage } from "@/shared/hooks/useCanOpenPage";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { toast } from "sonner";
import { splitAttention, type RowProblem, type ShopProductAdmin } from "@/modules/ecommerce/lib/productAdmin";
import { DEFAULT_SHOP_PUBLISH_RULES, recheckMessage, type RecheckResult, type ShopPublishRules } from "@/modules/ecommerce/lib/shopQualification";
import { extractApiError } from "@/shared/lib/api";
import {
    EMPTY_PRODUCT_FILTERS,
    activeFilterCount,
    productFilterMatcher,
    productFilterOptions,
    productPhotoCount,
    productStatus,
    type ProductFilters,
    type ProductStatus,
} from "@/modules/ecommerce/lib/productFilters";
import { useShopMasters } from "@/modules/mobile/hooks/useShopMasters";
import { cachedAdminProducts, fetchAdminProducts, /* handOffAiPick — back with Write with AI */ patchCachedAdminProduct } from "@/modules/ecommerce/lib/productListCache";
import { ProductFilterButton, ProductFilterPanel } from "@/modules/ecommerce/components/ProductFilterPanel";
import { InvProductDialog } from "@/modules/inventory/components/InvProductDialog";
import { PaginationBar } from "@/shared/components/PaginationBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
    AlertTriangle,
    ChevronRight,
    ExternalLink,
    // Sparkles — back with Write with AI
    Hourglass,
    // SlidersHorizontal,
} from "lucide-react";
import { productPreviewPath, productShopUrl } from "@/shared/lib/shop/productPublic";
import { AttentionDialog } from "@/modules/ecommerce/components/AttentionDialog";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { formatDate } from "@/shared/lib/format/formatDate";

// Sticky-header scroll frame (costing-page pattern): a plain overflow-auto div,
// with the shadcn Table's own container overflow overridden so the header stays
// put while the body scrolls — no right-side gutter.
const SCROLL_FRAME =
    "min-h-0 flex-1 overflow-auto rounded-lg border [&>[data-slot=table-container]]:overflow-x-visible";
const STICKY_HEAD =
    "sticky top-0 z-20 bg-muted/60 backdrop-blur [&_th]:bg-transparent [&_th]:shadow-[inset_0_-1px_0_var(--border)]";

const COL_COUNT = 11;
const PAGE_SIZE = 25;

/** Stages: Unpublished → Start (waiting) → Draft → Ready → Published (live) / Pending — one stage per product (owner, 2026-11-10).
 *  Attention = a Draft parked until a manual check is done; leaves by Save as draft / ready (owner, 2026-11-11).
 *  Waiting = shortlisted for the AI run (Start AI); the run moves it to Draft / Attention (owner, 2026-11-17). */
// "aside" = has a problem staff set aside ("can't fix now", owner 2026-11-20) — beside any stage.
type TabKey = "all" | ProductStatus["kind"] | "aside";
const TAB_KEYS: TabKey[] = ["all", "unpublished", "waiting", "draft", "ready", "live", "pending", "attention", "aside"];
const TAB_LABEL: Record<TabKey, string> = { all: "All", unpublished: "Unpublished", waiting: "Start", draft: "Draft", ready: "Ready", live: "Published", pending: "Pending", attention: "Attention", aside: "Temporary pass" };
// The stage bar (owner, 2026-11-21): main flow drawn as numbered arrows, side tabs apart,
// and one line under the bar telling staff what to do here and what moves it on.
// Wording only — how a product moves is unchanged.
const STAGE_FLOW: TabKey[] = ["unpublished", "waiting", "draft", "ready", "live"];
// Pending sits inside the Published arrow as a chip (owner, 2026-11-22: "Pending is inside Published").
const SIDE_TABS: TabKey[] = ["attention", "aside"];
// The stage bar's own, louder shades (owner, 2026-11-22: "make them loud to be visible").
const BAR_TONE: Partial<Record<TabKey, string>> = {
    unpublished: "bg-stone-300 text-stone-900 dark:bg-stone-600 dark:text-white",
    waiting: "bg-sky-200 text-sky-950 dark:bg-sky-800 dark:text-white",
    draft: "bg-sky-400 text-sky-950 dark:bg-sky-600 dark:text-white",
    ready: "bg-sky-600 text-white dark:bg-sky-500",
    live: "bg-green-600 text-white dark:bg-green-600",
};
const STAGE_TONE: Partial<Record<TabKey, string>> = {
    unpublished: "bg-stone-200 text-stone-800 dark:bg-stone-700 dark:text-stone-100",
    waiting: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100",
    draft: "bg-sky-200 text-sky-900 dark:bg-sky-900 dark:text-sky-100",
    ready: "bg-sky-300 text-sky-950 dark:bg-sky-800 dark:text-sky-50",
    live: "bg-green-200 text-green-900 dark:bg-green-900 dark:text-green-100",
    pending: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
    attention: "bg-red-600 text-white dark:bg-red-700 dark:text-white", // danger (owner, 2026-11-22)
    aside: "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200",
};
/** A move button wears the colour of the stage it sends the product to. */
// Written out in full so Tailwind sees every class; keep in step with STAGE_TONE.
const GO_TONE = {
    unpublished: "bg-stone-200 text-stone-800 hover:bg-stone-300 hover:text-stone-900 dark:bg-stone-700 dark:text-stone-100 dark:hover:bg-stone-600",
    waiting: "bg-sky-100 text-sky-900 hover:bg-sky-200 hover:text-sky-950 dark:bg-sky-950 dark:text-sky-100 dark:hover:bg-sky-900",
    ready: "bg-sky-300 text-sky-950 hover:bg-sky-400 hover:text-sky-950 dark:bg-sky-800 dark:text-sky-50 dark:hover:bg-sky-700",
    live: "bg-green-200 text-green-900 hover:bg-green-300 hover:text-green-950 dark:bg-green-900 dark:text-green-100 dark:hover:bg-green-800",
    attention: "bg-red-600 text-white hover:bg-red-700 hover:text-white dark:bg-red-700 dark:text-white dark:hover:bg-red-600",
} as const;
/** Which tabs show each bulk move. All / Temporary pass hold mixed stages, so they show every move. */
const BULK_SHOWS: Record<"start" | "ready" | "publish" | "unpublish", TabKey[]> = {
    start: ["all", "aside", "unpublished", "draft", "ready", "attention"],
    ready: ["all", "aside", "unpublished", "waiting", "draft", "attention"],
    publish: ["ready"], // only a verified product goes live (owner, 2026-11-22)
    unpublish: ["all", "aside", "live", "pending"],
};
/** [what to do in this stage, what moves it on] */
const STAGE_HINT: Partial<Record<TabKey, [string, string]>> = {
    all: ["Every product, any stage.", "Pick a stage to see what to do next."],
    unpublished: ["Stage 0 — add photos and shipping weight.", "Then press Start to move it to stage 1."],
    waiting: ["Stage 1 — has enough info; write the copy and process the photos.", "When done it moves to Draft."],
    draft: ["Stage 2 — check the text, specs, photos and notes.", "All correct → Save as ready."],
    ready: ["Stage 3 — verified, waiting.", "Press Publish to put it on the shop."],
    live: ["Live on the shop.", "Nothing to do."],
    pending: ["Published but missing a publish rule — off the shop.", "Fix what it says, then Re-check pending."],
    attention: ["Parked for a hand check.", "Fix it, then Start, Save as draft or Save as ready."],
    aside: ["Problem set aside for now.", "Comes back when the pass is removed."],
};
// Persist the list view (page / filters / scroll) per browser tab so leaving for
// a product's Edit page and coming back (Esc → router.back) returns to the same
// place instead of resetting to page 1.
const VIEW_KEY = "ecommerce-products-view-v2";
type SavedView = {
    page: number;
    pageSize: number;
    tab: TabKey;
    filters: ProductFilters;
    scrollTop: number;
};
function loadSavedView(): Partial<SavedView> {
    if (typeof window === "undefined") return {};
    try {
        return JSON.parse(sessionStorage.getItem(VIEW_KEY) || "{}") as Partial<SavedView>;
    } catch {
        return {};
    }
}

/**
 * The problems under a stage, the one staff must fix first on top (owner, 2026-11-20:
 * "highlight proper way"). Red = stop, amber = should fix, grey = set aside ("can't
 * fix now") — set-aside ones show on every stage, Published too.
 */
function ProblemLines({ problems, full }: { problems: RowProblem[]; full?: boolean }) {
    const open = problems.filter((p) => !p.aside);
    const aside = problems.filter((p) => p.aside);
    const shown = full ? open : open.slice(0, 1);
    const tone = (p: RowProblem) => (p.level === "stop" ? "text-red-700 dark:text-red-400" : p.level === "note" ? "text-blue-700 dark:text-blue-400" : "text-amber-700 dark:text-amber-400");
    return (
        <span className={`flex flex-col gap-0.5 whitespace-normal ${full ? "" : "w-[230px]"} text-[11px] leading-snug`}>
            {shown.map((p, i) => (
                <span key={p.text} className={`${tone(p)} ${full ? "" : "line-clamp-3"} font-medium`} title={p.text}>
                    {full || open.length > 1 ? `${i + 1}. ` : ""}{p.text}
                </span>
            ))}
            {!full && open.length > 1 && <span className="text-muted-foreground">+{open.length - 1} more problem{open.length > 2 ? "s" : ""}</span>}
            {aside.length > 0 && (full
                ? aside.map((p) => <span key={p.text} className="text-muted-foreground">Temporary pass: {p.text}</span>)
                : <span className="text-muted-foreground" title={aside.map((p) => p.text).join("\n")}>{aside.length} temporary pass</span>)}
        </span>
    );
}

function StatusBadge({ status, attention, problems }: { status: ProductStatus; attention?: string | null; problems?: RowProblem[] }) {
    const list = problems ?? (status.kind === "attention" ? splitAttention(attention).problems : []);
    const badge = status.kind === "attention" ? (
        <Badge variant="outline" className="gap-1 border-orange-200 bg-orange-50 text-orange-700">
            <AlertTriangle className="size-3" /> Attention
        </Badge>
    ) : <StageBadge status={status} />;
    return list.length ? (
        <span className="inline-flex flex-col items-start gap-0.5">
            {badge}
            <ProblemLines problems={list} />
        </span>
    ) : badge;
}

function StageBadge({ status }: { status: ProductStatus }) {
    return status.kind === "attention" ? null : status.kind === "live" ? (
        <Badge variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700">
            <CheckCircle2 className="size-3" /> Published
        </Badge>
    ) : status.kind === "pending" ? (
        // The reason is written out, not only in a tooltip, so staff can act on it.
        <span className="inline-flex flex-col items-start gap-0.5">
            <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 text-amber-700" title={status.missing.length ? `Needs ${status.missing.join(", ").toLowerCase()}` : "All rules met here — click Re-check pending"}>
                <AlertCircle className="size-3" /> Pending
            </Badge>
            {status.missing.length ? (
                <span className="max-w-[180px] text-[11px] leading-tight text-amber-700">
                    Needs {status.missing.join(", ")}
                </span>
            ) : null}
        </span>
    ) : status.kind === "ready" ? (
        <Badge variant="outline" className="gap-1 border-violet-200 bg-violet-50 text-violet-700" title="Complete — waiting to be published">
            <CheckCircle2 className="size-3" /> Ready
        </Badge>
    ) : status.kind === "waiting" ? (
        <Badge variant="outline" className="gap-1 border-indigo-200 bg-indigo-50 text-indigo-700" title="In Start — shortlisted for the AI run, not in the shop">
            <Hourglass className="size-3" /> Start
        </Badge>
    ) : status.kind === "draft" ? (
        <Badge variant="outline" className="gap-1 border-sky-200 bg-sky-50 text-sky-700" title="Being worked on — not in the shop">
            <CircleDashed className="size-3" /> Draft
        </Badge>
    ) : (
        <Badge variant="outline" className="gap-1 border-border bg-muted/40 text-muted-foreground">
            Unpublished
        </Badge>
    );
}

export default function EcommerceProductsPage() {
    // Plain defaults on first render — sessionStorage doesn't exist during SSR,
    // so seeding these useState calls from loadSavedView() (as before) made the
    // client's first paint diverge from the server HTML and triggered a
    // hydration mismatch. The saved view is restored client-side in an effect
    // below, after mount.
    // Last loaded list (shared with the AI screen) paints at once; load() refreshes it.
    const canOpen = useCanOpenPage();
    // Right-click on any link in the list (Edit, Edit product, Preview, the name…) →
    // "Open in new window" — the app's own menu, as on the sidebar and registers.
    const { menu: linkMenu, close: closeLinkMenu, onContainerContextMenu } = useLinkContextMenu();
    const [products, setProducts] = useState<ShopProductAdmin[]>(() => cachedAdminProducts() ?? []);
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState<TabKey>("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(PAGE_SIZE);
    const [expanded, setExpanded] = useState<Set<number>>(new Set());

    // Owner-configured publish rules (edited in Shop settings). Used to compute
    // each product's shop status; fetched on mount.
    const [rules, setRules] = useState<ShopPublishRules>(DEFAULT_SHOP_PUBLISH_RULES);

    // Multi-select + bulk publish/unpublish (declared up here so the page-select
    // derivations below can read `selected` without a TDZ error).
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [bulkBusy, setBulkBusy] = useState(false);

    // Filter panel
    const [showFilters, setShowFilters] = useState(false);
    const [filters, setFilters] = useState<ProductFilters>(EMPTY_PRODUCT_FILTERS);
    const query = filters.query;
    const setQuery = (q: string) => setFilters((f) => ({ ...f, query: q }));
    const restoredScrollTop = useRef(0);

    const [rechecking, setRechecking] = useState(false);
    // Flag attention: the open reason box (ids, or null). Anyone on this page may
    // flag — the same people who can save the product (owner, 2026-11-14).
    const [flagIds, setFlagIds] = useState<number[] | null>(null);
    const load = () => {
        fetchAdminProducts()
            .then(setProducts)
            .catch(() => toast.error("Could not load products"));
    };

    useEffect(() => {
        load();
        axios
            .get<{ rules: ShopPublishRules }>("/api/ecommerce/publish-rules")
            .then((r) => setRules(r.data.rules))
            .catch(() => setRules(DEFAULT_SHOP_PUBLISH_RULES));
    }, []);
    // A product published, edited or restocked elsewhere shows up here on its own.
    useRealtimeTopics(["catalogue", "stock"], load);

    // Restore the persisted view AFTER mount — sessionStorage is client-only, so
    // reading it during render would desync the first paint from the SSR HTML.
    const viewRestored = useRef(false);
    useEffect(() => {
        if (viewRestored.current) return;
        viewRestored.current = true;
        const saved = loadSavedView();
        // eslint-disable-next-line react-hooks/set-state-in-effect -- restores the saved list view from sessionStorage once after mount; reading it during render would desync from the server HTML
        if (saved.tab && TAB_KEYS.includes(saved.tab)) setTab(saved.tab);
        if (saved.page) setPage(saved.page);
        if (saved.pageSize) setPageSize(saved.pageSize);
        if (saved.filters) setFilters({ ...EMPTY_PRODUCT_FILTERS, ...saved.filters });
        restoredScrollTop.current = saved.scrollTop ?? 0;
    }, []);

    // Cached master lists (synced by delta) — the Collection / Group filters show their tree.
    const { masters } = useShopMasters();
    const trees = useMemo(() => ({ categories: masters?.category ?? [], groups: masters?.group ?? [], brands: masters?.brand ?? [] }), [masters]);
    const filterOptions = useMemo(() => productFilterOptions(products, trees), [products, trees]);

    // One status per product, shared by the tab counts, the tab filter and the rows.
    const statusOf = useMemo(() => new Map(products.map((p) => [p.id, productStatus(p, rules)])), [products, rules]);
    const counts = useMemo(() => {
        const c: Record<TabKey, number> = { all: products.length, unpublished: 0, waiting: 0, draft: 0, ready: 0, live: 0, pending: 0, attention: 0, aside: 0 };
        for (const st of statusOf.values()) c[st.kind]++;
        c.aside = products.filter((p) => p.hasAsideProblems).length;
        return c;
    }, [products, statusOf]);

    const filtered = useMemo(() => {
        const matches = productFilterMatcher(filters, rules, trees);
        return products.filter((p) => (tab === "all" || (tab === "aside" ? !!p.hasAsideProblems : statusOf.get(p.id)?.kind === tab)) && matches(p));
    }, [products, tab, filters, rules, statusOf, trees]);

    // Reset to page 1 when the filter actually changes — but NOT on the initial
    // mount, so a restored page (from sessionStorage) survives. Compare filter
    // VALUES (not a run counter) so React StrictMode's double-invoke in dev can't
    // wrongly trigger the reset.
    const filterSig = `${tab}|${JSON.stringify(filters)}`;
    const prevFilterSig = useRef(filterSig);
    useEffect(() => {
        if (prevFilterSig.current === filterSig) return;
        prevFilterSig.current = filterSig;
        setPage(1);
        setSelected(new Set()); // avoid acting on rows hidden by the new filter
    }, [filterSig]);

    // Scrollable table ref + persisted view (page/filters/scroll) so back/Esc returns here.
    const scrollRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        // Wait for the restore pass, otherwise this fires first with the plain
        // defaults and wipes the saved view before it can be read back.
        if (!viewRestored.current) return;
        // Merge over the existing entry so we never clobber the saved scrollTop
        // (which `persistScroll` owns) — important on the initial mount.
        try {
            const raw = sessionStorage.getItem(VIEW_KEY);
            const prev = raw ? JSON.parse(raw) : {};
            const view = {
                ...prev,
                page, pageSize, tab, filters,
            };
            sessionStorage.setItem(VIEW_KEY, JSON.stringify(view));
        } catch {
            /* ignore quota / privacy-mode errors */
        }
    }, [page, pageSize, tab, filters]);

    // Restore scroll position once the product rows have rendered.
    const scrollRestored = useRef(false);
    useEffect(() => {
        if (scrollRestored.current || products.length === 0) return;
        scrollRestored.current = true;
        const top = restoredScrollTop.current;
        if (top > 0) requestAnimationFrame(() => {
            if (scrollRef.current) scrollRef.current.scrollTop = top;
        });
    }, [products]);

    // Throttle scroll saves (onScroll fires rapidly) to ~once per 200ms.
    const scrollSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const persistScroll = () => {
        if (scrollSaveTimer.current) return;
        scrollSaveTimer.current = setTimeout(() => {
            scrollSaveTimer.current = null;
            try {
                const raw = sessionStorage.getItem(VIEW_KEY);
                const view = raw ? JSON.parse(raw) : {};
                view.scrollTop = scrollRef.current?.scrollTop ?? 0;
                sessionStorage.setItem(VIEW_KEY, JSON.stringify(view));
            } catch {
                /* ignore */
            }
        }, 200);
    };

    const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
    const pageIds = pageRows.map((p) => p.id);
    const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
    const togglePage = () =>
        setSelected((prev) => {
            const n = new Set(prev);
            if (allPageSelected) pageIds.forEach((id) => n.delete(id));
            else pageIds.forEach((id) => n.add(id));
            return n;
        });
    const selectAllFiltered = () => setSelected(new Set(filtered.map((p) => p.id)));

    // Bulk publish/unpublish handlers (state hoisted above).
    const toggleOne = (id: number) =>
        setSelected((prev) => {
            const n = new Set(prev);
            if (n.has(id)) n.delete(id);
            else n.add(id);
            return n;
        });
    const clearSelection = () => setSelected(new Set());
    const runBulk = async (action: "publish" | "unpublish" | "ready") => {
        const ids = [...selected];
        if (ids.length === 0) return;
        setBulkBusy(true);
        try {
            const { data } = await axios.post<{ published: number; pending: number; unpublished: number; ready?: number; skipped?: { inDraft: number; names: string[]; inAttention?: number; attentionNames?: string[]; inWaiting?: number; waitingNames?: string[] } }>(
                "/api/ecommerce/products/bulk",
                { ids, action }
            );
            if (action === "ready") {
                toast.success(`${data.ready ?? 0} marked ready — publish when the time is right`);
            } else if (action === "publish") {
                toast.success(
                    `Published ${data.published}` +
                    (data.pending ? ` · ${data.pending} pending (live by themselves once their publish rules are met)` : "")
                );
            } else {
                toast.success(`${data.unpublished} unpublished — off the shop, kept as Ready`);
            }
            if (data.skipped?.inDraft) {
                toast.info(`${data.skipped.inDraft} skipped — in Draft (${data.skipped.names.join(", ")}${data.skipped.inDraft > data.skipped.names.length ? ", …" : ""}). Finish it with Save as ready, or Discard draft.`);
            }
            if (data.skipped?.inAttention) {
                const names = data.skipped.attentionNames ?? [];
                toast.info(`${data.skipped.inAttention} skipped — parked in Attention (${names.join(", ")}${data.skipped.inAttention > names.length ? ", …" : ""}). Check it, then Save as draft or Save as ready.`);
            }
            if (data.skipped?.inWaiting) {
                const names = data.skipped.waitingNames ?? [];
                toast.info(`${data.skipped.inWaiting} skipped — in Start (${names.join(", ")}${data.skipped.inWaiting > names.length ? ", …" : ""}). Remove it from Start first.`);
            }
            clearSelection();
            load();
        } catch {
            toast.error("Bulk update failed");
        } finally {
            setBulkBusy(false);
        }
    };

    // Start / Remove from Start (owner, 2026-11-17, renamed to Start 2026-11-20) — rows and the bulk bar.
    const sendToAi = async (ids: number[], action: "start" | "remove") => {
        if (!ids.length) return;
        // Rows move at once (AGENTS §7): Start always lands in Waiting, so it moves
        // before the request and rolls back on failure; Remove moves when the server
        // says where each one goes back to.
        const move = (stageOf: Map<number, ShopProductAdmin["shopStatus"]>) =>
            setProducts((prev) => prev.map((p) => {
                const st = stageOf.get(p.id);
                return st ? { ...p, shopStatus: st, isListedInShop: false, ...(st === "WAITING" && { shopAttention: null }) } : p;
            }));
        const before = products.filter((p) => ids.includes(p.id));
        if (action === "start") move(new Map(ids.map((id) => [id, "WAITING"])));
        setBulkBusy(true);
        try {
            const { data } = await axios.post<{ queued?: number; published?: string[]; removed?: number; moved?: { id: number; shopStatus: ShopProductAdmin["shopStatus"] }[] }>("/api/ecommerce/products/waiting", { ids, action });
            if (action === "remove") move(new Map((data.moved ?? []).map((m) => [m.id, m.shopStatus])));
            if (action === "start") {
                toast.success(`${data.queued ?? 0} sent to Start — the next AI run picks them up`);
                if (data.published?.length) toast.info(`Off the shop while in Start: ${data.published.slice(0, 5).join(", ")}${data.published.length > 5 ? ", …" : ""}`);
            } else {
                toast.success(`${data.removed ?? 0} removed from Start — back to their earlier stage`);
            }
            clearSelection();
            load();
        } catch (e: unknown) {
            const back = new Map(before.map((p) => [p.id, p]));
            setProducts((prev) => prev.map((p) => back.get(p.id) ?? p));
            toast.error(extractApiError(e, "Could not update Start"));
        } finally {
            setBulkBusy(false);
        }
    };

    // One-click publish / unpublish straight from the row.
    const [publishing, setPublishing] = useState<Set<number>>(new Set());
    // Unpublish sends READY too — the work on it is finished (owner, 2026-11-07).
    const moveStage = async (p: ShopProductAdmin, shopStatus: "PUBLISHED" | "READY", unpublish = false) => {
        setPublishing((s) => new Set(s).add(p.id));
        try {
            const { data } = await axios.patch<ShopProductAdmin>(`/api/ecommerce/products/${p.id}`, {
                shopStatus,
            });
            setProducts((prev) => prev.map((x) => (x.id === p.id ? data : x)));
            patchCachedAdminProduct(data);
            toast.success(
                unpublish ? "Unpublished — off the shop, kept as Ready"
                    : shopStatus === "READY" ? "Marked ready — publish when the time is right"
                        : data.isListedInShop ? "Published — live in the shop" : "Published — pending until its publish rules are met",
            );
        } catch (e: unknown) {
            const msg =
                axios.isAxiosError(e) && e.response?.data && typeof e.response.data === "object"
                    ? (e.response.data as { error?: string }).error
                    : "Failed";
            toast.error(msg ?? "Failed");
        } finally {
            setPublishing((s) => {
                const n = new Set(s);
                n.delete(p.id);
                return n;
            });
        }
    };

    const toggleExpand = (id: number) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const tabs = TAB_KEYS.map((key) => ({ key, label: TAB_LABEL[key], count: counts[key] }));

    return (
        <div className="flex h-full flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
                    <p className="text-muted-foreground text-sm">
                        One catalogue across shop, POS and Sale vouchers. Each product moves through the stages below, one at a time.
                    </p>
                </div>
                <div className="flex gap-2">
                    {tab === "pending" && (
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={rechecking}
                            title="Check every Published product against today's publish rules — those that pass go live"
                            onClick={async () => {
                                setRechecking(true);
                                try {
                                    const { data } = await axios.post<{ recheck: RecheckResult }>("/api/ecommerce/publish-rules");
                                    toast.success(recheckMessage(data.recheck));
                                    load();
                                } catch (e: unknown) {
                                    toast.error(extractApiError(e, "Re-check failed"));
                                } finally {
                                    setRechecking(false);
                                }
                            }}
                        >
                            {rechecking ? "Checking…" : "Re-check pending"}
                        </Button>
                    )}
                    {/* Hidden for now — product copy is done with the Claude skills (owner, 2026-11-21).
                    <Button asChild variant="outline" size="sm">
                        <Link href="/office/ecommerce/products/ai">Write descriptions with AI</Link>
                    </Button> */}
                </div>
            </div>

            {/* Tabs + search + filter button */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    {tabs.filter((t) => !STAGE_FLOW.includes(t.key) && !SIDE_TABS.includes(t.key)).map((t) => (
                        <button
                            key={t.key}
                            type="button"
                            onClick={() => setTab(t.key)}
                            className={`rounded-md border px-3 py-1.5 text-sm font-medium ${tab === t.key ? "border-primary bg-background ring-1 ring-primary" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}
                        >
                            {t.label} <span className="text-xs tabular-nums opacity-80">{t.count}</span>
                        </button>
                    ))}
                    <div className="flex max-w-full overflow-x-auto">
                        {STAGE_FLOW.map((key, i) => {
                            const t = tabs.find((x) => x.key === key)!;
                            const first = i === 0;
                            const last = i === STAGE_FLOW.length - 1;
                            const clip = first
                                ? "polygon(0 0,calc(100% - 10px) 0,100% 50%,calc(100% - 10px) 100%,0 100%)"
                                : last
                                    ? "polygon(0 0,100% 0,100% 100%,0 100%,10px 50%)"
                                    : "polygon(0 0,calc(100% - 10px) 0,100% 50%,calc(100% - 10px) 100%,0 100%,10px 50%)";
                            const pending = tabs.find((x) => x.key === "pending")!;
                            const on = tab === key;
                            return (
                                <span
                                    key={key}
                                    style={{ clipPath: clip }}
                                    className={`${first ? "" : "-ml-1.5"} ${last ? "pr-1.5" : "pr-5"} ${first ? "pl-3" : "pl-5"} flex items-center gap-2 whitespace-nowrap text-sm shadow-sm ${BAR_TONE[key]} ${on ? "font-bold" : "font-semibold hover:brightness-95"}`}
                                >
                                    <button type="button" title={STAGE_HINT[key]?.[0]} onClick={() => setTab(key)}
                                        className={`py-1.5 ${on ? "underline decoration-2 underline-offset-4" : ""}`}>
                                        {last ? "✓" : i} {t.label} <span className="tabular-nums">{t.count}</span>
                                    </button>
                                    {last ? (
                                        <button type="button" title={STAGE_HINT.pending?.[0]} onClick={() => setTab("pending")}
                                            className={`rounded px-1.5 py-0.5 text-xs font-semibold ${STAGE_TONE.pending} ${tab === "pending" ? "ring-2 ring-amber-500" : "hover:brightness-95"}`}>
                                            Pending {pending.count}
                                        </button>
                                    ) : null}
                                </span>
                            );
                        })}
                    </div>
                    <span className="text-border">|</span>
                    {SIDE_TABS.map((key) => {
                        const t = tabs.find((x) => x.key === key)!;
                        return (
                            <button
                                key={key}
                                type="button"
                                title={STAGE_HINT[key]?.[0]}
                                onClick={() => setTab(key)}
                                className={`whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium ${STAGE_TONE[key]} ${tab === key ? "ring-2 ring-primary" : "opacity-80 hover:opacity-100"}`}
                            >
                                {t.label} <span className="tabular-nums">{t.count}</span>
                            </button>
                        );
                    })}
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2">
                        {/* <Button type="button" variant="outline" className="gap-2" asChild>
                            <Link href="/office/settings/ecommerce">
                                <SlidersHorizontal className="size-4" />
                                Publish rules
                            </Link>
                        </Button> */}
                        <Button type="button" onClick={() => setOpen(true)}>
                            Add product
                        </Button>
                        <InvProductDialog
                            open={open}
                            onOpenChange={setOpen}
                            editId={null}
                            onSaved={load}
                        />
                    </div>
                    <div className="relative w-full sm:w-64">
                        <Search className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
                        <Input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search name, SKU, brand…"
                            className="pl-8"
                        />
                    </div>
                    <ProductFilterButton open={showFilters} filters={filters} onToggle={() => setShowFilters((s) => !s)} />
                </div>
            </div>

            {/* Expandable filter panel */}
            {STAGE_HINT[tab] ? (
                <div className="bg-muted/50 -mt-2 rounded-md px-3 py-2 text-sm">
                    {STAGE_HINT[tab]![0]} <span className="text-muted-foreground">{STAGE_HINT[tab]![1]}</span>
                </div>
            ) : null}
            {showFilters ? <ProductFilterPanel value={filters} onChange={setFilters} options={filterOptions} /> : null}

            {/* Bulk action bar — appears when rows are selected */}
            {selected.size > 0 ? (
                <div className="border-primary/30 bg-primary/5 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                    <span className="mr-2 font-medium">{selected.size} selected</span>
                    {/* Buttons in stage order, each in the colour of the stage it sends to;
                        only the moves that make sense from this tab (owner, 2026-11-22). */}
                    {tab === "waiting" ? (
                        <Button size="sm" variant="ghost" className={GO_TONE.unpublished} disabled={bulkBusy} onClick={() => void sendToAi([...selected], "remove")}>
                            Remove from Start
                        </Button>
                    ) : BULK_SHOWS.start.includes(tab) ? (
                        <Button size="sm" variant="ghost" className={GO_TONE.waiting} disabled={bulkBusy} title="Shortlist for the AI run — off the shop until it is done" onClick={() => void sendToAi([...selected], "start")}>
                            <Hourglass className="size-4" /> Start
                        </Button>
                    ) : null}
                    {/* Blank slot = this stage's own place: back moves on its left, forward on its right. */}
                    {["waiting", "draft", "ready", "attention"].includes(tab) ? <span aria-hidden className="w-6" /> : null}
                    {BULK_SHOWS.ready.includes(tab) ? (
                        <Button size="sm" variant="ghost" className={GO_TONE.ready} disabled={bulkBusy} onClick={() => void runBulk("ready")}>
                            Mark ready
                        </Button>
                    ) : null}
                    {BULK_SHOWS.publish.includes(tab) ? (
                        <Button size="sm" variant="ghost" className={GO_TONE.live} disabled={bulkBusy} onClick={() => void runBulk("publish")}>
                            Publish
                        </Button>
                    ) : null}
                    {BULK_SHOWS.unpublish.includes(tab) ? (
                        <Button size="sm" variant="ghost" className={GO_TONE.ready} disabled={bulkBusy} title="Off the shop — kept as Ready" onClick={() => void runBulk("unpublish")}>
                            Unpublish
                        </Button>
                    ) : null}
                    {["live", "pending"].includes(tab) ? <span aria-hidden className="w-6" /> : null}
                    {["draft", "live", "pending"].includes(tab) ? (
                        <Button size="sm" variant="ghost" className={GO_TONE.attention} disabled={bulkBusy} onClick={() => setFlagIds([...selected])}>
                            <AlertTriangle className="size-4" /> Flag attention
                        </Button>
                    ) : null}
                    {/* Hidden until its skill matches the Claude.ai product skill (owner, 2026-11-22).
                    <Button size="sm" variant="outline" asChild>
                        <Link href="/office/ecommerce/products/ai" onClick={() => handOffAiPick([...selected])}>
                            <Sparkles className="size-4" /> Write with AI
                        </Link>
                    </Button> */}
                    {allPageSelected && filtered.length > selected.size ? (
                        <Button size="sm" variant="ghost" onClick={selectAllFiltered}>
                            Select all {filtered.length}
                        </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" className="ml-auto" onClick={clearSelection}>
                        Clear
                    </Button>
                </div>
            ) : null}

            {/* Scrollable table — fills remaining height, header pinned */}
            <AttentionDialog ids={flagIds} onClose={() => setFlagIds(null)} onDone={() => { clearSelection(); load(); }} />

            <div ref={scrollRef} onScroll={persistScroll} className={SCROLL_FRAME} onContextMenu={onContainerContextMenu}>
                <LinkContextMenu menu={linkMenu} onClose={closeLinkMenu} />
                <Table>
                    <TableHeader className={STICKY_HEAD}>
                        <TableRow>
                            <TableHead className="w-10">
                                <Checkbox
                                    checked={allPageSelected ? true : pageIds.some((id) => selected.has(id)) ? "indeterminate" : false}
                                    onCheckedChange={togglePage}
                                    aria-label="Select all on page"
                                />
                            </TableHead>
                            <TableHead className="w-8" />
                            <TableHead className="w-12" />
                            <TableHead>Name</TableHead>
                            <TableHead className="w-32">Brand</TableHead>
                            <TableHead className="w-32">Group</TableHead>
                            <TableHead className="w-32">Shop status</TableHead>
                            <TableHead className="w-28 text-right">Shop price</TableHead>
                            <TableHead className="w-20 text-right">Stock</TableHead>
                            <TableHead className="w-20 text-right">Photos</TableHead>
                            <TableHead className="w-40" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {pageRows.map((p) => {
                            const status = statusOf.get(p.id) ?? productStatus(p, rules);
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
                                        <TableCell onClick={(e) => e.stopPropagation()}>
                                            <Checkbox
                                                checked={selected.has(p.id)}
                                                onCheckedChange={() => toggleOne(p.id)}
                                                aria-label={`Select ${p.name}`}
                                            />
                                        </TableCell>
                                        <TableCell className="text-muted-foreground">
                                            <ChevronRight
                                                className={`size-4 transition-transform ${isOpen ? "rotate-90" : ""}`}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <div className="relative size-9 overflow-hidden rounded-md border bg-muted">
                                                {img ? (
                                                    <Image src={img} alt="" fill className="object-cover" sizes="36px" loader={imageLoaderFor(img, "square")} unoptimized={!isCloudinaryUrl(img)} />
                                                ) : null}
                                            </div>
                                        </TableCell>
                                        <TableCell className="max-w-0">
                                            {/* A real link, so right-click / Ctrl+click opens the edit page; a plain click still expands the row. */}
                                            <Link
                                                href={`/office/ecommerce/products/${p.id}`}
                                                onClick={(e) => { if (!e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) e.preventDefault(); }}
                                                className="block truncate font-medium hover:underline"
                                            >
                                                {p.name}
                                            </Link>
                                            <div className="text-muted-foreground truncate text-xs">
                                                <span className="font-mono">{p.sku}</span>
                                                {!p.isActive ? " · inactive" : ""}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-muted-foreground max-w-32 truncate text-sm">
                                            {p.brandName ?? "—"}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground max-w-32 truncate text-sm">
                                            {p.groupName ?? "—"}
                                        </TableCell>
                                        <TableCell>
                                            <StatusBadge status={status} attention={p.shopAttention} problems={p.problems} />
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">
                                            {shopPricePaise ? formatRupeesFromPaise(shopPricePaise) : "—"}
                                        </TableCell>
                                        <TableCell className="text-right text-sm tabular-nums">
                                            {p.stock === null ? "—" : p.stock}
                                        </TableCell>
                                        <TableCell className={`text-right text-sm tabular-nums ${productPhotoCount(p) === 0 ? "text-destructive/70" : ""}`}>
                                            {productPhotoCount(p)}
                                        </TableCell>
                                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                                            <div className="flex items-center justify-end gap-1.5">
                                                {status.kind === "attention" ? (
                                                    <>
                                                        <Button size="sm" variant="outline" asChild title="Check it, then Save as draft or Save as ready">
                                                            <Link href={`/office/ecommerce/products/${p.id}`}>Open</Link>
                                                        </Button>
                                                        <Button size="sm" variant="ghost" className={GO_TONE.waiting} disabled={bulkBusy} title="Fixed — clear the flag and send it to Start" onClick={() => void sendToAi([p.id], "start")}>
                                                            <Hourglass className="size-3.5" />
                                                            Start
                                                        </Button>
                                                    </>
                                                ) : status.kind === "waiting" ? (
                                                    <Button size="sm" variant="ghost" className={GO_TONE.unpublished} disabled={bulkBusy} title="Take it off the Start list — back to its earlier stage" onClick={() => void sendToAi([p.id], "remove")}>
                                                        Remove
                                                    </Button>
                                                ) : status.kind === "draft" ? (
                                                    <>
                                                        <Button size="sm" variant="outline" asChild>
                                                            <Link href={`/office/ecommerce/products/${p.id}`}>Open draft</Link>
                                                        </Button>
                                                        <Button size="sm" variant="ghost" className={GO_TONE.attention} title="Work blocked — park it in Attention with the reason" onClick={() => setFlagIds([p.id])}>
                                                            <AlertTriangle className="size-3.5" />
                                                            Flag
                                                        </Button>
                                                    </>
                                                ) : status.kind === "unpublished" ? (
                                                    <>
                                                        <Button size="sm" variant="ghost" className={GO_TONE.waiting} disabled={bulkBusy} title="Shortlist for the AI run" onClick={() => void sendToAi([p.id], "start")}>
                                                            <Hourglass className="size-3.5" />
                                                            Start
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            className={GO_TONE.ready}
                                                            disabled={publishing.has(p.id)}
                                                            onClick={() => void moveStage(p, "READY")}
                                                        >
                                                            {publishing.has(p.id) ? "…" : "Mark ready"}
                                                        </Button>
                                                    </>
                                                ) : status.kind === "ready" ? (
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className={GO_TONE.live}
                                                        disabled={publishing.has(p.id)}
                                                        onClick={() => void moveStage(p, "PUBLISHED")}
                                                    >
                                                        {publishing.has(p.id) ? "…" : "Publish"}
                                                    </Button>
                                                ) : status.kind === "live" || status.kind === "pending" ? (
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className={GO_TONE.ready}
                                                        disabled={publishing.has(p.id)}
                                                        onClick={() => void moveStage(p, "READY", true)}
                                                    >
                                                        {publishing.has(p.id) ? "…" : "Unpublish"}
                                                    </Button>
                                                ) : null}
                                                {status.kind === "live" || status.kind === "pending" ? (
                                                    <Button size="sm" variant="ghost" className={GO_TONE.attention} title="Big mistake — take it off the shop and park it in Attention" onClick={() => setFlagIds([p.id])}>
                                                        <AlertTriangle className="size-3.5" />
                                                        Flag
                                                    </Button>
                                                ) : null}
                                                {/* Works whatever the publish state — draft, ready or live. */}
                                                <Button variant="ghost" size="sm" asChild title="Full-page preview">
                                                    <a
                                                        href={productPreviewPath(p)}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                    >
                                                        <ExternalLink className="size-4" />
                                                        <span className="sr-only">Preview {p.name}</span>
                                                    </a>
                                                </Button>
                                                <Button variant="ghost" size="sm" asChild>
                                                    <Link href={`/office/ecommerce/products/${p.id}`}>Edit</Link>
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                    {isOpen ? (
                                        <TableRow className="hover:bg-transparent">
                                            <TableCell colSpan={COL_COUNT} className="bg-muted/20 whitespace-normal">
                                                <div className="grid gap-4 px-4 py-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                                                    <Detail label="SKU" value={<span className="font-mono">{p.sku}</span>} />
                                                                                                        <Detail label="Brand" value={p.brandName ?? "—"} />
                                                    <Detail label="Group (shop category)" value={p.groupName ?? "—"} />
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
                                                            status.kind === "attention"
                                                                ? <AttentionDetail p={p} />
                                                                : p.problems?.length
                                                                ? <span className="flex flex-col gap-1"><span>{STAGE_LINE[status.kind] ?? ""}</span><ProblemLines problems={p.problems} full /></span>
                                                                : status.kind === "waiting"
                                                                ? "Start — shortlisted for the AI run, not in the shop. The run moves it to Draft (or Attention); Remove puts it back."
                                                                : status.kind === "draft"
                                                                ? `Draft — being worked on, not in the shop.${p.shopAttention ? ` Was parked for: ${p.shopAttention}` : ""}`
                                                                : status.kind === "live"
                                                                ? "Published — live on the storefront"
                                                                : status.kind === "pending"
                                                                    ? status.missing.length
                                                                        ? `Pending — needs ${status.missing.join(", ").toLowerCase()}; goes live by itself once added`
                                                                        : "Pending — all rules are met on this screen; click Re-check pending to update it"
                                                                    : status.kind === "ready"
                                                                            ? `Ready — complete, waiting to be published${status.missing.length ? `; publishing now would wait as Pending (needs ${status.missing.join(", ").toLowerCase()})` : ""}.`
                                                                        : "Unpublished — not worked on yet. Mark ready when it is complete."
                                                        }
                                                    />
                                                    <div className="sm:col-span-2 lg:col-span-4">
                                                        <p className="text-muted-foreground text-xs">Description</p>
                                                        <p className="mt-0.5 line-clamp-2">
                                                            {p.description?.trim() || <span className="text-muted-foreground italic">No description yet.</span>}
                                                        </p>
                                                    </div>
                                                    <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-4">
                                                        <Button variant="outline" size="sm" asChild>
                                                            <Link href={`/office/ecommerce/products/${p.id}`}>Edit product</Link>
                                                        </Button>
                                                        <Button variant="outline" size="sm" asChild>
                                                            <a
                                                                href={productPreviewPath(p)}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                            >
                                                                Preview
                                                                <ExternalLink className="size-3.5" />
                                                            </a>
                                                        </Button>
                                                        {status.kind === "live" && canOpen(`/office/campaigns/posts/new`) ? (
                                                            <Button variant="outline" size="sm" asChild>
                                                                <Link href={`/office/campaigns/posts/new?product=${p.id}`}>Make a post</Link>
                                                            </Button>
                                                        ) : null}
                                                        {status.kind === "live" ? (
                                                            <Button variant="outline" size="sm" asChild>
                                                                <a
                                                                    href={productShopUrl(p)}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                >
                                                                    Open in shop
                                                                    <ExternalLink className="size-3.5" />
                                                                </a>
                                                            </Button>
                                                        ) : null}
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
                        {query.trim() || activeFilterCount(filters) > 0
                            ? "No products match your filters."
                            : tab === "all"
                                ? "No products."
                                : `No ${TAB_LABEL[tab].toLowerCase()} products.`}
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


function Detail({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div>
            <p className="text-muted-foreground text-xs">{label}</p>
            <div className="mt-0.5">{value}</div>
        </div>
    );
}

/** A short stage line above set-aside problems on a product that is not in Attention. */
const STAGE_LINE: Partial<Record<ProductStatus["kind"], string>> = {
    live: "Published — live on the storefront", ready: "Ready — waiting to be published", draft: "Draft — being worked on, not in the shop",
    pending: "Pending — waits for a publish rule", unpublished: "Unpublished", waiting: "Start — shortlisted for the AI run",
};

/** Attention, expanded: who parked it, the problems (numbered, coloured), then the small print. */
function AttentionDetail({ p }: { p: ShopProductAdmin }) {
    const { problems, rest } = splitAttention(p.shopAttention);
    const list = p.problems ?? problems;
    return (
        <span className="flex flex-col gap-1">
            <span className="font-medium text-orange-700 dark:text-orange-400">
                Attention — parked{p.shopAttentionBy ? ` by ${p.shopAttentionBy}` : ""}{p.shopAttentionAt ? ` on ${formatDate(p.shopAttentionAt)}` : ""}
            </span>
            {list.length ? <ProblemLines problems={list} full /> : <span>{p.shopAttention ?? "—"}</span>}
            {rest.length > 0 && (
                <span className="flex flex-col text-[11px] text-muted-foreground">
                    {rest.map((l) => <span key={l}>{l.replace(/\.\.$/, ".")}</span>)}
                </span>
            )}
            <span className="text-[11px] text-muted-foreground">Off the shop — fix it, then Save as draft or Save as ready.</span>
        </span>
    );
}
