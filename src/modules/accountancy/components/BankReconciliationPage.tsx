"use client";

// Bank Reconciliation — the bank's statement against the bank ledger.
//
// Left: what the bank says (statement lines, uploaded). Right: what the books
// say (this ledger's posted GL legs). Auto-match pairs the obvious ones; ticking
// lines on both sides and pressing Match ties the rest, many-to-many, as long
// as the two sides total the same. A statement line nobody can explain is
// booked right here ("Book it" opens the real voucher form pre-filled, and the
// new voucher is matched to the line the moment it is saved).
//
// The strip on top is the reconciliation statement: balance as per books,
// adjusted by what each side has not seen yet, against the bank's own closing
// balance. The lock (Reconciled upto) advances only when every statement line
// up to that date is matched — the bank is the truth.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { CheckCircle2, Landmark, Link2, Loader2, Lock, RefreshCw, Sparkles, Trash2, Unlink, Upload, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { fmt } from "@/utils/constants";
import { formatDate } from "@/shared/lib/format/formatDate";
import { cn } from "@/shared/lib/format/utils";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { useApiResource } from "@/shared/hooks/useApiResource";
import { useClientPagination } from "@/shared/hooks/useClientPagination";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { PaginationBar } from "@/shared/components/PaginationBar";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import GlVoucherDialog, { type GlDialogKind } from "@/shared/components/GlVoucherDialog";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import { moduleTableHeadStyle } from "@/shared/lib/format/moduleTheme";
import { indianFiscalYearStart, formatDateInput } from "@/modules/accountancy/lib/period";
import { accountLedgerUrl } from "@/modules/accountancy/lib/accountLedgerUrl";
import { stashDuplicate } from "@/modules/accountancy/lib/duplicate";
import { ReconciledBadge } from "./ReconciledBadge";
import { BankStatementImportDialog } from "./BankStatementImportDialog";
import type { ReconPayload, StatementLineView, GlLineView } from "@/modules/accountancy/lib/bankReconciliation";

// ── Ledger picker data (the Trial Balance tree, like BookPage) ───────────────
type LedgerNode = { id: number; name: string; closing: number };
type GroupNode = { id: number; name: string; children: GroupNode[]; ledgers: LedgerNode[] };
type TBData = { tree: GroupNode[] };
const BANK_GROUPS = ["Bank Accounts", "Bank OD A/c"];

function findGroup(nodes: GroupNode[], name: string): GroupNode | null {
    for (const n of nodes) {
        if (n.name === name) return n;
        const f = findGroup(n.children, name);
        if (f) return f;
    }
    return null;
}
function flatten(node: GroupNode): LedgerNode[] {
    return [...node.ledgers, ...node.children.flatMap(flatten)];
}

type Filter = "unmatched" | "matched" | "all";

function money(n: number | null | undefined) {
    return n == null || n === 0 ? <span className="text-muted-foreground/60">—</span> : fmt(n);
}

export function BankReconciliationPage() {
    const search = useSearchParams();
    const today = formatDateInput(new Date());
    const [selectedId, setSelectedId] = useState<number | null>(() => {
        const q = Number(search.get("account"));
        return Number.isInteger(q) && q > 0 ? q : null;
    });
    const [from, setFrom] = useState(formatDateInput(indianFiscalYearStart()));
    const [to, setTo] = useState(today);
    const [windowDays, setWindowDays] = useState(7);
    const [filter, setFilter] = useState<Filter>("unmatched");
    const [selSt, setSelSt] = useState<Set<number>>(new Set());
    const [selGl, setSelGl] = useState<Set<number>>(new Set());
    const [busy, setBusy] = useState<string | null>(null);
    const [importOpen, setImportOpen] = useState(false);
    const [bookKind, setBookKind] = useState<GlDialogKind | null>(null);
    const [bookingLine, setBookingLine] = useState<StatementLineView | null>(null);

    // Bank ledgers — one Trial Balance read, the same source Bank Book uses.
    const ledgersQ = useApiResource<TBData>(`/api/accountancy/reports/trial-balance?from=${from}&to=${to}`);
    const ledgers = useMemo(() => {
        if (!ledgersQ.data) return null;
        const out: LedgerNode[] = [];
        for (const g of BANK_GROUPS) {
            const node = findGroup(ledgersQ.data.tree, g);
            if (node) out.push(...flatten(node));
        }
        return out.sort((a, b) => a.name.localeCompare(b.name));
    }, [ledgersQ.data]);
    useEffect(() => {
        if (selectedId == null && ledgers && ledgers.length > 0) setSelectedId(ledgers[0].id);
    }, [ledgers, selectedId]);

    const url = selectedId ? `/api/accountancy/bank-reconciliation/${selectedId}?from=${from}&to=${to}` : null;
    const { data, loading, refreshing, error, reload } = useApiResource<ReconPayload>(url);
    useRealtimeTopics(["ledger"], () => { if (url) reload(); });

    // Start the period at the lock the first time a ledger loads — that is
    // where the work is. The user can widen it afterwards.
    const [lockAppliedFor, setLockAppliedFor] = useState<number | null>(null);
    useEffect(() => {
        if (!data || lockAppliedFor === data.account.id) return;
        setLockAppliedFor(data.account.id);
        if (data.account.lock && data.account.lock > from) setFrom(data.account.lock);
        setSelSt(new Set()); setSelGl(new Set());
    }, [data, lockAppliedFor, from]);

    // ── Rows ───────────────────────────────────────────────────────────────
    const stRows = useMemo(() => {
        const all = data?.statementLines ?? [];
        if (filter === "all") return all;
        return all.filter((r) => (filter === "matched") === (r.match != null && !r.match.stale));
    }, [data, filter]);
    const glRows = useMemo(() => {
        const all = data?.glLines ?? [];
        if (filter === "all") return all;
        return all.filter((r) => (filter === "matched") === (r.match != null));
    }, [data, filter]);
    const stPage = useClientPagination(stRows, 50);
    const glPage = useClientPagination(glRows, 50);

    const stTotal = useMemo(() => {
        let s = 0;
        for (const r of data?.statementLines ?? []) if (selSt.has(r.id)) s += (r.deposit ?? 0) - (r.withdrawal ?? 0);
        return Math.round(s * 100) / 100;
    }, [data, selSt]);
    const glTotal = useMemo(() => {
        let s = 0;
        for (const r of data?.glLines ?? []) if (selGl.has(r.id)) s += (r.debit ?? 0) - (r.credit ?? 0);
        return Math.round(s * 100) / 100;
    }, [data, selGl]);
    const canMatch = selSt.size > 0 && selGl.size > 0 && Math.abs(stTotal - glTotal) < 0.005;

    const toggle = (set: Set<number>, id: number) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };

    // ── Actions ────────────────────────────────────────────────────────────
    const run = useCallback(async (label: string, fn: () => Promise<void>) => {
        setBusy(label);
        try { await fn(); } catch (e) { toast.error(extractApiError(e, `${label} failed`)); } finally { setBusy(null); }
    }, []);

    const autoMatch = () => run("Auto-match", async () => {
        const r = await axios.post<{ matched: number; staleCleared: number; statementOpen: number }>(
            `/api/accountancy/bank-reconciliation/${selectedId}/auto-match`, { from, to, windowDays },
        );
        toast.success(`${r.data.matched} matched${r.data.staleCleared ? `, ${r.data.staleCleared} stale cleared` : ""}; ${r.data.statementOpen} statement line(s) still open.`);
        reload();
    });

    const match = () => run("Match", async () => {
        await axios.post(`/api/accountancy/bank-reconciliation/${selectedId}/match`, { statementLineIds: [...selSt], glLineIds: [...selGl] });
        toast.success(`Matched ${selSt.size} statement line(s) with ${selGl.size} book entr${selGl.size === 1 ? "y" : "ies"}.`);
        setSelSt(new Set()); setSelGl(new Set());
        reload();
    });

    const unmatch = (groupId: string) => run("Unmatch", async () => {
        await axios.delete(`/api/accountancy/bank-reconciliation/${selectedId}/match/${groupId}`);
        reload();
    });

    const removeImport = async (imp: ReconPayload["imports"][number]) => {
        const ok = await confirmAction({
            title: `Remove upload "${imp.fileName}"?`,
            body: `${imp.lineCount} statement line(s) and every match made on them go with it. The file can be uploaded again.`,
            confirmLabel: "Remove upload",
        });
        if (!ok) return;
        await run("Remove upload", async () => {
            await axios.delete(`/api/accountancy/bank-reconciliation/${selectedId}/imports/${imp.id}`);
            toast.success("Upload removed");
            reload();
        });
    };

    const lockUpto = (date: string) => run("Lock", async () => {
        await axios.post(`/api/accountancy/ledgers/${selectedId}/reconcile`, { reconciledThrough: date });
        toast.success(`Reconciled upto ${formatDate(date)}`);
        reload(); ledgersQ.reload();
    });

    // "Book it": open the real voucher form with the bank leg, amount, date and
    // narration already in, then match the saved voucher to this line.
    const bookIt = (line: StatementLineView, kind: "PAYMENT" | "RECEIPT" | "CONTRA") => {
        if (!data) return;
        const bankId = data.account.id;
        const amount = line.deposit ?? line.withdrawal ?? 0;
        const isDeposit = line.deposit != null;
        const bankType = isDeposit ? "DEBIT" : "CREDIT";
        const otherType = isDeposit ? "CREDIT" : "DEBIT";
        stashDuplicate({
            kind,
            date: line.date,
            narration: line.narration.slice(0, 250),
            lines: [
                { accountId: bankId, type: bankType, amount },
                { accountId: null, type: otherType, amount, reference: line.reference ?? undefined },
            ],
            extras: { toast: `From the bank statement: ${formatDate(line.date)} · ${fmt(amount)}. Pick the other ledger and save.`, bankStatementLineId: line.id },
        });
        setBookingLine(line);
        setBookKind(kind);
    };

    const afterBooked = async (voucherId: number, posted: boolean) => {
        const line = bookingLine;
        setBookKind(null); setBookingLine(null);
        if (!line || !selectedId) { reload(); return; }
        if (!posted) { toast("Saved as draft — post it, then match it to the statement line."); reload(); return; }
        await run("Match new voucher", async () => {
            // The user may have moved the date in the form — look two months
            // either side of the statement line for the voucher's bank leg.
            const around = (days: number) => formatDateInput(new Date(new Date(`${line.date}T00:00:00`).getTime() + days * 86400000));
            const fresh = await axios.get<ReconPayload>(`/api/accountancy/bank-reconciliation/${selectedId}?from=${around(-60)}&to=${around(60)}`);
            const leg = fresh.data.glLines.find((g) => g.voucherId === voucherId && g.match == null);
            if (!leg) { toast.error("Voucher saved, but its bank leg was not found on this ledger — match it by hand."); reload(); return; }
            await axios.post(`/api/accountancy/bank-reconciliation/${selectedId}/match`, { statementLineIds: [line.id], glLineIds: [leg.id] });
            toast.success(`Booked and matched: ${leg.voucherNo}`);
            reload();
        });
    };

    const s = data?.summary;
    const lock = data?.account.lock ?? null;

    return (
        <div className="flex h-full min-h-0 flex-col">
            {/* Header */}
            <div className="flex flex-wrap items-end justify-between gap-3 border-b bg-card px-6 py-3">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground"><Landmark size={22} /> Bank Reconciliation</h1>
                    <p className="mt-0.5 text-sm text-muted-foreground">The bank&apos;s statement against the bank ledger. The bank is the truth: every statement line ends up matched or booked.</p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                    <div className="space-y-1">
                        <Label htmlFor="recon-ledger">Bank ledger</Label>
                        <select
                            id="recon-ledger"
                            value={selectedId ?? ""}
                            onChange={(e) => { setSelectedId(Number(e.target.value) || null); setSelSt(new Set()); setSelGl(new Set()); }}
                            className="h-9 min-w-[16rem] rounded-md border bg-background px-2 text-sm"
                        >
                            {!ledgers && <option value="">Loading…</option>}
                            {ledgers && ledgers.length === 0 && <option value="">No bank ledgers</option>}
                            {ledgers?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="recon-from">From</Label>
                        <TallyDateInput id="recon-from" value={from} onValueChange={setFrom} className="h-9 w-32" />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="recon-to">To</Label>
                        <TallyDateInput id="recon-to" value={to} onValueChange={setTo} monthMode="end" className="h-9 w-32" />
                    </div>
                    <Button variant="outline" onClick={() => reload()} disabled={!url || refreshing}>
                        <RefreshCw size={14} className={cn("mr-1", refreshing && "animate-spin")} /> Refresh
                    </Button>
                </div>
            </div>

            <QueryStateBlock loading={loading} error={error} hasData={!!data} onRetry={reload} loadingLabel="Loading reconciliation…" />

            {data && s && (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    {/* Reconciliation statement */}
                    <div className="border-b bg-card px-6 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3 lg:grid-cols-6">
                                <Stat label="Balance as per books" value={s.booksBalance} />
                                <Stat label="+ Payments not yet in bank" value={s.paymentsNotInBank} hint={`${s.counts.glUnmatched} book entr${s.counts.glUnmatched === 1 ? "y" : "ies"} unmatched${s.counts.glUnmatchedOlder ? `, ${s.counts.glUnmatchedOlder} before ${formatDate(from)}` : ""}`} />
                                <Stat label="− Deposits not yet in bank" value={s.depositsNotInBank} />
                                <Stat label="± Bank entries not in books" value={s.depositsNotInBooks - s.withdrawalsNotInBooks} hint={`${s.counts.statementUnmatched} statement line(s) open${s.counts.statementUnmatchedOlder ? `, ${s.counts.statementUnmatchedOlder} before ${formatDate(from)}` : ""}`} warn={s.counts.statementUnmatched > 0} />
                                <Stat label="= Balance as per bank (derived)" value={s.derivedBankBalance} emphasis />
                                <Stat label="Statement closing balance" value={s.statementBalance} sub={s.difference != null ? (Math.abs(s.difference) < 0.005 ? "agrees" : `difference ${fmt(s.difference)}`) : "no balance column"} warn={s.difference != null && Math.abs(s.difference) >= 0.005} />
                            </div>
                            <div className="flex flex-col items-end gap-1.5">
                                <ReconciledBadge accountId={data.account.id} reconciledThrough={data.account.lock} reconciledAt={data.account.reconciledAt} onSaved={() => { reload(); ledgersQ.reload(); }} />
                                {s.suggestedReconciledThrough && s.suggestedReconciledThrough !== data.account.lock && (
                                    <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" disabled={busy != null} onClick={() => void lockUpto(s.suggestedReconciledThrough!)}>
                                        <Lock size={12} className="mr-1" /> Lock upto {formatDate(s.suggestedReconciledThrough)}
                                    </Button>
                                )}
                                {s.counts.stale > 0 && <span className="text-[11px] text-amber-600">{s.counts.stale} match(es) point at a changed voucher — auto-match clears them</span>}
                            </div>
                        </div>
                    </div>

                    {/* Toolbar */}
                    <div className="flex flex-wrap items-center gap-2 border-b bg-card px-6 py-2">
                        <Button size="sm" onClick={() => setImportOpen(true)} disabled={busy != null}><Upload size={14} className="mr-1" /> Upload statement</Button>
                        <Button size="sm" variant="outline" onClick={() => void autoMatch()} disabled={busy != null}>
                            {busy === "Auto-match" ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Wand2 size={14} className="mr-1" />} Auto-match
                        </Button>
                        <label className="flex items-center gap-1 text-xs text-muted-foreground" htmlFor="recon-window">
                            within
                            <input id="recon-window" type="number" min={0} max={90} value={windowDays} onChange={(e) => setWindowDays(Math.max(0, Math.min(90, Number(e.target.value) || 0)))} className="h-7 w-14 rounded-md border bg-background px-1.5 text-center text-xs" />
                            days
                        </label>
                        <div className="ml-auto flex items-center gap-1 rounded-md border p-0.5 text-xs">
                            {(["unmatched", "matched", "all"] as Filter[]).map((f) => (
                                <button key={f} type="button" onClick={() => setFilter(f)} className={cn("rounded px-2 py-1 capitalize", filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>{f}</button>
                            ))}
                        </div>
                        <Button size="sm" onClick={() => void match()} disabled={!canMatch || busy != null} title={selSt.size && selGl.size && !canMatch ? `Sides differ: statement ${fmt(stTotal)} vs books ${fmt(glTotal)}` : undefined}>
                            <Link2 size={14} className="mr-1" /> Match {selSt.size ? `${selSt.size} ↔ ${selGl.size}` : ""}
                        </Button>
                        {(selSt.size > 0 || selGl.size > 0) && (
                            <span className={cn("text-xs font-mono", canMatch ? "text-green-700" : "text-amber-600")}>
                                {fmt(stTotal)} vs {fmt(glTotal)}
                            </span>
                        )}
                    </div>

                    {/* Two panes */}
                    <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-2">
                        {/* Bank side */}
                        <div className="flex min-h-0 flex-col border-r">
                            <div className="flex items-center justify-between border-b px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                <span>Bank statement · {stRows.length}</span>
                                <span className="font-normal normal-case">{data.imports.length} upload(s)</span>
                            </div>
                            <div className="min-h-0 flex-1 overflow-auto">
                                <table className="w-full text-xs">
                                    <thead className="sticky top-0 z-10 text-muted-foreground" style={moduleTableHeadStyle("accountancy")}>
                                        <tr>
                                            <th className="w-6 px-2 py-1.5" />
                                            <th className="px-2 py-1.5 text-left font-medium">Date</th>
                                            <th className="px-2 py-1.5 text-left font-medium">Narration</th>
                                            <th className="px-2 py-1.5 text-right font-medium">Withdrawal</th>
                                            <th className="px-2 py-1.5 text-right font-medium">Deposit</th>
                                            <th className="px-2 py-1.5 text-right font-medium">Balance</th>
                                            <th className="px-2 py-1.5" />
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {stPage.pageRows.length === 0 && (
                                            <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                                                {data.statementLines.length === 0 ? "No statement lines in this period — upload the bank statement." : `Nothing ${filter === "all" ? "" : filter} here.`}
                                            </td></tr>
                                        )}
                                        {stPage.pageRows.map((r) => <StatementRowView key={r.id} r={r} selected={selSt.has(r.id)} onToggle={() => setSelSt((s0) => toggle(s0, r.id))} onUnmatch={() => void unmatch(r.match!.groupId)} onBook={(k) => bookIt(r, k)} busy={busy != null} glById={data.glLines} />)}
                                    </tbody>
                                </table>
                            </div>
                            <PaginationBar total={stPage.total} page={stPage.page} pageSize={stPage.pageSize} onPageChange={stPage.setPage} onPageSizeChange={stPage.setPageSize} unitLabel="line" className="border-t px-3" />
                        </div>

                        {/* Books side */}
                        <div className="flex min-h-0 flex-col">
                            <div className="flex items-center justify-between border-b px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                <span>Books · {data.account.name} · {glRows.length}</span>
                                <Link href={accountLedgerUrl(data.account.id, { from, to })} className="font-normal normal-case text-primary hover:underline">open ledger</Link>
                            </div>
                            <div className="min-h-0 flex-1 overflow-auto">
                                <table className="w-full text-xs">
                                    <thead className="sticky top-0 z-10 text-muted-foreground" style={moduleTableHeadStyle("accountancy")}>
                                        <tr>
                                            <th className="w-6 px-2 py-1.5" />
                                            <th className="px-2 py-1.5 text-left font-medium">Date</th>
                                            <th className="px-2 py-1.5 text-left font-medium">Voucher</th>
                                            <th className="px-2 py-1.5 text-left font-medium">Description</th>
                                            <th className="px-2 py-1.5 text-right font-medium">Debit</th>
                                            <th className="px-2 py-1.5 text-right font-medium">Credit</th>
                                            <th className="px-2 py-1.5" />
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {glPage.pageRows.length === 0 && (
                                            <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">Nothing {filter === "all" ? "" : filter} here.</td></tr>
                                        )}
                                        {glPage.pageRows.map((r) => <GlRowView key={r.id} r={r} selected={selGl.has(r.id)} onToggle={() => setSelGl((s0) => toggle(s0, r.id))} onUnmatch={() => void unmatch(r.match!.groupId)} busy={busy != null} />)}
                                    </tbody>
                                </table>
                            </div>
                            <PaginationBar total={glPage.total} page={glPage.page} pageSize={glPage.pageSize} onPageChange={glPage.setPage} onPageSizeChange={glPage.setPageSize} unitLabel="entry" className="border-t px-3" />
                        </div>
                    </div>

                    {/* Uploads */}
                    {data.imports.length > 0 && (
                        <div className="border-t bg-card px-6 py-2">
                            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Uploads</div>
                            <div className="flex flex-wrap gap-2">
                                {data.imports.map((imp) => (
                                    <div key={imp.id} className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
                                        <span className="font-medium" title={imp.fileName}>{imp.fileName.length > 28 ? `${imp.fileName.slice(0, 26)}…` : imp.fileName}</span>
                                        <span className="text-muted-foreground">
                                            {imp.fromDate ? formatDate(imp.fromDate) : "?"} → {imp.toDate ? formatDate(imp.toDate) : "?"} · {imp.lineCount} lines
                                            {imp.skippedCount ? ` · ${imp.skippedCount} dup` : ""}{imp.beforeLock ? ` · ${imp.beforeLock} before lock` : ""} · {imp.importedBy} · {formatDate(imp.createdAt)}
                                        </span>
                                        <button type="button" className="text-muted-foreground hover:text-red-600" title="Remove this upload" aria-label={`Remove upload ${imp.fileName}`} disabled={busy != null} onClick={() => void removeImport(imp)}>
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {data && (
                <BankStatementImportDialog
                    accountId={data.account.id}
                    accountName={data.account.name}
                    lock={lock}
                    open={importOpen}
                    onClose={() => setImportOpen(false)}
                    onImported={() => reload()}
                />
            )}
            <GlVoucherDialog kind={bookKind} onClose={() => { setBookKind(null); setBookingLine(null); reload(); }} onSaved={(id, posted) => void afterBooked(id, posted)} />
        </div>
    );
}

function Stat({ label, value, hint, sub, emphasis, warn }: { label: string; value: number | null; hint?: string; sub?: string; emphasis?: boolean; warn?: boolean }) {
    return (
        <div className="min-w-0">
            <div className="truncate text-[11px] text-muted-foreground" title={hint ?? label}>{label}</div>
            <div className={cn("font-mono", emphasis && "font-semibold", warn && "text-amber-600")}>{value == null ? "—" : fmt(value)}</div>
            {(sub ?? hint) && <div className={cn("truncate text-[10px]", warn ? "text-amber-600" : "text-muted-foreground")}>{sub ?? hint}</div>}
        </div>
    );
}

function StatementRowView({ r, selected, onToggle, onUnmatch, onBook, busy, glById }: {
    r: StatementLineView; selected: boolean; onToggle: () => void; onUnmatch: () => void;
    onBook: (kind: "PAYMENT" | "RECEIPT" | "CONTRA") => void; busy: boolean; glById: GlLineView[];
}) {
    const matched = r.match != null && !r.match.stale;
    const partners = matched ? r.match!.glLineIds.map((id) => glById.find((g) => g.id === id)?.voucherNo ?? `#${id}`) : [];
    return (
        <tr className={cn("hover:bg-muted/40", matched && "bg-green-50/40 dark:bg-green-900/10", r.locked && "opacity-60", selected && "bg-primary/10")}>
            <td className="px-2 py-1.5 align-top">
                {!matched && !r.locked && (
                    <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select statement line ${formatDate(r.date)} ${r.narration}`} />
                )}
                {matched && <CheckCircle2 size={13} className="text-green-600" />}
                {r.locked && <Lock size={11} className="text-muted-foreground" />}
            </td>
            <td className="whitespace-nowrap px-2 py-1.5 align-top">{formatDate(r.date)}</td>
            <td className="px-2 py-1.5 align-top">
                <div className="line-clamp-2 break-words" title={r.narration}>{r.narration}</div>
                <div className="flex flex-wrap gap-x-2 text-[10px] text-muted-foreground">
                    {r.reference && <span className="font-mono">{r.reference}</span>}
                    {matched && <span className="text-green-700 dark:text-green-400">↔ {partners.join(", ")}{r.match!.auto ? " · auto" : ""}</span>}
                    {r.match?.stale && <span className="text-amber-600">matched voucher changed — re-match</span>}
                </div>
            </td>
            <td className="px-2 py-1.5 text-right font-mono align-top">{money(r.withdrawal)}</td>
            <td className="px-2 py-1.5 text-right font-mono align-top">{money(r.deposit)}</td>
            <td className="px-2 py-1.5 text-right font-mono align-top text-muted-foreground">{r.balance != null ? fmt(r.balance) : ""}</td>
            <td className="whitespace-nowrap px-2 py-1.5 text-right align-top">
                {matched && !r.locked && (
                    <button type="button" className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-red-600" disabled={busy} onClick={onUnmatch} title="Unmatch"><Unlink size={12} /></button>
                )}
                {!matched && !r.locked && (
                    <span className="inline-flex items-center gap-0.5">
                        <Sparkles size={11} className="text-muted-foreground" />
                        <button type="button" className="rounded px-1 text-[11px] text-primary hover:underline" disabled={busy} onClick={() => onBook(r.deposit != null ? "RECEIPT" : "PAYMENT")}>{r.deposit != null ? "Receipt" : "Payment"}</button>
                        <button type="button" className="rounded px-1 text-[11px] text-primary hover:underline" disabled={busy} onClick={() => onBook("CONTRA")}>Contra</button>
                    </span>
                )}
            </td>
        </tr>
    );
}

function GlRowView({ r, selected, onToggle, onUnmatch, busy }: { r: GlLineView; selected: boolean; onToggle: () => void; onUnmatch: () => void; busy: boolean }) {
    const matched = r.match != null;
    return (
        <tr className={cn("hover:bg-muted/40", matched && "bg-green-50/40 dark:bg-green-900/10", r.locked && "opacity-60", selected && "bg-primary/10")}>
            <td className="px-2 py-1.5 align-top">
                {!matched && !r.locked && <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select book entry ${r.voucherNo}`} />}
                {matched && <CheckCircle2 size={13} className="text-green-600" />}
                {r.locked && <Lock size={11} className="text-muted-foreground" />}
            </td>
            <td className="whitespace-nowrap px-2 py-1.5 align-top">{formatDate(r.date)}</td>
            <td className="whitespace-nowrap px-2 py-1.5 align-top">
                {r.source
                    ? <Link href={r.source.url} className="text-primary hover:underline">{r.voucherNo}</Link>
                    : <span>{r.voucherNo}</span>}
                <div className="text-[10px] text-muted-foreground">{r.voucherType}</div>
            </td>
            <td className="px-2 py-1.5 align-top">
                <div className="line-clamp-2 break-words" title={r.description}>{r.description}</div>
                <div className="flex flex-wrap gap-x-2 text-[10px] text-muted-foreground">
                    {r.reference && <span className="font-mono">{r.reference}</span>}
                    {r.narration && r.narration !== r.description && <span className="truncate">{r.narration}</span>}
                    {matched && <span className="text-green-700 dark:text-green-400">↔ {r.match!.statementLineIds.length} statement line(s){r.match!.auto ? " · auto" : ""}</span>}
                </div>
            </td>
            <td className="px-2 py-1.5 text-right font-mono align-top">{money(r.debit)}</td>
            <td className="px-2 py-1.5 text-right font-mono align-top">{money(r.credit)}</td>
            <td className="whitespace-nowrap px-2 py-1.5 text-right align-top">
                {matched && !r.locked && (
                    <button type="button" className="text-muted-foreground hover:text-red-600" disabled={busy} onClick={onUnmatch} title="Unmatch"><Unlink size={12} /></button>
                )}
            </td>
        </tr>
    );
}
