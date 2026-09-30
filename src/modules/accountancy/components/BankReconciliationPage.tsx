"use client";

// Bank Reconciliation — the bank's statement against the bank ledger.
//
// Two views of the same two sides. Merged (the default) puts the bank's
// statement lines and the books' GL legs in one wide table, sorted by date then
// by signed amount so an equal pair sits on consecutive rows, each row banded by
// colour and tagged Bank or Books. Split keeps the old two panes — bank left,
// books right. Auto-match pairs the obvious ones; ticking
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
import { CheckCircle2, ChevronDown, ChevronUp, Link2, Loader2, Lock, RefreshCw, Sparkles, Trash2, Unlink, Upload, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { fmt } from "@/shared/lib/format/moneyInr";
import { clampNumber, parseDigitsInput } from "@/shared/lib/format";
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
type ViewMode = "merged" | "split";

// A suggested match group: open rows from both sides sharing a date and an
// exact signed amount. The bracket down the left ties them together; Select
// ticks the whole group so Match is one press away.
type Suggestion = { key: string; first: boolean; last: boolean; stIds: number[]; glIds: number[]; size: number };

// The near miss auto-match now refuses to take: an open book entry for the same
// money on the same side, but a DIFFERENT day with no reference in common. It is
// only ever pointed at, never matched — the whole reason it is refused is that
// the amount alone does not prove anything, so a person has to look. Clicking it
// ticks both rows; nothing is saved until Match is pressed.
type CrossDateHint = { glId: number; voucherNo: string; date: string; gap: number; more: number; what: string };

// A run of neighbouring rows that belong together — an existing match, or a
// suggestion. Only a run of two or more is a group: it gets the bracket and a
// rule above and below. A row belonging to nobody keeps the hairline divider.
type Run = { kind: "matched" | "suggested"; first: boolean; last: boolean; size: number };

// One row of the merged table. Both sides share a signed delta — money into the
// bank is positive — so a statement line and the book entry that explains it
// carry the same number and sort next to each other.
type MergedRowBase = { key: string; date: string; delta: number; sug?: Suggestion; run?: Run; strongBelow?: boolean };
type MergedRow =
    | (MergedRowBase & { kind: "st"; st: StatementLineView })
    | (MergedRowBase & { kind: "gl"; gl: GlLineView });

// A row nobody has tied yet — the only kind worth suggesting.
function isOpen(r: MergedRow) {
    return r.kind === "st" ? (r.st.match == null || r.st.match.stale) && !r.st.locked : r.gl.match == null && !r.gl.locked;
}

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
    const [filter, setFilter] = useState<Filter>("all");
    const [view, setView] = useState<ViewMode>("merged");
    useEffect(() => {
        try { const v = localStorage.getItem("recon.view"); if (v === "split" || v === "merged") setView(v); } catch { /* private mode */ }
    }, []);
    const changeView = (v: ViewMode) => { setView(v); try { localStorage.setItem("recon.view", v); } catch { /* private mode */ } };
    const [showStats, setShowStats] = useState(true);
    useEffect(() => {
        try { if (localStorage.getItem("recon.stats") === "off") setShowStats(false); } catch { /* private mode */ }
    }, []);
    // Plain handler, not a state updater — an updater must stay pure, and React
    // runs it twice in development.
    const toggleStats = () => {
        const next = !showStats;
        setShowStats(next);
        try { localStorage.setItem("recon.stats", next ? "on" : "off"); } catch { /* private mode */ }
    };
    const [selSt, setSelSt] = useState<Set<number>>(new Set());
    const [selGl, setSelGl] = useState<Set<number>>(new Set());
    const [busy, setBusy] = useState<string | null>(null);
    const [importOpen, setImportOpen] = useState(false);
    const [bookKind, setBookKind] = useState<GlDialogKind | null>(null);
    const [bookingLines, setBookingLines] = useState<StatementLineView[]>([]);

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

    // Near misses, worked out over the WHOLE period on screen rather than the
    // auto-match window: the window governs what may be CREATED, and the case
    // worth pointing at is exactly the one sitting outside it. Built from
    // `data`, not the filtered rows, so switching to Matched does not blind it.
    // Bank side only — hinting both sides would advertise every pair twice.
    const hints = useMemo(() => {
        const out = new Map<number, CrossDateHint>();
        if (!data) return out;
        const day = (d: string) => new Date(d.slice(0, 10)).getTime() / 86_400_000;
        // Open book entries by signed amount. Same sign as the statement's own
        // delta, so a deposit never looks at a payment of the same size.
        const byDelta = new Map<string, GlLineView[]>();
        for (const g of data.glLines) {
            if (g.match != null || g.locked) continue;
            const delta = (g.debit ?? 0) - (g.credit ?? 0);
            if (delta === 0) continue;
            const k = delta.toFixed(2);
            const b = byDelta.get(k); if (b) b.push(g); else byDelta.set(k, [g]);
        }
        for (const st of data.statementLines) {
            if ((st.match != null && !st.match.stale) || st.locked) continue;
            const delta = (st.deposit ?? 0) - (st.withdrawal ?? 0);
            if (delta === 0) continue;
            const all = byDelta.get(delta.toFixed(2)) ?? [];
            // A same-day entry is a better answer and already gets the amber
            // bracket — this is only for the ones on another day.
            const other = all.filter((g) => g.date.slice(0, 10) !== st.date.slice(0, 10));
            if (other.length === 0 || other.length < all.length) continue;
            const near = other.reduce((a, b) =>
                (Math.abs(day(b.date) - day(st.date)) < Math.abs(day(a.date) - day(st.date)) ? b : a));
            out.set(st.id, {
                glId: near.id,
                voucherNo: near.voucherNo,
                date: near.date,
                gap: Math.round(Math.abs(day(near.date) - day(st.date))),
                more: other.length - 1,
                // Carried so the hover can say WHAT the entry is. Days apart, it
                // is almost never on the same page — without this the only way
                // to judge the suggestion would be to go and hunt for it.
                what: [near.voucherType, near.description, near.narration]
                    .filter(Boolean).join(" · "),
            });
        }
        return out;
    }, [data]);
    const selectHint = (stId: number, h: CrossDateHint) => {
        setSelSt(new Set([stId]));
        setSelGl(new Set([h.glId]));
    };

    // Merged: both sides in one list, date first, then the signed amount, so an
    // equal pair lands on consecutive rows. Bank before books on a tie.
    const mergedRows = useMemo<MergedRow[]>(() => {
        const rows: MergedRow[] = [
            ...stRows.map((r): MergedRow => ({ kind: "st", key: `s${r.id}`, date: r.date, delta: (r.deposit ?? 0) - (r.withdrawal ?? 0), st: r })),
            ...glRows.map((r): MergedRow => ({ kind: "gl", key: `g${r.id}`, date: r.date, delta: (r.debit ?? 0) - (r.credit ?? 0), gl: r })),
        ];
        // Same date, same signed amount, still open, and both sides present —
        // that is a pair worth pointing at. Direction has to agree too, so a
        // deposit never pairs with a payment of the same size. Worked out
        // before the sort, because being in a group decides where a row goes.
        const bucket = new Map<string, MergedRow[]>();
        for (const r of rows) {
            if (!isOpen(r) || r.delta === 0) continue;
            const k = `${r.date}|${r.delta.toFixed(2)}`;
            const b = bucket.get(k); if (b) b.push(r); else bucket.set(k, [r]);
        }
        for (const [key, group] of bucket) {
            const stIds = group.flatMap((r) => (r.kind === "st" ? [r.st.id] : []));
            const glIds = group.flatMap((r) => (r.kind === "gl" ? [r.gl.id] : []));
            if (stIds.length === 0 || glIds.length === 0) continue;
            for (const r of group) r.sug = { key, first: false, last: false, stIds, glIds, size: group.length };
        }

        // Date, then amount — which already puts a group's rows together. Then
        // group members ahead of anything else carrying that same date and
        // amount, so a matched or locked row can never sit inside a group and
        // break it in two. Bank above, books below, always.
        rows.sort((a, b) =>
            a.date.localeCompare(b.date)
            || a.delta - b.delta
            || (a.sug ? 0 : 1) - (b.sug ? 0 : 1)
            || (a.kind === b.kind ? 0 : a.kind === "st" ? -1 : 1));

        // first / last off the final order — cheap now that a group is known to
        // be contiguous, and still right if that ever stops being true.
        rows.forEach((r, i) => {
            if (!r.sug) return;
            r.sug = { ...r.sug, first: rows[i - 1]?.sug?.key !== r.sug.key, last: rows[i + 1]?.sug?.key !== r.sug.key };
        });

        // What each row belongs to: a suggestion, an existing match, or nothing.
        // Runs are read off neighbours, so a match whose two halves are days
        // apart — and so not adjacent here — gets no bracket rather than a
        // wrong one.
        const keyOf = (r: MergedRow) => {
            if (r.sug) return `s:${r.sug.key}`;
            const g = r.kind === "st" ? (r.st.match && !r.st.match.stale ? r.st.match.groupId : null) : (r.gl.match?.groupId ?? null);
            return g ? `m:${g}` : `x:${r.key}`;
        };
        const keys = rows.map(keyOf);
        for (let i = 0; i < rows.length;) {
            let j = i;
            while (j + 1 < rows.length && keys[j + 1] === keys[i]) j++;
            if (j > i) {
                const kind = keys[i].startsWith("s:") ? "suggested" : "matched";
                for (let k = i; k <= j; k++) rows[k].run = { kind, first: k === i, last: k === j, size: j - i + 1 };
            }
            i = j + 1;
        }
        // A heavy rule closes a group and opens the next one. Rows outside any
        // group keep the hairline, or the whole table reads as bars.
        rows.forEach((r, i) => {
            const next = rows[i + 1];
            r.strongBelow = next != null && (r.run?.last === true || next.run?.first === true);
        });
        return rows;
    }, [stRows, glRows]);

    const selectGroup = (sug: Suggestion) => { setSelSt(new Set(sug.stIds)); setSelGl(new Set(sug.glIds)); };

    // Pages that never cut a group in half. Rows are taken block by block — a
    // run whole, a loose row on its own — and a block that would overflow the
    // page starts the next one instead, so a page can come up a row or two
    // short. A group longer than a page gets a page to itself.
    const [mPage, setMPage] = useState(1);
    const [mPageSize, setMPageSize] = useState(100);
    const mPages = useMemo(() => {
        const out: MergedRow[][] = [];
        let cur: MergedRow[] = [];
        for (let i = 0; i < mergedRows.length;) {
            let j = i;
            while (j + 1 < mergedRows.length && mergedRows[j].run && !mergedRows[j].run!.last) j++;
            const block = mergedRows.slice(i, j + 1);
            if (cur.length > 0 && cur.length + block.length > mPageSize) { out.push(cur); cur = []; }
            cur.push(...block);
            i = j + 1;
        }
        if (cur.length > 0) out.push(cur);
        return out;
    }, [mergedRows, mPageSize]);

    // Same trick as useClientPagination: correct an out-of-range page during
    // render, so filtering while deep in the list never shows an empty table.
    const mPageCount = Math.max(1, mPages.length);
    const [lastMPageCount, setLastMPageCount] = useState(mPageCount);
    if (lastMPageCount !== mPageCount) {
        setLastMPageCount(mPageCount);
        if (mPage > mPageCount) setMPage(mPageCount);
    }
    const mCurrent = Math.min(Math.max(1, mPage), mPageCount);
    const mPageRows = mPages[mCurrent - 1] ?? [];
    const mFrom = mPages.slice(0, mCurrent - 1).reduce((n, p) => n + p.length, 0) + 1;

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
        // `hints` is this render's — computed before the reload lands — so it
        // counts what auto-match declined to take on THIS pass, which is
        // exactly the set the user is being sent to look at.
        const near = hints.size;
        toast.success(
            `${r.data.matched} matched${r.data.staleCleared ? `, ${r.data.staleCleared} stale cleared` : ""}; `
            + `${r.data.statementOpen} statement line(s) still open.`
            + (near ? ` ${near} have the same amount on another date — shown in amber, check before matching.` : ""),
        );
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
    // Book one statement line, or several at once. The bank takes a single leg
    // for the total and every line becomes its own particulars row, carrying
    // its narration as that row's description — a subscription and the charges
    // deducted alongside it end up in one voucher, still itemised.
    const bookIt = (lines: StatementLineView[], kind: "PAYMENT" | "RECEIPT" | "CONTRA") => {
        if (!data || lines.length === 0) return;
        const bankId = data.account.id;
        const deposits = lines.every((l) => l.deposit != null);
        const withdrawals = lines.every((l) => l.withdrawal != null);
        if (!deposits && !withdrawals) {
            toast.error("Those lines go both ways — book the money in and the money out separately.");
            return;
        }
        const amountOf = (l: StatementLineView) => l.deposit ?? l.withdrawal ?? 0;
        const total = Math.round(lines.reduce((n, l) => n + amountOf(l), 0) * 100) / 100;
        // Annotated: inside the map below the inferred literal union widens to
        // string, which DuplicateLine will not take.
        const bankType: "DEBIT" | "CREDIT" = deposits ? "DEBIT" : "CREDIT";
        const otherType: "DEBIT" | "CREDIT" = deposits ? "CREDIT" : "DEBIT";
        const date = lines.reduce((d, l) => (l.date < d ? l.date : d), lines[0].date);
        const oneDate = lines.every((l) => l.date === date);
        stashDuplicate({
            kind,
            date,
            narration: lines.length === 1
                ? lines[0].narration.slice(0, 250)
                : `Bank statement · ${oneDate ? `${formatDate(date)} · ` : ""}${lines.length} lines`,
            lines: [
                { accountId: bankId, type: bankType, amount: total },
                ...lines.map((l) => ({
                    accountId: null,
                    type: otherType,
                    amount: amountOf(l),
                    description: l.narration.slice(0, 250),
                    reference: l.reference ?? undefined,
                })),
            ],
            extras: {
                toast: lines.length === 1
                    ? `From the bank statement: ${formatDate(date)} · ${fmt(total)}. Pick the other ledger and save.`
                    : `From the bank statement: ${lines.length} lines · ${fmt(total)}. Pick a ledger on each row and save.`,
                bankStatementLineIds: lines.map((l) => l.id),
            },
        });
        setBookingLines(lines);
        setBookKind(kind);
    };

    // The ticked bank lines, in the order the table shows them.
    const selectedStLines = useMemo(
        () => (data?.statementLines ?? []).filter((l) => selSt.has(l.id)),
        [data, selSt],
    );
    const selKind: "RECEIPT" | "PAYMENT" | null = selectedStLines.length === 0
        ? null
        : selectedStLines.every((l) => l.deposit != null) ? "RECEIPT"
            : selectedStLines.every((l) => l.withdrawal != null) ? "PAYMENT" : null;

    const afterBooked = async (voucherId: number, posted: boolean) => {
        const lines = bookingLines;
        setBookKind(null); setBookingLines([]);
        if (lines.length === 0 || !selectedId) { reload(); return; }
        const many = lines.length > 1;
        if (!posted) { toast(`Saved as draft — post it, then match it to the statement line${many ? "s" : ""}.`); reload(); return; }
        await run("Match new voucher", async () => {
            // The user may have moved the date in the form — look two months
            // either side of the statement line for the voucher's bank leg.
            const first = lines.reduce((d, l) => (l.date < d ? l.date : d), lines[0].date);
            const around = (days: number) => formatDateInput(new Date(new Date(`${first}T00:00:00`).getTime() + days * 86400000));
            const fresh = await axios.get<ReconPayload>(`/api/accountancy/bank-reconciliation/${selectedId}?from=${around(-60)}&to=${around(60)}`);
            const leg = fresh.data.glLines.find((g) => g.voucherId === voucherId && g.match == null);
            if (!leg) { toast.error("Voucher saved, but its bank leg was not found on this ledger — match it by hand."); reload(); return; }
            await axios.post(`/api/accountancy/bank-reconciliation/${selectedId}/match`, { statementLineIds: lines.map((l) => l.id), glLineIds: [leg.id] });
            setSelSt(new Set());
            toast.success(`Booked and matched: ${leg.voucherNo}${many ? ` · ${lines.length} lines` : ""}`);
            reload();
        });
    };

    const s = data?.summary;
    const lock = data?.account.lock ?? null;

    return (
        <div className="flex h-full min-h-0 flex-col">
            {/* Header — no title here, the breadcrumb already names the screen */}
            <div className="flex flex-wrap items-end justify-between gap-3 border-b bg-card px-6 py-2">
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
                    <Button variant="outline" onClick={toggleStats} title={showStats ? "Hide the reconciliation summary and give the table its room" : "Show the reconciliation summary"} aria-expanded={showStats}>
                        {showStats ? <ChevronUp size={14} className="mr-1" /> : <ChevronDown size={14} className="mr-1" />} Summary
                    </Button>
                </div>
            </div>

            <QueryStateBlock loading={loading} error={error} hasData={!!data} onRetry={reload} loadingLabel="Loading reconciliation…" />

            {data && s && (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    {/* Reconciliation statement — hidden on demand, the table takes the space */}
                    <div className={cn("border-b bg-card px-6 py-3", !showStats && "hidden")}>
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
                        {/* The window governs REFERENCE-matched pairs only — a
                            different day with nothing in common is never taken,
                            whatever this says. Hence the wording: it is how late
                            a proven pair may clear, not how loose a guess may be. */}
                        <label
                            className="flex items-center gap-1 text-xs text-muted-foreground"
                            htmlFor="recon-window"
                            title="Same-day lines match on amount alone. A different day is matched only when the bank's reference (UTR / UPI / cheque no) also appears on the entry — this is how many days late such a pair may clear."
                        >
                            same day, or up to
                            <input id="recon-window" type="text" inputMode="numeric" value={windowDays} onChange={(e) => setWindowDays(clampNumber(Number(parseDigitsInput(e.target.value)) || 0, 0, 300))} className="h-7 w-14 rounded-md border bg-background px-1.5 text-center text-xs" />
                            days on a matching reference
                        </label>
                        <div className="ml-auto flex items-center gap-1 rounded-md border p-0.5 text-xs">
                            {(["unmatched", "matched", "all"] as Filter[]).map((f) => (
                                <button key={f} type="button" onClick={() => setFilter(f)} className={cn("rounded px-2 py-1 capitalize", filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>{f}</button>
                            ))}
                        </div>
                        <div className="flex items-center gap-1 rounded-md border p-0.5 text-xs" title="One table with both sides, or the two panes side by side">
                            {(["merged", "split"] as ViewMode[]).map((v) => (
                                <button key={v} type="button" onClick={() => changeView(v)} className={cn("rounded px-2 py-1 capitalize", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>{v}</button>
                            ))}
                        </div>
                        {selectedStLines.length > 0 && selGl.size === 0 && (
                            <>
                                <Button
                                    size="sm" variant="outline" disabled={busy != null || selKind == null}
                                    onClick={() => selKind && bookIt(selectedStLines, selKind)}
                                    title={selKind == null
                                        ? "Those lines go both ways — book the money in and the money out separately"
                                        : `One voucher, ${selectedStLines.length} row(s), each carrying its own narration`}
                                >
                                    <Sparkles size={14} className="mr-1" /> {selKind === "RECEIPT" ? "Receipt" : "Payment"} {selectedStLines.length}
                                </Button>
                                <Button
                                    size="sm" variant="outline" disabled={busy != null || selKind == null}
                                    onClick={() => selKind && bookIt(selectedStLines, "CONTRA")}
                                    title="Book the ticked lines as one contra voucher"
                                >
                                    Contra {selectedStLines.length}
                                </Button>
                            </>
                        )}
                        <Button size="sm" onClick={() => void match()} disabled={!canMatch || busy != null} title={selSt.size && selGl.size && !canMatch ? `Sides differ: statement ${fmt(stTotal)} vs books ${fmt(glTotal)}` : undefined}>
                            <Link2 size={14} className="mr-1" /> Match {selSt.size ? `${selSt.size} ↔ ${selGl.size}` : ""}
                        </Button>
                        {(selSt.size > 0 || selGl.size > 0) && (
                            <span className={cn("text-xs font-mono", canMatch ? "text-green-700" : "text-amber-600")}>
                                {fmt(stTotal)} vs {fmt(glTotal)}
                            </span>
                        )}
                    </div>

                    {/* Merged — both sides in one table, told apart by colour and a tag */}
                    {view === "merged" && (
                        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                            <div className="flex items-center justify-between border-b px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                <span className="flex items-center gap-2">
                                    <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-sky-500" /> Bank statement · {stRows.length}</span>
                                    <span className="text-muted-foreground/40">|</span>
                                    <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-violet-500" /> Books · {data.account.name} · {glRows.length}</span>
                                    <span className="text-muted-foreground/40">|</span>
                                    <span className="inline-flex items-center gap-1 font-normal normal-case"><span className="h-3.5 w-[3px] rounded-full bg-amber-400" /> same date, same amount</span>
                                    <span className="text-muted-foreground/40">|</span>
                                    <AgreedLegend summary={s} />
                                </span>
                                <span className="flex items-center gap-3 font-normal normal-case">
                                    <span>{data.imports.length} upload(s)</span>
                                    <Link href={accountLedgerUrl(data.account.id, { from, to })} className="text-primary hover:underline">open ledger</Link>
                                </span>
                            </div>
                            <div className="min-h-0 flex-1 overflow-auto">
                                <table className="w-full text-xs">
                                    <thead className="sticky top-0 z-10 text-muted-foreground" style={moduleTableHeadStyle("accountancy")}>
                                        <tr>
                                            <th className="w-6 px-2 py-1.5" />
                                            <th className="w-16 px-2 py-1.5 text-left font-medium">Side</th>
                                            <th className="w-24 px-2 py-1.5 text-left font-medium">Date</th>
                                            <th className="px-2 py-1.5 text-left font-medium">Particulars</th>
                                            <th className="w-32 px-2 py-1.5 text-right font-medium">Withdrawal<span className="block text-[10px] font-normal normal-case">books: credit</span></th>
                                            <th className="w-32 px-2 py-1.5 text-right font-medium">Deposit<span className="block text-[10px] font-normal normal-case">books: debit</span></th>
                                            <th className="w-28 px-2 py-1.5 text-right font-medium">Balance</th>
                                            <th className="w-36 px-2 py-1.5" />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {mPageRows.length === 0 && (
                                            <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                                                {data.statementLines.length === 0 && data.glLines.length === 0 ? "Nothing in this period — upload the bank statement." : `Nothing ${filter === "all" ? "" : filter} here.`}
                                            </td></tr>
                                        )}
                                        {mPageRows.map((row) => (
                                            <MergedRowView
                                                key={row.key}
                                                row={row}
                                                selected={row.kind === "st" ? selSt.has(row.st.id) : selGl.has(row.gl.id)}
                                                onToggle={() => row.kind === "st"
                                                    ? setSelSt((s0) => toggle(s0, row.st.id))
                                                    : setSelGl((s0) => toggle(s0, row.gl.id))}
                                                onUnmatch={() => void unmatch(row.kind === "st" ? row.st.match!.groupId : row.gl.match!.groupId)}
                                                onBook={(k) => { if (row.kind === "st") bookIt([row.st], k); }}
                                                onSelectGroup={selectGroup}
                                                busy={busy != null}
                                                glById={data.glLines}
                                                agreed={isAgreed(row.date, s.agreedThrough)}
                                                hint={row.kind === "st" ? hints.get(row.st.id) : undefined}
                                                onSelectHint={() => {
                                                    if (row.kind !== "st") return;
                                                    const h = hints.get(row.st.id);
                                                    if (h) selectHint(row.st.id, h);
                                                }}
                                            />
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <PaginationBar
                                total={mergedRows.length}
                                page={mCurrent}
                                pageSize={mPageSize}
                                pageCount={mPageCount}
                                rangeFrom={mPageRows.length === 0 ? 0 : mFrom}
                                rangeTo={mPageRows.length === 0 ? 0 : mFrom + mPageRows.length - 1}
                                onPageChange={setMPage}
                                onPageSizeChange={(n) => { setMPageSize(n); setMPage(1); }}
                                unitLabel="row"
                                className="border-t px-3"
                            />
                        </div>
                    )}

                    {/* Two panes — rendered only when chosen, so the other view's
                        rows are not sitting in the DOM doing nothing */}
                    {view === "split" && (
                    <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-2">
                        {/* Bank side */}
                        <div className="flex min-h-0 flex-col border-r">
                            <div className="flex items-center justify-between border-b px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                <span className="flex items-center gap-2">Bank statement · {stRows.length} <AgreedLegend summary={s} /></span>
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
                                        {stPage.pageRows.map((r) => <StatementRowView key={r.id} r={r} selected={selSt.has(r.id)} onToggle={() => setSelSt((s0) => toggle(s0, r.id))} onUnmatch={() => void unmatch(r.match!.groupId)} onBook={(k) => bookIt([r], k)} busy={busy != null} glById={data.glLines} agreed={isAgreed(r.date, s.agreedThrough)} hint={hints.get(r.id)} onSelectHint={() => { const h = hints.get(r.id); if (h) selectHint(r.id, h); }} />)}
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
                    )}

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
            <GlVoucherDialog kind={bookKind} onClose={() => { setBookKind(null); setBookingLines([]); reload(); }} onSaved={(id, posted) => void afterBooked(id, posted)} />
        </div>
    );
}

// The agreement band. The Balance column is coloured, without a break, on every
// row up to the last day books and bank are proven to agree — same closing
// balance AND every row ticked (see agreementRun). Where the colour stops is
// where the mismatch starts.
const AGREED_CELL = "bg-emerald-400/45 font-medium text-emerald-950 dark:bg-emerald-500/30 dark:text-emerald-50";
const AGREED_TITLE = "Books and bank agree up to here, and every row is ticked";

function isAgreed(date: string, through: string | null) {
    return through != null && date.slice(0, 10) <= through;
}

function AgreedLegend({ summary }: { summary: ReconPayload["summary"] }) {
    const b = summary.breakAt;
    const why = b == null
        ? "Books and bank agree for the whole period, every row ticked."
        : `Stops before ${formatDate(b.date)}: ${[
            b.unticked ? `${b.unticked} row(s) not ticked` : null,
            b.gap == null ? "no bank balance yet" : Math.abs(b.gap) >= 0.005 ? `balance differs by ${fmt(b.gap)}` : null,
        ].filter(Boolean).join(", ")}.`;
    return (
        <span className="inline-flex items-center gap-1 font-normal normal-case" title={why}>
            <span className="h-3 w-3 rounded-sm bg-emerald-400/70 dark:bg-emerald-500/50" />
            {summary.agreedThrough
                ? <>books = bank, all ticked · through {formatDate(summary.agreedThrough)}</>
                : <>books = bank, all ticked · not from the first day</>}
            {b && <span className="text-red-600 dark:text-red-400">· breaks {formatDate(b.date)}</span>}
        </span>
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

/** How far the furthest book entry in this match sits from the statement line.
 *  Auto-match crosses days only on a shared reference now, and a match by hand
 *  can span anything at all — either way a stretched pair is worth seeing on
 *  the row rather than having to open both sides to notice it. */
function matchGapDays(stDate: string, glLineIds: number[], glById: GlLineView[]): number {
    const day = (d: string) => new Date(d.slice(0, 10)).getTime() / 86_400_000;
    let gap = 0;
    for (const id of glLineIds) {
        const g = glById.find((x) => x.id === id);
        if (!g) continue;
        gap = Math.max(gap, Math.abs(day(g.date) - day(stDate)));
    }
    return Math.round(gap);
}

// One row of the merged table. Bank lines and book entries share the columns —
// a withdrawal sits under the credit that explains it, a deposit under its
// debit — so an equal pair reads straight down the page. The colour band and
// the Side tag say which book a row comes from; colour is never the only clue.
function MergedRowView({ row, selected, onToggle, onUnmatch, onBook, onSelectGroup, busy, glById, agreed, hint, onSelectHint }: {
    row: MergedRow; selected: boolean; onToggle: () => void; onUnmatch: () => void;
    onBook: (kind: "PAYMENT" | "RECEIPT" | "CONTRA") => void; onSelectGroup: (sug: Suggestion) => void;
    busy: boolean; glById: GlLineView[]; agreed: boolean; hint?: CrossDateHint; onSelectHint: () => void;
}) {
    const isSt = row.kind === "st";
    const r = isSt ? row.st : row.gl;
    const matched = isSt ? (row.st.match != null && !row.st.match.stale) : row.gl.match != null;
    const partners = isSt && matched
        ? row.st.match!.glLineIds.map((id) => glById.find((g) => g.id === id)?.voucherNo ?? `#${id}`)
        : [];
    const matchGap = isSt && matched ? matchGapDays(row.st.date, row.st.match!.glLineIds, glById) : 0;
    const sug = row.sug;
    const run = row.run;
    // One background, chosen — not three bg-* utilities stacked, where which one
    // wins is down to the order Tailwind happens to emit them in. Hover deepens
    // the row's own colour rather than washing it with a neutral, which read as
    // the bank tint and made a hovered Books row look like a Bank row.
    const background = selected
        ? "bg-primary/20 hover:bg-primary/30"
        : matched
            ? "bg-green-100/70 hover:bg-green-200/80 dark:bg-green-900/25 dark:hover:bg-green-900/45"
            : isSt
                ? "bg-sky-100/60 hover:bg-sky-200/90 dark:bg-sky-950/40 dark:hover:bg-sky-900/50"
                : "bg-violet-100/60 hover:bg-violet-200/90 dark:bg-violet-950/40 dark:hover:bg-violet-900/50";
    return (
        <tr className={cn(
            "border-b border-l-[3px]",
            isSt ? "border-l-sky-500" : "border-l-violet-500",
            // A group is closed and the next one opened by a rule you cannot
            // miss; everything else keeps the hairline.
            row.strongBelow ? "border-b-2 border-b-foreground/30" : "border-b-border/60",
            background,
            r.locked && "opacity-60",
        )}>
            <td className="relative px-2 py-1.5 align-top">
                {run && (
                    <span
                        aria-hidden
                        className={cn(
                            "absolute left-0 w-[3px]",
                            run.kind === "suggested" ? "bg-amber-400" : "bg-green-500",
                            run.first ? "top-1.5 rounded-t-full" : "top-0",
                            run.last ? "bottom-1.5 rounded-b-full" : "bottom-0",
                        )}
                    />
                )}
                {!matched && !r.locked && (
                    <input type="checkbox" checked={selected} onChange={onToggle} aria-label={isSt ? `Select statement line ${formatDate(r.date)} ${row.st.narration}` : `Select book entry ${row.gl.voucherNo}`} />
                )}
                {matched && <CheckCircle2 size={13} className="text-green-600" />}
                {r.locked && <Lock size={11} className="text-muted-foreground" />}
            </td>
            <td className="px-2 py-1.5 align-top">
                <span className={cn(
                    "inline-block rounded px-1.5 py-0.5 text-[10px] font-medium",
                    isSt ? "bg-sky-200 text-sky-900 dark:bg-sky-900/60 dark:text-sky-100" : "bg-violet-200 text-violet-900 dark:bg-violet-900/60 dark:text-violet-100",
                )}>{isSt ? "Bank" : "Books"}</span>
                {sug && run?.first && (
                    <button
                        type="button"
                        onClick={() => onSelectGroup(sug)}
                        disabled={busy}
                        title={`Same date, same amount — tick these ${sug.size} rows ready to match`}
                        className="mt-0.5 block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 hover:bg-amber-200 dark:bg-amber-900/50 dark:text-amber-100 dark:hover:bg-amber-900"
                    >
                        Select {sug.size}
                    </button>
                )}
            </td>
            <td className="whitespace-nowrap px-2 py-1.5 align-top">{formatDate(r.date)}</td>
            <td className="px-2 py-1.5 align-top">
                {isSt ? (
                    <div className="line-clamp-2 break-words" title={row.st.narration}>{row.st.narration}</div>
                ) : (
                    <div className="flex flex-wrap items-baseline gap-x-2">
                        {row.gl.source
                            ? <Link href={row.gl.source.url} className="font-medium text-primary hover:underline">{row.gl.voucherNo}</Link>
                            : <span className="font-medium">{row.gl.voucherNo}</span>}
                        <span className="text-[10px] uppercase text-muted-foreground">{row.gl.voucherType}</span>
                        <span className="line-clamp-2 break-words" title={row.gl.description}>{row.gl.description}</span>
                    </div>
                )}
                <div className="flex flex-wrap gap-x-2 text-[10px] text-muted-foreground">
                    {r.reference && <span className="font-mono">{r.reference}</span>}
                    {!isSt && row.gl.narration && row.gl.narration !== row.gl.description && <span className="truncate">{row.gl.narration}</span>}
                    {matched && isSt && (
                        <span className="text-green-700 dark:text-green-400">
                            ↔ {partners.join(", ")}{row.st.match!.auto ? " · auto" : ""}
                            {matchGap > 0 && <span className="text-amber-600"> · {matchGap} day{matchGap === 1 ? "" : "s"} apart</span>}
                        </span>
                    )}
                    {matched && !isSt && <span className="text-green-700 dark:text-green-400">↔ {row.gl.match!.statementLineIds.length} statement line(s){row.gl.match!.auto ? " · auto" : ""}</span>}
                    {hint && (
                        <button
                            type="button"
                            onClick={onSelectHint}
                            title={`${hint.voucherNo} — ${hint.what}

Same amount, same side, but ${hint.gap} day(s) away with no reference in common, so auto-match will not take it. This ticks both; look, then press Match — or untick.`}
                            className="rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-900 hover:bg-amber-200 dark:bg-amber-900/50 dark:text-amber-100 dark:hover:bg-amber-900"
                        >
                            possible: {hint.voucherNo} · {formatDate(hint.date)} · {hint.gap} day{hint.gap === 1 ? "" : "s"} away{hint.more ? ` (+${hint.more} more)` : ""} — check
                        </button>
                    )}
                    {isSt && row.st.match?.stale && <span className="text-amber-600">matched voucher changed — re-match</span>}
                </div>
            </td>
            <td className="px-2 py-1.5 text-right align-top font-mono">{money(isSt ? row.st.withdrawal : row.gl.credit)}</td>
            <td className="px-2 py-1.5 text-right align-top font-mono">{money(isSt ? row.st.deposit : row.gl.debit)}</td>
            {/* Books rows carry the band too, with no figure, so it never has a hole. */}
            <td className={cn("px-2 py-1.5 text-right align-top font-mono", agreed ? AGREED_CELL : "text-muted-foreground")} title={agreed ? AGREED_TITLE : undefined}>{isSt && row.st.balance != null ? fmt(row.st.balance) : ""}</td>
            <td className="whitespace-nowrap px-2 py-1.5 text-right align-top">
                {matched && !r.locked && (
                    <button type="button" className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-red-600" disabled={busy} onClick={onUnmatch} title="Unmatch"><Unlink size={12} /></button>
                )}
                {isSt && !matched && !r.locked && (
                    <span className="inline-flex items-center gap-0.5">
                        <Sparkles size={11} className="text-muted-foreground" />
                        <button type="button" className="rounded px-1 text-[11px] text-primary hover:underline" disabled={busy} onClick={() => onBook(row.st.deposit != null ? "RECEIPT" : "PAYMENT")}>{row.st.deposit != null ? "Receipt" : "Payment"}</button>
                        <button type="button" className="rounded px-1 text-[11px] text-primary hover:underline" disabled={busy} onClick={() => onBook("CONTRA")}>Contra</button>
                    </span>
                )}
            </td>
        </tr>
    );
}

function StatementRowView({ r, selected, onToggle, onUnmatch, onBook, busy, glById, agreed, hint, onSelectHint }: {
    r: StatementLineView; selected: boolean; onToggle: () => void; onUnmatch: () => void;
    onBook: (kind: "PAYMENT" | "RECEIPT" | "CONTRA") => void; busy: boolean; glById: GlLineView[];
    agreed: boolean; hint?: CrossDateHint; onSelectHint: () => void;
}) {
    const matched = r.match != null && !r.match.stale;
    const partners = matched ? r.match!.glLineIds.map((id) => glById.find((g) => g.id === id)?.voucherNo ?? `#${id}`) : [];
    const matchGap = matched ? matchGapDays(r.date, r.match!.glLineIds, glById) : 0;
    return (
        <tr className={cn("hover:bg-muted/40", selected ? "bg-primary/15" : matched && "bg-green-50/40 dark:bg-green-900/10", r.locked && "opacity-60")}>
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
                    {matched && (
                        <span className="text-green-700 dark:text-green-400">
                            ↔ {partners.join(", ")}{r.match!.auto ? " · auto" : ""}
                            {matchGap > 0 && <span className="text-amber-600"> · {matchGap} day{matchGap === 1 ? "" : "s"} apart</span>}
                        </span>
                    )}
                    {hint && (
                        <button
                            type="button"
                            onClick={onSelectHint}
                            title={`${hint.voucherNo} — ${hint.what}

Same amount, same side, but ${hint.gap} day(s) away with no reference in common, so auto-match will not take it. This ticks both; look, then press Match — or untick.`}
                            className="rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-900 hover:bg-amber-200 dark:bg-amber-900/50 dark:text-amber-100 dark:hover:bg-amber-900"
                        >
                            possible: {hint.voucherNo} · {formatDate(hint.date)} · {hint.gap} day{hint.gap === 1 ? "" : "s"} away{hint.more ? ` (+${hint.more} more)` : ""} — check
                        </button>
                    )}
                    {r.match?.stale && <span className="text-amber-600">matched voucher changed — re-match</span>}
                </div>
            </td>
            <td className="px-2 py-1.5 text-right font-mono align-top">{money(r.withdrawal)}</td>
            <td className="px-2 py-1.5 text-right font-mono align-top">{money(r.deposit)}</td>
            <td className={cn("px-2 py-1.5 text-right font-mono align-top", agreed ? AGREED_CELL : "text-muted-foreground")} title={agreed ? AGREED_TITLE : undefined}>{r.balance != null ? fmt(r.balance) : ""}</td>
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
        <tr className={cn("hover:bg-muted/40", selected ? "bg-primary/15" : matched && "bg-green-50/40 dark:bg-green-900/10", r.locked && "opacity-60")}>
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
