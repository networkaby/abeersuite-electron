"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GatedLink } from "@/shared/components/GatedLink";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { toast } from "sonner";
import { RefreshCw, Settings, AlertTriangle, PackagePlus, XCircle, ChevronRight, RotateCcw, ChevronUp, ChevronDown, ChevronsUpDown, Clock, ListChecks, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { TableEmptyRow, TableLoadingRow } from "@/shared/components/DataTableStates";
import { AllocateVoucherDialog } from "@/modules/pricing-strategy/components/AllocateVoucherDialog";
import { AllocationDetailDialog, type AllocationDoc } from "@/modules/pricing-strategy/components/AllocationDetailDialog";
import { formatRupeesFromPaise, parseRupeesToPaise } from "@/shared/lib/format";
import { confirmAction } from "@/shared/lib/ui/confirmStore";

// Sticky-header scroll frame: a plain overflow-auto div (NOT Radix ScrollArea —
// the shadcn Table's own [data-slot=table-container] overflow breaks `sticky`
// thead). Override its overflow-x so the column header stays put, body scrolls.
const SCROLL_FRAME = "overflow-auto rounded-md border [&>[data-slot=table-container]]:overflow-x-visible";
const STICKY_HEAD = "sticky top-0 z-20 bg-muted [&_th]:bg-muted [&_th]:shadow-[inset_0_-1px_0_var(--border)]";

// ── Types (mirror the API DTOs) ───────────────────────────────────────────────
interface PoolEntry {
    glLineId: number;
    date: string;
    ledgerId: number;
    ledgerName: string;
    reference: string;
    referenceType: string | null;
    amountPaise: number;
    allocatedPaise: number;
    dismissedPaise: number;
    remainingPaise: number;
}
interface PoolSummary {
    configured: boolean;
    groupId: number | null;
    groupName: string | null;
    ledgers: { id: number; name: string }[];
    entries: PoolEntry[];
    poolTotalPaise: number;
    allocatedTotalPaise: number;
    dismissedTotalPaise: number;
    waitingTotalPaise: number;
}
interface DrawRow {
    id: number;
    kind: "ALLOCATION" | "DISMISSAL";
    amountPaise: number;
    perUnitPaise: number | null;
    quantity: number | null;
    note: string | null;
    date: string;
    createdAt: string;
    productId: number | null;
    productName: string | null;
    productSku: string | null;
    sourceGlLineId: number | null;
    ledgerName: string | null;
    reference: string | null;
    referenceType: string | null;
    invVoucherId: number | null;
    invVoucherRef: string | null;
    invVoucherType: string | null;
    invVoucherParty: string | null;
    createdByName: string | null;
    orphaned: boolean;
}

// A history "document" = the draws from one allocate/dismiss action, grouped by
// (payment entry, source inventory voucher, kind) — shown like a voucher row.
interface Doc {
    key: string;
    kind: "ALLOCATION" | "DISMISSAL";
    paymentRef: string | null;
    paymentType: string | null;
    ledgerName: string | null;
    invVoucherRef: string | null;
    invVoucherType: string | null;
    invVoucherParty: string | null;
    date: string;
    totalPaise: number;
    createdByName: string | null;
    orphaned: boolean;
    draws: DrawRow[];
}

type SortKey = "date" | "kind" | "payment" | "inv" | "items" | "amount" | "by";

/** Clickable header for the documents table. Module-level, so it is not a new
 *  component type on every render (that remounted the whole header row). */
function SortTh({ label, k, align = "left", sort, onSort }: {
    label: string; k: SortKey; align?: "left" | "right";
    sort: { key: SortKey; dir: 1 | -1 }; onSort: (k: SortKey) => void;
}) {
    return (
        <TableHead className={`text-xs ${align === "right" ? "text-right" : ""}`}>
            <button type="button" onClick={() => onSort(k)} className={`inline-flex items-center gap-1 hover:text-foreground ${align === "right" ? "flex-row-reverse" : ""}`}>
                {label}
                {sort.key === k
                    ? (sort.dir === 1 ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />)
                    : <ChevronsUpDown className="size-3 opacity-40" />}
            </button>
        </TableHead>
    );
}

const rupee = (paise: number | null): string => (paise == null ? "—" : formatRupeesFromPaise(paise));
export default function CostingPage() {
    const [pool, setPool] = useState<PoolSummary | null>(null);
    const [draws, setDraws] = useState<DrawRow[]>([]);
    const [loading, setLoading] = useState(true);

    // Allocation = voucher-driven big dialog; dismissal = the simple inline dialog.
    const [allocEntry, setAllocEntry] = useState<PoolEntry | null>(null);
    // Clicking a history document opens its line items for editing.
    const [detailDoc, setDetailDoc] = useState<AllocationDoc | null>(null);

    // History filters + sort
    const [histSearch, setHistSearch] = useState("");
    const [histKind, setHistKind] = useState<"ALL" | "ALLOCATION" | "DISMISSAL">("ALL");
    const [groupBy, setGroupBy] = useState<"none" | "inv" | "party">("none");
    const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "date", dir: -1 });
    const toggleSort = (k: SortKey) =>
        setSort((s) => (s.key === k ? { key: k, dir: (s.dir * -1) as 1 | -1 } : { key: k, dir: k === "inv" || k === "payment" || k === "by" ? 1 : -1 }));

    // Dismiss dialog state
    const [entry, setEntry] = useState<PoolEntry | null>(null);
    const [amount, setAmount] = useState("");
    const [note, setNote] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const loadPool = useCallback(
        () => axios.get<PoolSummary>("/api/pricing-strategy/costing/pool").then((r) => setPool(r.data)),
        [],
    );
    const loadDraws = useCallback(
        () => axios.get<DrawRow[]>("/api/pricing-strategy/costing/draws").then((r) => setDraws(r.data)),
        [],
    );
    const refresh = useCallback(() => Promise.all([loadPool(), loadDraws()]), [loadPool, loadDraws]);

    const loadAll = useCallback(() => {
        setLoading(true);
        refresh()
            .catch(() => toast.error("Failed to load costing data"))
            .finally(() => setLoading(false));
    }, [refresh]);

    // First load: `loading` starts true, so only the read runs here.
    useEffect(() => {
        void refresh()
            .catch(() => toast.error("Failed to load costing data"))
            .finally(() => setLoading(false));
    }, [refresh]);

    // The additional-cost pool and its draws move whenever a purchase is posted
    // or allocated elsewhere — `ledger` for the voucher, `catalogue` for the
    // price effect. Cheap reads, and a stale pool invites double allocation.
    useRealtimeTopics(["ledger", "catalogue"], loadAll);

    // Group draws into voucher-like documents: one row per (payment entry +
    // source inventory voucher + kind). Draws arrive newest-first.
    const documents = useMemo(() => {
        const m = new Map<string, Doc>();
        for (const d of draws) {
            const key = `${d.sourceGlLineId ?? "x"}|${d.invVoucherId ?? "x"}|${d.kind}`;
            let g = m.get(key);
            if (!g) {
                g = {
                    key, kind: d.kind, paymentRef: d.reference, paymentType: d.referenceType,
                    ledgerName: d.ledgerName,
                    invVoucherRef: d.invVoucherRef, invVoucherType: d.invVoucherType,
                    invVoucherParty: d.invVoucherParty,
                    date: d.date, totalPaise: 0, createdByName: d.createdByName,
                    orphaned: d.orphaned, draws: [],
                };
                m.set(key, g);
            }
            g.draws.push(d);
            g.totalPaise += d.amountPaise;
            if (d.date > g.date) g.date = d.date;
        }
        return [...m.values()];
    }, [draws]);

    // Filter the document list — by kind and by a free-text match on the
    // purchase ref / payment ref / ledger / any product name in the document.
    const filteredDocuments = useMemo(() => {
        const q = histSearch.trim().toLowerCase();
        return documents.filter((g) => {
            if (histKind !== "ALL" && g.kind !== histKind) return false;
            if (!q) return true;
            const hay = [
                g.paymentRef, g.invVoucherRef, g.ledgerName,
                ...g.draws.map((d) => d.productName),
            ].filter(Boolean).join(" ").toLowerCase();
            return hay.includes(q);
        });
    }, [documents, histSearch, histKind]);
    const filteredTotalPaise = useMemo(
        () => filteredDocuments.reduce((s, g) => s + g.totalPaise, 0),
        [filteredDocuments],
    );

    // Sort the document list. Secondary key = inward date (desc) so rows of the
    // same purchase stay grouped + date-ordered when sorting by purchase/payment.
    const sortedDocuments = useMemo(() => {
        const cmpVal = (g: Doc): string | number => {
            switch (sort.key) {
                case "date": return g.date;
                case "kind": return g.kind;
                case "payment": return g.paymentRef ?? "";
                case "inv": return g.invVoucherRef ?? "";
                case "items": return g.draws.length;
                case "amount": return g.totalPaise;
                case "by": return g.createdByName ?? "";
            }
        };
        return [...filteredDocuments].sort((a, b) => {
            const va = cmpVal(a), vb = cmpVal(b);
            if (va < vb) return -sort.dir;
            if (va > vb) return sort.dir;
            return b.date.localeCompare(a.date); // tiebreak: newest inward first
        });
    }, [filteredDocuments, sort]);


    // Group the sorted docs (purchase- or party-wise) into header + rows. The
    // group header row carries the group's count + total.
    type Row = { type: "group"; label: string; count: number; total: number } | { type: "doc"; g: Doc };
    const displayRows = useMemo<Row[]>(() => {
        if (groupBy === "none") return sortedDocuments.map((g) => ({ type: "doc" as const, g }));
        const keyOf = (g: Doc) =>
            groupBy === "inv"
                ? (g.invVoucherRef ?? "— No purchase voucher")
                : (g.invVoucherParty ?? "— No party");
        const groups = new Map<string, Doc[]>();
        for (const g of sortedDocuments) {
            const k = keyOf(g);
            const arr = groups.get(k);
            if (arr) arr.push(g); else groups.set(k, [g]);
        }
        const out: Row[] = [];
        for (const [label, docs] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
            out.push({ type: "group", label, count: docs.length, total: docs.reduce((s, d) => s + d.totalPaise, 0) });
            for (const g of docs) out.push({ type: "doc", g });
        }
        return out;
    }, [sortedDocuments, groupBy]);

    const docRow = (g: Doc) => (
        <TableRow key={g.key} className="cursor-pointer hover:bg-muted/40" onClick={() => openDoc(g)}>
            <TableCell className="text-xs">{g.date.slice(0, 10)}</TableCell>
            <TableCell className="text-xs">
                {g.kind === "ALLOCATION" ? (
                    <span className="inline-flex items-center gap-1 text-violet-700 dark:text-violet-300">
                        <PackagePlus className="size-3" /> Allocation
                    </span>
                ) : (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <XCircle className="size-3" /> Dismissal
                    </span>
                )}
            </TableCell>
            <TableCell className="text-xs">
                <span className="font-mono">{g.paymentRef ?? "—"}</span>
                {g.paymentType ? <span className="text-muted-foreground"> · {g.paymentType}</span> : null}
                {g.ledgerName ? <span className="text-muted-foreground"> · {g.ledgerName}</span> : null}
                {g.orphaned ? (
                    <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-red-600" title="Source entry was cancelled/deleted">
                        <AlertTriangle className="size-3" /> orphaned
                    </span>
                ) : null}
            </TableCell>
            <TableCell className="text-xs">
                {g.invVoucherRef ? (
                    <span className="font-mono">{g.invVoucherRef}</span>
                ) : <span className="text-muted-foreground">—</span>}
                {g.invVoucherType ? <span className="text-muted-foreground"> · {g.invVoucherType}</span> : null}
                {g.invVoucherParty ? (
                    <div className="text-[10px] text-muted-foreground truncate max-w-[200px]" title={g.invVoucherParty}>{g.invVoucherParty}</div>
                ) : null}
            </TableCell>
            <TableCell className="text-right text-xs font-mono">{g.draws.length}</TableCell>
            <TableCell className="text-right text-xs font-mono">{rupee(g.totalPaise)}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{g.createdByName ?? "—"}</TableCell>
            <TableCell className="text-right whitespace-nowrap">
                {g.kind === "DISMISSAL" ? (
                    <Button type="button" size="sm" variant="outline" className="h-7" onClick={(ev) => { ev.stopPropagation(); void undismiss(g); }}>
                        <RotateCcw className="size-3.5" /> Undismiss
                    </Button>
                ) : (
                    <ChevronRight className="size-4 text-muted-foreground inline" aria-hidden />
                )}
            </TableCell>
        </TableRow>
    );

    // Reverse a dismissal — delete its draw(s) so the amount returns to waiting.
    async function undismiss(g: Doc) {
        if (!(await confirmAction({ title: `Un-dismiss — return ${rupee(g.totalPaise)} to the waiting pool?`, confirmLabel: "Un-dismiss", destructive: false }))) return;
        try {
            for (const d of g.draws) {
                await axios.delete(`/api/pricing-strategy/costing/draws/${d.id}`);
            }
            toast.success("Un-dismissed — back in the waiting pool");
            await refresh();
        } catch (err: unknown) {
            toast.error(axios.isAxiosError(err) ? err.response?.data?.error ?? "Failed" : "Failed");
        }
    }

    function openDoc(g: Doc) {
        setDetailDoc({
            kind: g.kind,
            paymentRef: g.paymentRef,
            ledgerName: g.ledgerName,
            invVoucherRef: g.invVoucherRef,
            date: g.date,
            draws: g.draws,
        });
    }

    // ── Dismiss (office-expense write-off) ────────────────────────────────────
    function openDismiss(e: PoolEntry) {
        setEntry(e);
        setAmount((e.remainingPaise / 100).toFixed(2)); // default to the full remaining
        setNote("");
    }
    function closeDismiss() { setEntry(null); }

    async function submitDismiss() {
        if (!entry) return;
        const amountPaise = parseRupeesToPaise(amount);
        if (amountPaise == null || amountPaise <= 0) return toast.error("Enter a valid amount to dismiss.");
        if (amountPaise > entry.remainingPaise) {
            return toast.error(`Amount exceeds the entry's remaining ${rupee(entry.remainingPaise)}.`);
        }
        setSubmitting(true);
        try {
            await axios.post("/api/pricing-strategy/costing/draws", {
                kind: "DISMISSAL",
                sourceGlLineId: entry.glLineId,
                amountPaise,
                note: note.trim() || undefined,
            });
            toast.success("Dismissed as office expense");
            closeDismiss();
            await refresh();
        } catch (err: unknown) {
            toast.error(axios.isAxiosError(err) ? err.response?.data?.error ?? "Failed" : "Failed");
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="flex h-full flex-col gap-3 px-2 pb-2">
            {/* Compact summary strip (title lives in the breadcrumb) */}
            <div className="flex flex-none flex-wrap items-center gap-2 pt-1">
                {pool?.configured ? (
                    <>
                        <StatBadge label="Pool" value={rupee(pool.poolTotalPaise)} />
                        <StatBadge label="Allocated" value={rupee(pool.allocatedTotalPaise)} tone="violet" />
                        <StatBadge label="Dismissed" value={rupee(pool.dismissedTotalPaise)} tone="muted" />
                        <StatBadge label="Waiting" value={rupee(pool.waitingTotalPaise)} tone="amber" />
                        <span className="truncate max-w-[260px] text-xs text-muted-foreground" title={pool.ledgers.map((l) => l.name).join(", ")}>
                            · {pool.groupName ?? "—"}{pool.ledgers.length ? ` (${pool.ledgers.length} ledger${pool.ledgers.length === 1 ? "" : "s"})` : ""}
                        </span>
                    </>
                ) : <span className="text-xs text-muted-foreground">Additional shipping/courier cost — pricing only, never posted to the books.</span>}
                <Button type="button" variant="outline" size="sm" className="ml-auto h-8" onClick={loadAll} disabled={loading}>
                    <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Reload
                </Button>
            </div>

            {/* Unconfigured notice */}
            {!loading && pool && !pool.configured ? (
                <div className="flex flex-none items-center gap-2 rounded-md border border-amber-300 bg-amber-50/60 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
                    <AlertTriangle className="size-4 shrink-0 text-amber-600" aria-hidden />
                    <span>No pool group configured. Pick an account group in</span>
                    <GatedLink whenLocked="text" textClassName="inline-flex items-center gap-1 font-medium" href="/office/settings/org-defaults" className="inline-flex items-center gap-1 font-medium underline">
                        <Settings className="size-3.5" /> Settings → Org Defaults
                    </GatedLink>
                    <span>to start allocating courier costs.</span>
                </div>
            ) : null}

            {/* Waiting entries */}
            <div className="flex-none">
                <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
                    <Clock className="size-4 text-amber-600" aria-hidden />
                    Waiting entries
                    {pool?.configured && pool.entries.length > 0 ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                            {pool.entries.length} · {rupee(pool.waitingTotalPaise)}
                        </span>
                    ) : null}
                </h3>
                <div className={`max-h-[34vh] ${SCROLL_FRAME}`}>
                    <Table>
                        <TableHeader className={STICKY_HEAD}>
                            <TableRow>
                                <TableHead className="text-xs">Date</TableHead>
                                <TableHead className="text-xs">Ledger</TableHead>
                                <TableHead className="text-xs">Payment voucher</TableHead>
                                <TableHead className="text-right text-xs">Total</TableHead>
                                <TableHead className="text-right text-xs">Allocated</TableHead>
                                <TableHead className="text-right text-xs">Dismissed</TableHead>
                                <TableHead className="text-right text-xs">Remaining</TableHead>
                                <TableHead className="text-right text-xs">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {/* Only while there is nothing to show. Reload already
                                spins its own icon above, so a re-read need not empty
                                the table to prove it happened. */}
                            {loading && !pool ? (
                                <TableLoadingRow colSpan={8} />
                            ) : !pool?.configured ? (
                                <TableEmptyRow colSpan={8} message="Feature not configured." />
                            ) : pool.entries.length === 0 ? (
                                <TableEmptyRow colSpan={8} message="Nothing waiting — every courier/shipping debit is fully allocated or dismissed." />
                            ) : (
                                pool.entries.map((e) => (
                                    <TableRow key={e.glLineId} className="hover:bg-muted/40">
                                        <TableCell className="text-xs whitespace-nowrap">{e.date.slice(0, 10)}</TableCell>
                                        <TableCell className="text-xs">{e.ledgerName}</TableCell>
                                        <TableCell className="text-xs">
                                            <span className="font-mono">{e.reference}</span>
                                            {e.referenceType ? <span className="text-muted-foreground"> · {e.referenceType}</span> : null}
                                        </TableCell>
                                        <TableCell className="text-right text-xs font-mono">{rupee(e.amountPaise)}</TableCell>
                                        <TableCell className="text-right text-xs font-mono text-violet-700 dark:text-violet-300">{rupee(e.allocatedPaise)}</TableCell>
                                        <TableCell className="text-right text-xs font-mono text-muted-foreground">{rupee(e.dismissedPaise)}</TableCell>
                                        <TableCell className="text-right">
                                            <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-mono font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                                                {rupee(e.remainingPaise)}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right whitespace-nowrap space-x-1">
                                            <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => setAllocEntry(e)}>
                                                <PackagePlus className="size-3.5" /> Allocate
                                            </Button>
                                            <Button type="button" size="sm" variant="ghost" className="h-7 text-muted-foreground" onClick={() => openDismiss(e)}>
                                                <XCircle className="size-3.5" /> Dismiss
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </div>

            {/* Allocation documents — voucher-like list, click a row to open its items */}
            <div className="min-h-0 flex-1 flex flex-col">
                <div className="mb-1.5 flex flex-wrap items-center gap-2 rounded-md border bg-card/60 px-2.5 py-2">
                    <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                        <ListChecks className="size-4 text-violet-600" aria-hidden />
                        Allocations &amp; dismissals
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {filteredDocuments.length}{filteredDocuments.length !== documents.length ? ` / ${documents.length}` : ""} · {rupee(filteredTotalPaise)}
                        </span>
                    </h3>
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                            <Input
                                placeholder="Filter by purchase / payment / product…"
                                value={histSearch}
                                onChange={(e) => setHistSearch(e.target.value)}
                                className="h-8 w-64 pl-7 text-xs"
                            />
                        </div>
                        <Select value={histKind} onValueChange={(v) => setHistKind(v as typeof histKind)}>
                            <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ALL">All types</SelectItem>
                                <SelectItem value="ALLOCATION">Allocations</SelectItem>
                                <SelectItem value="DISMISSAL">Dismissals</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select value={groupBy} onValueChange={(v) => setGroupBy(v as typeof groupBy)}>
                            <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">No grouping</SelectItem>
                                <SelectItem value="inv">Group by purchase</SelectItem>
                                <SelectItem value="party">Group by party</SelectItem>
                            </SelectContent>
                        </Select>
                        {(histSearch || histKind !== "ALL" || groupBy !== "none") ? (
                            <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => { setHistSearch(""); setHistKind("ALL"); setGroupBy("none"); }}>
                                Clear
                            </Button>
                        ) : null}
                    </div>
                </div>
                <div className={`min-h-0 flex-1 ${SCROLL_FRAME}`}>
                    <Table>
                        <TableHeader className={STICKY_HEAD}>
                            <TableRow>
                                <SortTh sort={sort} onSort={toggleSort} label="Effective" k="date" />
                                <SortTh sort={sort} onSort={toggleSort} label="Type" k="kind" />
                                <SortTh sort={sort} onSort={toggleSort} label="Payment voucher" k="payment" />
                                <SortTh sort={sort} onSort={toggleSort} label="Source inventory voucher" k="inv" />
                                <SortTh sort={sort} onSort={toggleSort} label="Items" k="items" align="right" />
                                <SortTh sort={sort} onSort={toggleSort} label="Amount" k="amount" align="right" />
                                <SortTh sort={sort} onSort={toggleSort} label="By" k="by" />
                                <TableHead className="text-right text-xs" />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading && documents.length === 0 ? (
                                <TableLoadingRow colSpan={8} />
                            ) : filteredDocuments.length === 0 ? (
                                <TableEmptyRow colSpan={8} message={documents.length === 0 ? "No allocations or dismissals yet." : "No rows match the filter."} />
                            ) : (
                                displayRows.map((row, i) =>
                                    row.type === "group" ? (
                                        <TableRow key={`g-${i}`} className="bg-muted/60 hover:bg-muted/60">
                                            <TableCell colSpan={8} className="py-1.5 text-xs font-medium">
                                                {groupBy === "inv" ? "Purchase: " : "Party: "}
                                                <span className="font-mono">{row.label}</span>
                                                <span className="ml-2 font-normal text-muted-foreground">
                                                    {row.count} allocation{row.count !== 1 ? "s" : ""} · {rupee(row.total)}
                                                </span>
                                            </TableCell>
                                        </TableRow>
                                    ) : docRow(row.g),
                                )
                            )}
                        </TableBody>
                    </Table>
                </div>
                {/* <p className="flex-none text-[11px] text-muted-foreground leading-relaxed mt-1">
                    Each row is one allocation/dismissal, listed like a voucher with its <strong>payment voucher</strong> (the
                    courier debit) and <strong>source inventory voucher</strong> (the purchase/GRN). <strong>Click a row</strong> to
                    open its line items and edit them. <strong>Effective</strong> = the inward voucher date. One inward can be allocated
                    multiple times — a shipment&apos;s freight often comes in legs (vendor-to-airport, air cargo, local carrier) and they
                    <strong> add up</strong>; a product&apos;s current additional cost is the <em>sum of all legs on its latest inward</em>
                    (a newer purchase replaces an older one). Nothing here touches the accounts / Day Book.
                </p> */}
            </div>

            {/* Allocate — voucher-driven big dialog */}
            <AllocateVoucherDialog
                entry={allocEntry}
                onClose={() => setAllocEntry(null)}
                onDone={() => { void refresh(); }}
            />

            {/* Allocation/dismissal detail — edit line items */}
            <AllocationDetailDialog
                doc={detailDoc}
                onClose={() => setDetailDoc(null)}
                onDone={() => { void refresh(); }}
            />

            {/* Dismiss dialog */}
            <Dialog open={entry != null} onOpenChange={(o) => { if (!o) closeDismiss(); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Dismiss as office expense</DialogTitle>
                        <DialogDescription>
                            {entry ? (
                                <>
                                    {entry.ledgerName} · {entry.reference} · remaining{" "}
                                    <span className="font-semibold text-amber-700 dark:text-amber-300">{rupee(entry.remainingPaise)}</span>
                                    . The dismissed portion leaves the waiting list without touching any product.
                                </>
                            ) : null}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Amount to dismiss (₹)</label>
                            <div className="flex items-center gap-2">
                                <Input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9 font-mono" />
                                {entry ? (
                                    <Button type="button" variant="ghost" size="sm" className="h-9 whitespace-nowrap text-muted-foreground"
                                        onClick={() => setAmount((entry.remainingPaise / 100).toFixed(2))}>
                                        all
                                    </Button>
                                ) : null}
                            </div>
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Note (optional)</label>
                            <Input placeholder="e.g. office courier — not product freight" value={note} onChange={(e) => setNote(e.target.value)} className="h-9" />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="ghost" onClick={closeDismiss} disabled={submitting}>Cancel</Button>
                        <Button type="button" onClick={submitDismiss} disabled={submitting}>
                            {submitting ? "Saving…" : "Dismiss"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

// Compact inline stat pill for the summary strip.
function StatBadge({ label, value, tone }: { label: string; value: string; tone?: "violet" | "amber" | "muted" }) {
    const valueClass =
        tone === "violet" ? "text-violet-700 dark:text-violet-300"
            : tone === "amber" ? "text-amber-700 dark:text-amber-300"
                : tone === "muted" ? "text-muted-foreground"
                    : "text-foreground";
    return (
        <span className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span className={`font-mono font-semibold ${valueClass}`}>{value}</span>
        </span>
    );
}
