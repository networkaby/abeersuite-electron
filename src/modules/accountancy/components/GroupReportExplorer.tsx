"use client";

// Group Report — the Cash Book layout, but the unit is an account *group*
// instead of a ledger.
//   Left panel : every group in the chart, searchable, with its rolled-up
//                closing balance (the group plus everything nested under it).
//   Right pane : nothing selected → all groups with opening / debit / credit /
//                closing for the period (same shape as Cash Book's table);
//                a group selected → that group's sub-groups and ledgers, with
//                a row click drilling into the ledger register.
//
// One read feeds the whole screen: /api/accountancy/reports/trial-balance
// already returns the group tree with rolled-up period figures, so there is no
// new API, no query-per-group, and the numbers agree with Trial Balance by
// construction — the same signing rule (amount signed against the group's own
// nature, Dr/Cr suffix from the sign) is used here.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useApiResource } from "@/shared/hooks/useApiResource";
import { ChevronRight, FolderTree, Loader2 } from "lucide-react";
import {
    Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
    BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { fmt } from "@/shared/lib/format/moneyInr";
import { cn } from "@/shared/lib/format/utils";
import { groupColor } from "@/shared/lib/format/groupColor";
import { moduleTableHeadStyle } from "@/shared/lib/format/moduleTheme";
import { BreadcrumbBar } from "@/shared/components/BreadcrumbBar";
import { EntityListPanel } from "@/shared/components/EntityListPanel";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { accountLedgerUrl } from "@/modules/accountancy/lib/accountLedgerUrl";
import { groupReportUrl } from "@/modules/accountancy/lib/groupReportUrl";
import { defaultNormalBalanceForGroupType } from "@/modules/accountancy/lib/groupNature";
import { formatDateInput, indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { useEscape } from "@/shared/hooks";

// ── Types ────────────────────────────────────────────────────────────────────

type Side = "DEBIT" | "CREDIT";
type GroupTypeStr = "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE";

interface LedgerNode {
    id: number;
    name: string;
    normalBalance: Side | null;
    opening: number;
    debits: number;
    credits: number;
    closing: number;
}

interface GroupNode {
    id: number;
    name: string;
    type: GroupTypeStr;
    children: GroupNode[];
    ledgers: LedgerNode[];
    rolledUpOpening: number;
    rolledUpDebits: number;
    rolledUpCredits: number;
    rolledUpClosing: number;
}

interface TBData {
    tree: GroupNode[];
    totals: { opening: number; debits: number; credits: number; closing: number };
}

/** One group, flattened for the left panel and the summary table. */
interface GroupRow {
    id: number;
    name: string;
    type: GroupTypeStr;
    depth: number;
    /** Name of the group it sits under — shown as the colour pill. */
    parentName: string | null;
    ledgerCount: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function countLedgers(node: GroupNode): number {
    return node.ledgers.length + node.children.reduce((s, c) => s + countLedgers(c), 0);
}

/** Depth-first walk so the list reads in chart order: a parent, then its children. */
function flattenGroups(nodes: GroupNode[], depth = 0, parentName: string | null = null): GroupRow[] {
    const out: GroupRow[] = [];
    for (const n of nodes) {
        out.push({
            id: n.id,
            name: n.name,
            type: n.type,
            depth,
            parentName,
            ledgerCount: countLedgers(n),
        });
        out.push(...flattenGroups(n.children, depth + 1, n.name));
    }
    return out;
}

function findGroup(nodes: GroupNode[], id: number): GroupNode | null {
    for (const n of nodes) {
        if (n.id === id) return n;
        const found = findGroup(n.children, id);
        if (found) return found;
    }
    return null;
}

/** Zeros are noise in a totals column — show a dash instead. */
function plain(n: number) {
    return Math.abs(n) < 0.005 ? <span className="text-muted-foreground/65">—</span> : fmt(n);
}

/** Opening / Closing carry a side. Positive sits on the group's own side, a
 *  negative one has swung to the other side — same rule as Trial Balance. */
function sided(value: number, normalSide: Side) {
    if (Math.abs(value) < 0.005) return <span className="text-muted-foreground/65">—</span>;
    const side = value > 0 ? normalSide : (normalSide === "DEBIT" ? "CREDIT" : "DEBIT");
    return (
        <>
            {fmt(Math.abs(value))}{" "}
            <span className="font-normal text-muted-foreground">{side === "DEBIT" ? "Dr" : "Cr"}</span>
        </>
    );
}

// ── Component ────────────────────────────────────────────────────────────────

export function GroupReportExplorer() {
    const router = useRouter();
    const urlParams = useSearchParams();
    const fyStart = indianFiscalYearStart();

    // The period can arrive in the link — a drill-in from Balance Sheet carries
    // `asOf` (a point in time, so it becomes the closing date), P&L and Trial
    // Balance carry `from`/`to`. Read once; after that the date inputs own it.
    const [from, setFrom] = useState(() => urlParams.get("from") ?? formatDateInput(fyStart));
    const [to, setTo]     = useState(() => urlParams.get("to") ?? urlParams.get("asOf") ?? formatDateInput(new Date()));
    // A change of dates, and a live update, keep the table on screen while it
    // re-reads (keepPrevious) — they must not blank a report someone is reading —
    // and a reply for dates the screen has already left is dropped. Every voucher
    // moves some group's figures, so the report follows the floor instead of
    // waiting for someone to press Refresh.
    const { data = null, refreshing, error, reload } = useApiResource<TBData>(
        `/api/accountancy/reports/trial-balance?from=${from}&to=${to}`,
        { topics: ["ledger"], keepPrevious: true },
    );
    useEffect(() => { if (error) toast.error("Failed to load Group Report"); }, [error]);
    const [search, setSearch] = useState("");

    // The selected group lives in the URL, not in state: that is what makes the
    // screen linkable (every group drill-in lands here), and it gives back and
    // forward the behaviour people expect for free.
    const selectedId = Number(urlParams.get("group")) || null;
    const select = useCallback(
        (id: number | null) => { router.replace(groupReportUrl(id, { from, to })); },
        [router, from, to],
    );

    useEscape(() => {
        if (selectedId) select(null);
        else router.back();
    });

    // Nothing has arrived yet ⇒ first paint, which is the only time the table is
    // allowed to be absent. Afterwards a re-read keeps the old table on screen.
    const loading = data === null;
    const tree = data?.tree ?? null;
    const rows = useMemo(() => (tree ? flattenGroups(tree) : []), [tree]);

    const filtered = useMemo(() => {
        if (!search) return rows;
        const q = search.toLowerCase();
        return rows.filter(
            (g) => g.name.toLowerCase().includes(q) || (g.parentName ?? "").toLowerCase().includes(q),
        );
    }, [rows, search]);

    const nodeById = useCallback(
        (id: number) => (tree ? findGroup(tree, id) : null),
        [tree],
    );

    const selected = useMemo(
        () => (selectedId ? nodeById(selectedId) : null),
        [selectedId, nodeById],
    );

    const selectedSide: Side = selected ? defaultNormalBalanceForGroupType(selected.type) : "DEBIT";

    // Note: Stock-in-Hand needs no special case here. The old detail page had to
    // bounce it to the stock summary because its API knew nothing about stock;
    // the trial-balance read behind this screen synthesises Closing Stock (live),
    // so the group shows its real figure like any other.

    // ── Selected group: its sub-groups as labelled blocks, then its own ledgers ──
    const renderDetailRows = (node: GroupNode, depth: number): React.ReactNode[] => {
        const out: React.ReactNode[] = [];
        const pad = 12 + depth * 14;

        for (const child of node.children) {
            if (countLedgers(child) === 0) continue;
            const gc = groupColor(child.name);
            const side = defaultNormalBalanceForGroupType(child.type);
            out.push(
                <tr key={`h-${child.id}`} className={`border-t ${gc.bg}`}>
                    <td style={{ paddingLeft: pad }} className={`py-1.5 pr-3 text-[11px] font-semibold uppercase tracking-wider ${gc.text}`}>
                        <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${gc.bar} align-middle`} />
                        {child.name}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs">{sided(child.rolledUpOpening, side)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs">{plain(child.rolledUpDebits)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs">{plain(child.rolledUpCredits)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs font-semibold">{sided(child.rolledUpClosing, side)}</td>
                    <td />
                </tr>,
            );
            out.push(...renderDetailRows(child, depth + 1));
        }

        // Ledger figures are signed against their group's nature (the report
        // re-signs contra ledgers), so the group's side reads them correctly.
        const side = defaultNormalBalanceForGroupType(node.type);
        for (const l of [...node.ledgers].sort((a, b) => a.name.localeCompare(b.name))) {
            out.push(
                <tr
                    key={`l-${l.id}`}
                    className="cursor-pointer border-t hover:bg-muted/40"
                    onClick={() => router.push(accountLedgerUrl(l.id, { from, to }))}
                >
                    <td style={{ paddingLeft: pad }} className="py-2.5 pr-3 font-medium text-foreground">{l.name}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{sided(l.opening, side)}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{plain(l.debits)}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{plain(l.credits)}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold">{sided(l.closing, side)}</td>
                    <td className="px-3 py-2.5 text-muted-foreground"><ChevronRight size={14} /></td>
                </tr>,
            );
        }

        return out;
    };

    const dateBar = (
        <div className="flex items-end gap-2">
            <div className="space-y-1">
                <Label>From</Label>
                <TallyDateInput value={from} onValueChange={setFrom} className="w-auto" />
            </div>
            <div className="space-y-1">
                <Label>To</Label>
                <TallyDateInput value={to} onValueChange={setTo} monthMode="end" className="w-auto" />
            </div>
            <Button onClick={reload} disabled={refreshing}>
                {refreshing && <Loader2 size={14} className="animate-spin" />} Refresh
            </Button>
        </div>
    );

    return (
        <div className="flex h-full flex-col overflow-hidden bg-card">
            <BreadcrumbBar>
                <Breadcrumb>
                    <BreadcrumbList>
                        <BreadcrumbItem>
                            <BreadcrumbLink asChild>
                                <Link href="/office/accountancy">Accountancy</Link>
                            </BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                            {selected ? (
                                <BreadcrumbLink asChild>
                                    <button type="button" onClick={() => select(null)} className="transition-colors hover:text-foreground">
                                        Group Report
                                    </button>
                                </BreadcrumbLink>
                            ) : (
                                <BreadcrumbPage>Group Report</BreadcrumbPage>
                            )}
                        </BreadcrumbItem>
                        {selected && (
                            <>
                                <BreadcrumbSeparator />
                                <BreadcrumbItem><BreadcrumbPage>{selected.name}</BreadcrumbPage></BreadcrumbItem>
                            </>
                        )}
                    </BreadcrumbList>
                </Breadcrumb>
            </BreadcrumbBar>

            <div className="flex flex-1 overflow-hidden">
                <EntityListPanel
                    title="Account Groups"
                    icon={<FolderTree size={15} className="text-primary" />}
                    count={rows.length}
                    search={search}
                    onSearchChange={setSearch}
                    searchPlaceholder="Search group or parent…"
                    onTitleClick={selectedId ? () => select(null) : undefined}
                    isEmpty={filtered.length === 0}
                    emptyMessage={search ? "No matches" : "No groups"}
                >
                    {filtered.map((g) => {
                        const gc = groupColor(g.parentName ?? g.name);
                        const node = nodeById(g.id);
                        const closing = node?.rolledUpClosing ?? 0;
                        return (
                            <button
                                key={g.id}
                                type="button"
                                onClick={() => select(g.id)}
                                className={cn(
                                    "w-full border-b px-4 py-3 text-left transition-colors hover:bg-muted/50",
                                    selectedId === g.id
                                        ? "border-l-2 border-l-primary bg-primary/10"
                                        : "border-l-2 border-l-transparent",
                                )}
                            >
                                {/* Indent mirrors the chart of accounts, so a sub-group
                                    reads as sitting under its parent. Search keeps the
                                    indent — a matched sub-group stays recognisable. */}
                                <div className="min-w-0" style={{ paddingLeft: g.depth * 12 }}>
                                    <p className="truncate text-sm font-medium">{g.name}</p>
                                    <div className="mt-0.5 flex items-center justify-between gap-2">
                                        <span className={cn("truncate rounded px-1.5 py-0.5 text-[11px] font-medium", gc.bg, gc.text)}>
                                            {g.parentName ?? "Primary"}
                                        </span>
                                        <span
                                            className={cn(
                                                "shrink-0 rounded px-1.5 py-0.5 font-mono text-xs font-medium",
                                                Math.abs(closing) < 0.005
                                                    ? "bg-muted text-muted-foreground"
                                                    : "bg-muted text-foreground",
                                            )}
                                        >
                                            {sided(closing, defaultNormalBalanceForGroupType(g.type))}
                                        </span>
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </EntityListPanel>

                <section className="flex flex-1 flex-col overflow-hidden bg-muted/30">
                    <div className="flex-1 overflow-auto">
                        <div className="space-y-4 p-6">
                            <div className="flex flex-wrap items-end justify-between gap-3">
                                <div>
                                    <h1 className="text-2xl font-bold text-foreground">
                                        {selected ? selected.name : "Group Report"}
                                    </h1>
                                    <p className="mt-0.5 text-sm text-muted-foreground">
                                        {selected
                                            ? `Sub-groups and ledgers under ${selected.name} — pick one to see its register.`
                                            : "Every account group with period totals — pick one to see what is inside."}
                                    </p>
                                </div>
                                {dateBar}
                            </div>

                            {loading && (
                                <div className="flex justify-center py-20">
                                    <Loader2 className="animate-spin text-muted-foreground" size={28} />
                                </div>
                            )}

                            {!loading && rows.length === 0 && (
                                <div className="rounded-lg border border-border bg-card py-12 text-center text-sm text-muted-foreground shadow-sm">
                                    No account groups found.
                                </div>
                            )}

                            {!loading && rows.length > 0 && (
                                <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                                    <table className="w-full text-sm">
                                        <thead className="text-xs text-muted-foreground" style={moduleTableHeadStyle("accountancy")}>
                                            <tr>
                                                <th className="px-3 py-2 text-left font-medium">{selected ? "Ledger" : "Group"}</th>
                                                <th className="px-3 py-2 text-right font-medium">Opening</th>
                                                <th className="px-3 py-2 text-right font-medium">Debit</th>
                                                <th className="px-3 py-2 text-right font-medium">Credit</th>
                                                <th className="px-3 py-2 text-right font-medium">Closing</th>
                                                <th className="w-8 px-3 py-2" />
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {selected
                                                ? renderDetailRows(selected, 0)
                                                : rows.map((g) => {
                                                    const node = nodeById(g.id);
                                                    if (!node) return null;
                                                    const side = defaultNormalBalanceForGroupType(g.type);
                                                    return (
                                                        <tr
                                                            key={g.id}
                                                            className="cursor-pointer border-t hover:bg-muted/40"
                                                            onClick={() => select(g.id)}
                                                        >
                                                            <td
                                                                style={{ paddingLeft: 12 + g.depth * 14 }}
                                                                className={cn("py-2.5 pr-3", g.depth === 0 ? "font-semibold text-foreground" : "text-foreground")}
                                                            >
                                                                {g.name}
                                                                {g.ledgerCount > 0 && (
                                                                    <span className="ml-1.5 text-xs text-muted-foreground">({g.ledgerCount})</span>
                                                                )}
                                                            </td>
                                                            <td className="px-3 py-2.5 text-right font-mono">{sided(node.rolledUpOpening, side)}</td>
                                                            <td className="px-3 py-2.5 text-right font-mono">{plain(node.rolledUpDebits)}</td>
                                                            <td className="px-3 py-2.5 text-right font-mono">{plain(node.rolledUpCredits)}</td>
                                                            <td className="px-3 py-2.5 text-right font-mono font-semibold">{sided(node.rolledUpClosing, side)}</td>
                                                            <td className="px-3 py-2.5 text-muted-foreground"><ChevronRight size={14} /></td>
                                                        </tr>
                                                    );
                                                })}
                                            {selected && countLedgers(selected) === 0 && (
                                                <tr>
                                                    <td colSpan={6} className="px-3 py-10 text-center text-sm text-muted-foreground">
                                                        No ledgers under this group.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                        <tfoot className="border-t-2 border-border bg-muted/40 font-semibold">
                                            <tr>
                                                {/* On the all-groups view only the movement columns
                                                    are totalled: Opening and Closing are Dr and Cr
                                                    amounts of different groups, so a single number
                                                    there means nothing (Trial Balance is the screen
                                                    that splits them into Dr and Cr sides). */}
                                                <td className="px-3 py-2.5">Total</td>
                                                <td className="px-3 py-2.5 text-right font-mono">
                                                    {selected ? sided(selected.rolledUpOpening, selectedSide) : <span className="text-muted-foreground/65">—</span>}
                                                </td>
                                                <td className="px-3 py-2.5 text-right font-mono">
                                                    {plain(selected ? selected.rolledUpDebits : (data?.totals.debits ?? 0))}
                                                </td>
                                                <td className="px-3 py-2.5 text-right font-mono">
                                                    {plain(selected ? selected.rolledUpCredits : (data?.totals.credits ?? 0))}
                                                </td>
                                                <td className="px-3 py-2.5 text-right font-mono">
                                                    {selected ? sided(selected.rolledUpClosing, selectedSide) : <span className="text-muted-foreground/65">—</span>}
                                                </td>
                                                <td />
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}
