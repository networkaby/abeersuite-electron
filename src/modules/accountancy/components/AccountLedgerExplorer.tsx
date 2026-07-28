"use client";

// Master-detail account ledger explorer used by:
//   /office/accountancy/account-ledgers   — all GL accounts
//   /office/accountancy/cash-ledgers      — groupNames: ["Cash-in-Hand"]
//   /office/accountancy/bank-ledgers      — groupNames: ["Bank Accounts"]
//   /office/accountancy/loan-ledgers      — groupNames: ["Loans (Liability)", "Secured Loans", "Unsecured Loans"]
//
// Left panel: filtered list of accounts (search by name/code/group).
// Right panel: selected account's ledger with running balance, opening/closing
// pseudo-rows, source-voucher links. Uses /api/accountancy/reports/ledger/[id]
// (truth-path running balance) and /api/accountancy/ledgers (flat GL list).

import { useEffect, useState, useCallback, useMemo } from "react";
import axios from "axios";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
    Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
    BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useEscape } from "@/shared/hooks";
import { BookOpen, Loader2, RefreshCw, Printer, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { fmt } from "@/utils/constants";
import { formatDate } from "@/shared/lib/format/formatDate";
import { formatDrCr } from "@/shared/lib/format/moneyInr";
import { cn } from "@/shared/lib/format/utils";
import { EntityListPanel } from "@/shared/components/EntityListPanel";
import { BreadcrumbBar } from "@/shared/components/BreadcrumbBar";
import { indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { BookPage } from "@/modules/accountancy/components/BookPage";
import { CreateLedgerDialog } from "@/modules/accountancy/components/CreateLedgerDialog";
import { EditLedgerDialog, type EditableLedger } from "@/modules/accountancy/components/EditLedgerDialog";

// ── Types ────────────────────────────────────────────────────────────────────

type NormalBalance = "DEBIT" | "CREDIT";

interface LedgerListItem {
    id: number;
    name: string;
    code: string | null;
    normalBalance: NormalBalance | null;
    balance: number;
    isActive: boolean;
    group: { id: number; name: string; type: string } | null;
    _count: { lines: number };
    // Present on the flat GL list response (/api/accountancy/ledgers) but not
    // needed for the list/search UI — carried through so the Edit dialog can
    // be opened without a second fetch.
    bankJson?: unknown;
    loanJson?: unknown;
    creditCardJson?: unknown;
    openingBalance?: number | null;
    openingBalanceType?: NormalBalance | null;
    openingBalanceDate?: string | null;
}

interface SourceDoc {
    kind: "sale" | "purchase" | "estimate" | "invoice";
    id: number;
    reference?: string;
    number?: string;
    url: string;
}

interface LedgerRow {
    id: number;
    journalEntryId: number;
    date: string;
    reference: string;
    description: string;
    lineDescription: string | null;
    branchId: string | null;
    branchName: string | null;
    debit: number | null;
    credit: number | null;
    balance: number;
    source: SourceDoc | null;
}

interface LedgerDetail {
    account: {
        id: number; code: string | null; name: string;
        normalBalance: NormalBalance;
        groupId: number | null; groupName: string | null;
    };
    from: string;
    to: string;
    openingBalance: number;
    closingBalance: number;
    // Available draw against the sanctioned facility limit (Bank OD A/c /
    // Credit Card ledgers only) — null when not applicable or no limit set.
    availableLimit: number | null;
    rows: LedgerRow[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const SOURCE_COLOR: Record<SourceDoc["kind"], string> = {
    sale:     "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800",
    purchase: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800",
    estimate: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800",
    invoice:  "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800",
};

const drCr = formatDrCr;

// ── Props ────────────────────────────────────────────────────────────────────

export interface AccountLedgerExplorerProps {
    /** Title shown in the breadcrumb leaf (e.g. "Account Ledger", "Cash Book"). */
    title?: string;
    /** Title on the left panel header (defaults to {title} or "Accounts"). */
    panelTitle?: string;
    /** Icon shown on the left panel header. Defaults to BookOpen. */
    panelIcon?: React.ReactNode;
    /** Restrict the account list to accounts whose group.name is in this list.
     *  Match is case-insensitive. Omit to show all GL accounts. */
    groupNames?: string[];
    /** Empty-state copy when no accounts match the filter. */
    emptyMessage?: string;
    /** If provided, the right pane's empty state shows the matching BookPage
     *  report (opening / debits / credits / closing per ledger + totals)
     *  instead of "Select an account…". Row clicks select the account here.
     *  `groupName` should be the parent group when there are sub-groups (the
     *  report flattens descendants). */
    book?: {
        groupName: string;
        subtitle?: string;
    };
}

// ── Main component ───────────────────────────────────────────────────────────

export function AccountLedgerExplorer({
    title = "Account Ledger",
    panelTitle,
    panelIcon = <BookOpen size={15} className="text-primary" />,
    groupNames,
    emptyMessage,
    book,
}: AccountLedgerExplorerProps) {
    const router = useRouter();
    const params = useSearchParams();

    const [allAccounts, setAllAccounts] = useState<LedgerListItem[]>([]);
    const [createOpen, setCreateOpen] = useState(false);
    const [editOpen, setEditOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [selectedId, setSelectedId] = useState<number | null>(() => {
        const id = params.get("accountId");
        return id ? Number(id) : null;
    });
    const [detail, setDetail] = useState<LedgerDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    // Date params on the URL come from a drill-in (P&L, Balance Sheet, Trial Balance, …
    // pass ?accountId=&from=&to=). Honour them instead of always defaulting.
    const [from, setFrom] = useState(params.get("from") ?? toIsoDate(indianFiscalYearStart()));
    const [to, setTo] = useState(params.get("to") ?? toIsoDate(new Date()));

    const reloadAccounts = useCallback(() => {
        return axios
            .get<LedgerListItem[]>("/api/accountancy/ledgers?activeOnly=false")
            .then((r) => setAllAccounts(r.data))
            .catch(() => toast.error("Failed to load accounts"));
    }, []);

    useEffect(() => { reloadAccounts(); }, [reloadAccounts]);

    // Apply group-name filter once at the source (so totals/search work on the
    // already-restricted set). Case-insensitive to tolerate seed casing drift.
    const accounts = useMemo(() => {
        if (!groupNames || groupNames.length === 0) return allAccounts;
        const wanted = new Set(groupNames.map((n) => n.toLowerCase()));
        return allAccounts.filter((a) => a.group && wanted.has(a.group.name.toLowerCase()));
    }, [allAccounts, groupNames]);

    const loadDetail = useCallback((id: number, f: string, t: string) => {
        setDetailLoading(true);
        axios
            .get<LedgerDetail>(`/api/accountancy/reports/ledger/${id}?from=${f}&to=${t}`)
            .then((r) => setDetail(r.data))
            .catch(() => toast.error("Failed to load ledger"))
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

    // Keep ?accountId=… in sync with selection so links/refresh preserve state.
    useEffect(() => {
        const url = new URL(window.location.href);
        if (selectedId) url.searchParams.set("accountId", String(selectedId));
        else url.searchParams.delete("accountId");
        window.history.replaceState(null, "", url.toString());
    }, [selectedId]);

    const handleRefresh = useCallback(() => {
        if (selectedId) loadDetail(selectedId, from, to);
    }, [selectedId, from, to, loadDetail]);

    useEscape(() => {
        if (selectedId) setSelectedId(null);
        else router.back();
    });

    const filtered = useMemo(() => {
        if (!search) return accounts;
        const q = search.toLowerCase();
        return accounts.filter(
            (a) =>
                a.name.toLowerCase().includes(q) ||
                (a.code ?? "").toLowerCase().includes(q) ||
                (a.group?.name ?? "").toLowerCase().includes(q),
        );
    }, [accounts, search]);

    // Derived totals for the stat row (period debit/credit + net movement)
    const periodDebit = detail?.rows.reduce((s, r) => s + (r.debit ?? 0), 0) ?? 0;
    const periodCredit = detail?.rows.reduce((s, r) => s + (r.credit ?? 0), 0) ?? 0;
    const netMovement = detail ? detail.closingBalance - detail.openingBalance : 0;

    // The flat GL list (allAccounts) carries bankJson/openingBalance fields
    // the ledger-detail report doesn't return — look the selected account up
    // there so Edit opens pre-filled without a second fetch.
    const editSource = selectedId ? allAccounts.find((a) => a.id === selectedId) : undefined;
    const editTarget: EditableLedger | null = editSource
        ? {
            id: editSource.id,
            name: editSource.name,
            groupId: editSource.group?.id ?? null,
            bankJson: editSource.bankJson,
            loanJson: editSource.loanJson,
            creditCardJson: editSource.creditCardJson,
            openingBalance: editSource.openingBalance,
            openingBalanceType: editSource.openingBalanceType,
        }
        : null;

    return (
        <div className="flex h-full flex-col overflow-hidden bg-card">
            {/* Breadcrumb bar */}
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
                            {selectedId && detail ? (
                                <BreadcrumbLink asChild>
                                    <button type="button" onClick={() => setSelectedId(null)} className="transition-colors hover:text-foreground">
                                        {title}
                                    </button>
                                </BreadcrumbLink>
                            ) : (
                                <BreadcrumbPage>{title}</BreadcrumbPage>
                            )}
                        </BreadcrumbItem>
                        {selectedId && detail && (
                            <>
                                <BreadcrumbSeparator />
                                <BreadcrumbItem>
                                    <BreadcrumbPage>{detail.account.name}</BreadcrumbPage>
                                </BreadcrumbItem>
                            </>
                        )}
                    </BreadcrumbList>
                </Breadcrumb>
            </BreadcrumbBar>

            {/* Master-detail row */}
            <div className="flex flex-1 overflow-hidden">
                <EntityListPanel
                    title={panelTitle ?? title}
                    icon={panelIcon}
                    count={accounts.length}
                    search={search}
                    onSearchChange={setSearch}
                    searchPlaceholder="Search name, code, or group…"
                    onAdd={() => setCreateOpen(true)}
                    addLabel="Create"
                    onTitleClick={selectedId ? () => setSelectedId(null) : undefined}
                    isEmpty={filtered.length === 0}
                    emptyMessage={search ? "No matches" : (emptyMessage ?? "No accounts")}
                >
                    {filtered.map((a) => (
                        <button
                            key={a.id}
                            type="button"
                            onClick={() => setSelectedId(a.id)}
                            className={cn(
                                "w-full text-left border-b px-4 py-3 transition-colors hover:bg-muted/50",
                                selectedId === a.id
                                    ? "bg-primary/10 border-l-2 border-l-primary"
                                    : "border-l-2 border-l-transparent",
                                !a.isActive && "opacity-50",
                            )}
                        >
                            <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{a.name}</p>
                                {/* Group + balance share the second line; the balance
                                    breaks onto its own line here instead of being clipped
                                    when the name/group is long. */}
                                <div className="mt-0.5 flex items-center justify-between gap-2">
                                    <p className="truncate text-xs text-muted-foreground">
                                        {a.group?.name ?? "Ungrouped"}
                                    </p>
                                    <span
                                        className={cn(
                                            "shrink-0 rounded px-1.5 py-0.5 text-xs font-mono font-medium",
                                            a.balance === 0
                                                ? "bg-muted text-muted-foreground"
                                                : a.balance < 0
                                                    ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                                                    : "bg-muted text-foreground",
                                        )}
                                    >
                                        {drCr(a.balance, a.normalBalance)}
                                    </span>
                                </div>
                            </div>
                        </button>
                    ))}
                </EntityListPanel>

                {/* ── Right section: account detail ── */}
                <section className="flex flex-1 flex-col overflow-hidden bg-muted/30">
                    {!selectedId && (
                        book ? (
                            <div className="flex-1 overflow-auto">
                                <BookPage
                                    title={title}
                                    subtitle={book.subtitle ?? `All ${title.toLowerCase()} ledgers with period totals — click any row to drill in.`}
                                    groupName={book.groupName}
                                    autoSingle={false}
                                    compact
                                    onSelectLedger={(id) => setSelectedId(id)}
                                />
                            </div>
                        ) : (
                            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
                                <BookOpen size={40} strokeWidth={1} />
                                <p className="text-sm">Select an account to view its ledger</p>
                            </div>
                        )
                    )}

                    {selectedId && detailLoading && (
                        <div className="flex flex-1 items-center justify-center text-muted-foreground">
                            <Loader2 size={22} className="animate-spin" />
                        </div>
                    )}

                    {selectedId && !detailLoading && detail && (
                        <>
                            {/* Account summary strip */}
                            <div className="border-b bg-card px-6 py-4">
                                <div className="flex items-start justify-between gap-4 flex-wrap">
                                    <div>
                                        <h2 className="text-lg font-bold leading-tight">{detail.account.name}</h2>
                                        {detail.account.code && (
                                            <p className="font-mono text-xs text-muted-foreground mt-0.5">{detail.account.code}</p>
                                        )}
                                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                                            {detail.account.groupName && (
                                                <Link
                                                    href={`/office/accountancy/masters/groups/${detail.account.groupId}`}
                                                    className="inline-block"
                                                >
                                                    <Badge variant="secondary" className="text-xs hover:bg-secondary/80">
                                                        {detail.account.groupName}
                                                    </Badge>
                                                </Link>
                                            )}
                                            <Badge variant="outline" className="text-xs">
                                                Normal: {detail.account.normalBalance}
                                            </Badge>
                                        </div>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 px-2.5 text-xs"
                                        onClick={() => setEditOpen(true)}
                                    >
                                        <Pencil size={12} className="mr-1" />
                                        Edit
                                    </Button>
                                </div>

                                {/* Stat row — 5 columns when this is a Bank OD A/c / Credit Card
                                    ledger with a limit set (adds "Available"), else 4. */}
                                <div className={`mt-4 grid grid-cols-2 gap-3 ${detail.availableLimit != null ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
                                    <StatBox label="Opening" value={drCr(detail.openingBalance, detail.account.normalBalance)} />
                                    <StatBox label="Period Debit" value={periodDebit ? fmt(periodDebit) : "—"} />
                                    <StatBox label="Period Credit" value={periodCredit ? fmt(periodCredit) : "—"} />
                                    <StatBox
                                        label="Closing"
                                        value={drCr(detail.closingBalance, detail.account.normalBalance)}
                                        emphasis
                                        sub={netMovement !== 0
                                            ? `${netMovement > 0 ? "+" : ""}${fmt(netMovement)} net`
                                            : undefined}
                                    />
                                    {detail.availableLimit != null && (
                                        <StatBox
                                            label="Available"
                                            value={fmt(detail.availableLimit)}
                                            warn={detail.availableLimit < 0}
                                            sub={detail.availableLimit < 0 ? "over limit" : undefined}
                                        />
                                    )}
                                </div>
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
                                            onValueChange={(v) => { setFrom(v); if (selectedId) loadDetail(selectedId, v, to); }}
                                            className="h-7 w-36 text-xs"
                                        />
                                        <label className="text-xs text-muted-foreground">To</label>
                                        <TallyDateInput
                                            value={to}
                                            onValueChange={(v) => { setTo(v); if (selectedId) loadDetail(selectedId, from, v); }}
                                            monthMode="end"
                                            className="h-7 w-36 text-xs"
                                        />
                                        <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={handleRefresh}>
                                            <RefreshCw size={12} className="mr-1" />
                                            Refresh
                                        </Button>
                                        <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => window.print()}>
                                            <Printer size={12} />
                                        </Button>
                                    </div>
                                </div>

                                {/* Table */}
                                <div className="flex-1 overflow-auto">
                                    <table className="w-full text-sm">
                                        <thead className="sticky top-0 z-10">
                                            <tr className="bg-muted/60 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                                                <th className="px-4 py-2 text-left font-medium">Date</th>
                                                <th className="px-4 py-2 text-left font-medium">Voucher</th>
                                                <th className="px-4 py-2 text-left font-medium">Description</th>
                                                <th className="px-4 py-2 text-left font-medium">Branch</th>
                                                <th className="px-4 py-2 text-right font-medium">Debit</th>
                                                <th className="px-4 py-2 text-right font-medium">Credit</th>
                                                <th className="px-4 py-2 text-right font-medium">Balance</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                            {/* Opening balance pseudo-row */}
                                            <tr className="bg-muted/30 text-xs">
                                                <td className="px-4 py-2 text-muted-foreground" colSpan={4}>
                                                    Opening balance
                                                </td>
                                                <td className="px-4 py-2" />
                                                <td className="px-4 py-2" />
                                                <td className="px-4 py-2 text-right font-mono font-semibold">
                                                    {drCr(detail.openingBalance, detail.account.normalBalance)}
                                                </td>
                                            </tr>

                                            {detail.rows.length === 0 ? (
                                                <tr>
                                                    <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground text-sm">
                                                        No transactions in this period
                                                    </td>
                                                </tr>
                                            ) : detail.rows.map((row) => (
                                                <tr
                                                    key={row.id}
                                                    className="hover:bg-muted/40 transition-colors"
                                                >
                                                    <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                                                        {formatDate(row.date)}
                                                    </td>
                                                    <td className="px-4 py-2.5">
                                                        {row.source ? (
                                                            <Link
                                                                href={row.source.url}
                                                                className={`inline-block text-xs px-2 py-0.5 border rounded-sm font-mono font-medium hover:underline ${SOURCE_COLOR[row.source.kind]}`}
                                                            >
                                                                {row.source.reference ?? row.source.number}
                                                            </Link>
                                                        ) : (
                                                            <span className="font-mono text-xs text-muted-foreground">{row.reference}</span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-2.5">
                                                        <p className="text-sm">{row.description}</p>
                                                        {row.lineDescription && (
                                                            <p className="text-xs text-muted-foreground">{row.lineDescription}</p>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                                                        {row.branchName ?? <span className="text-muted-foreground/40">—</span>}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                                                        {row.debit != null ? fmt(row.debit) : <span className="text-muted-foreground/40">—</span>}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                                                        {row.credit != null ? fmt(row.credit) : <span className="text-muted-foreground/40">—</span>}
                                                    </td>
                                                    <td className={cn(
                                                        "px-4 py-2.5 text-right font-mono text-xs font-semibold",
                                                        row.balance < 0 && "text-destructive",
                                                    )}>
                                                        {drCr(row.balance, detail.account.normalBalance)}
                                                    </td>
                                                </tr>
                                            ))}

                                            {/* Closing balance pseudo-row */}
                                            {detail.rows.length > 0 && (
                                                <tr className="bg-muted/30 text-xs">
                                                    <td className="px-4 py-2 text-muted-foreground font-medium" colSpan={4}>
                                                        Closing balance
                                                    </td>
                                                    <td className="px-4 py-2 text-right font-mono font-semibold">
                                                        {periodDebit ? fmt(periodDebit) : ""}
                                                    </td>
                                                    <td className="px-4 py-2 text-right font-mono font-semibold">
                                                        {periodCredit ? fmt(periodCredit) : ""}
                                                    </td>
                                                    <td className="px-4 py-2 text-right font-mono font-semibold text-primary">
                                                        {drCr(detail.closingBalance, detail.account.normalBalance)}
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </>
                    )}
                </section>
            </div>

            {/* Create-ledger dialog (replaces the old "Manage" navigation) */}
            <CreateLedgerDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                onCreated={(acc) => {
                    reloadAccounts();
                    setSelectedId(acc.id);
                }}
            />

            {/* Edit-ledger dialog — opened from the account summary strip. */}
            <EditLedgerDialog
                open={editOpen}
                onOpenChange={setEditOpen}
                ledger={editTarget}
                onSaved={() => {
                    reloadAccounts();
                    if (selectedId) loadDetail(selectedId, from, to);
                }}
            />
        </div>
    );
}

// ── StatBox helper ───────────────────────────────────────────────────────────

function StatBox({
    label,
    value,
    sub,
    emphasis = false,
    warn = false,
}: {
    label: string;
    value: string;
    sub?: string;
    emphasis?: boolean;
    /** Styles the value as a destructive warning — e.g. usage past a facility limit. */
    warn?: boolean;
}) {
    return (
        <div className={cn(
            "rounded-lg border px-3 py-2.5",
            warn ? "border-destructive/30 bg-destructive/5" : emphasis ? "border-primary/30 bg-primary/5" : "border-border bg-background",
        )}>
            <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
            <p className={cn("text-sm font-semibold font-mono", warn ? "text-destructive" : emphasis && "text-primary")}>{value}</p>
            {sub && <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">{sub}</p>}
        </div>
    );
}
