"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
    PhoneIncoming, PhoneOutgoing, PhoneMissed, ArrowLeftRight, HelpCircle,
    User, Building2, UserPlus, ShieldAlert, ShieldCheck, StickyNote, RefreshCw, Search, CalendarDays,
    Eraser,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { formatDateTime, formatCallerNumber, phoneMatchKey } from "@/shared/lib/format";
import type { MissedMode } from "@/shared/lib/calls";
import CreatePersonDialog from "@/shared/components/CreatePersonDialog";
import { extractApiError } from "@/shared/lib/api";
import { useRealtimeTopics } from "@/shared/hooks";
import { usePartySearch } from "@/shared/hooks/usePartySearch";

// ── Wire type (mirrors GET /api/calls) ──────────────────────────────────────────
type Direction = "INCOMING" | "OUTGOING" | "INTERNAL" | "UNKNOWN";
interface CallGuess { kind: "person" | "company"; id: number; name: string; phone: string }
interface CallItem {
    id: number;
    direction: Direction;
    phone: string | null;
    rawNumber: string | null;
    fromExt: string | null;
    toExt: string | null;
    trunk: string | null;
    status: string | null;
    durationSec: number;
    speechSec: number;
    answerSec: number;
    holdSec: number;
    missed: boolean;
    note: string | null;
    spam: boolean;
    // Hostname of the counter PC whose bridge pushed this record. Null on rows
    // logged before the bridge started reporting it.
    sourceHost: string | null;
    // Other PCs that pushed the same call but lost the de-dupe race.
    alsoPushedBy: string[];
    occurredAt: string;
    customer: { kind: "person" | "company"; id: number; name: string } | null;
    // The EPBX sends an incoming CLI digit by digit; answering before the last
    // digit lands leaves a part number — a real call nobody can ring back.
    partialNumber: boolean;
    // For a part number a staff member has answered: the full number they
    // confirmed. Null while it is still an open question — a stale junk key
    // from before the shape rule is NOT a confirmation. See GET /api/calls.
    completedNumber: string | null;
    // For a part number: the customers whose stored number BEGINS with the
    // digits that did arrive. A shortlist to choose from, never a match — staff
    // pick one and confirm it. See GET /api/calls.
    guesses: CallGuess[];
}
interface CallsResponse { items: CallItem[]; pagination: { page: number; pageSize: number; total: number } }

const PAGE_SIZE = 50;

function durationLabel(sec: number): string {
    if (!sec || sec < 0) return "—";
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, "0")}s`;
}

function DirectionCell({ c }: { c: CallItem }) {
    // Incoming miscall = a customer we missed (red, valuable). Outgoing miscall =
    // our call that went unanswered (amber, staff accountability).
    if (c.missed) {
        return c.direction === "OUTGOING"
            ? <span className="inline-flex items-center gap-1 text-amber-600"><PhoneMissed size={15} /> No answer</span>
            : <span className="inline-flex items-center gap-1 text-red-600"><PhoneMissed size={15} /> Missed</span>;
    }
    if (c.direction === "INCOMING") return <span className="inline-flex items-center gap-1 text-emerald-600"><PhoneIncoming size={15} /> In</span>;
    if (c.direction === "OUTGOING") return <span className="inline-flex items-center gap-1 text-sky-600"><PhoneOutgoing size={15} /> Out</span>;
    if (c.direction === "INTERNAL") return <span className="inline-flex items-center gap-1 text-muted-foreground"><ArrowLeftRight size={15} /> Internal</span>;
    return <span className="inline-flex items-center gap-1 text-muted-foreground"><HelpCircle size={15} /> Unknown</span>;
}

/** yyyy-mm-dd in the browser's local (IST) calendar — matches the API's day filter. */
function toDayStr(d: Date): string {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Day label used for the group-header rows that break the list up by date. */
function dayLabel(iso: string): string {
    return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function CallLogWorkspace() {
    const [items, setItems] = useState<CallItem[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(false);

    // Filters
    const [search, setSearch] = useState("");
    const [missedMode, setMissedMode] = useState<MissedMode>("all");
    const [showSpam, setShowSpam] = useState(false);
    const [showInternal, setShowInternal] = useState(false);
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    // Calls the PBX sent with no number — incoming without CLI, and every
    // unanswered outgoing call (the Matrix only records dialled digits on
    // answer). Stored for accurate volume stats, hidden by default because
    // they can't be called back or matched to a customer.
    const [showNoNumber, setShowNoNumber] = useState(false);

    // Which physical PC's bridge pushed each call. Off by default — it's a
    // diagnostic, not something staff need while working the list.
    const [showHost, setShowHost] = useState(false);

    // Dialogs
    const [leadPhone, setLeadPhone] = useState<string | null>(null);
    const [noteFor, setNoteFor] = useState<CallItem | null>(null);
    const [noteDraft, setNoteDraft] = useState("");
    // The part-number row whose "who called?" shortlist is open, and the pick.
    const [guessFor, setGuessFor] = useState<CallItem | null>(null);
    const [guessPick, setGuessPick] = useState<string>("");
    const [guessSaving, setGuessSaving] = useState(false);
    // "Not in the list" — find any customer by name or number. A wrong CLI
    // shares nothing with the real number, so no shortlist can reach it.
    const [guessSearch, setGuessSearch] = useState("");
    const [noteSaving, setNoteSaving] = useState(false);

    const buildParams = (targetPage: number) => {
        const params = new URLSearchParams();
        params.set("page", String(targetPage));
        params.set("limit", String(PAGE_SIZE));
        if (search.trim()) params.set("search", search.trim());
        if (missedMode !== "all") params.set("missed", missedMode);
        if (showSpam) params.set("spam", "1");
        if (showInternal) params.set("direction", "all");
        if (dateFrom) params.set("from", dateFrom);
        if (dateTo) params.set("to", dateTo);
        if (showNoNumber) params.set("noNumber", "1");
        return params;
    };

    // Page 1 replaces the list; any later page appends to it ("Load more"), so
    // scrolling back through older calls never loses what's already on screen.
    const load = useCallback(async (targetPage: number) => {
        setLoading(true);
        try {
            const { data } = await axios.get<CallsResponse>(`/api/calls?${buildParams(targetPage).toString()}`);
            setItems((prev) => (targetPage === 1 ? data.items : [...prev, ...data.items]));
            setTotal(data.pagination.total);
            setPage(targetPage);
        } catch {
            toast.error("Failed to load calls");
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search, missedMode, showSpam, showInternal, dateFrom, dateTo, showNoNumber]);

    // `load` changes identity whenever a filter changes, which restarts the list
    // from page 1 — no separate page-reset effect needed.
    useEffect(() => { void load(1); }, [load]);

    // Realtime nudge (a new call pushed by the bridge, a note/spam edit by a
    // colleague): merge the first page's worth of rows into whatever is already
    // loaded instead of replacing the list outright — a live signal must not
    // throw away pages the user reached via "Load more".
    const refreshHead = useCallback(async () => {
        try {
            const { data } = await axios.get<CallsResponse>(`/api/calls?${buildParams(1).toString()}`);
            setItems((prev) => {
                const byId = new Map(prev.map((c) => [c.id, c]));
                for (const c of data.items) byId.set(c.id, c);
                return [...byId.values()].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id - a.id);
            });
            setTotal(data.pagination.total);
        } catch { /* next signal, or the manual refresh button, tries again */ }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search, missedMode, showSpam, showInternal, dateFrom, dateTo, showNoNumber]);

    useRealtimeTopics(["tickets"], refreshHead);

    /** Apply a preset day range. Passing null clears the range (= all dates). */
    const setRange = (days: number | null, mode: "last" | "single" | "month" = "last") => {
        if (days === null) { setDateFrom(""); setDateTo(""); return; }
        const now = new Date();
        if (mode === "month") {
            setDateFrom(toDayStr(new Date(now.getFullYear(), now.getMonth(), 1)));
            setDateTo(toDayStr(now));
            return;
        }
        const start = new Date(now);
        start.setDate(start.getDate() - days);
        if (mode === "single") { setDateFrom(toDayStr(start)); setDateTo(toDayStr(start)); return; }
        setDateFrom(toDayStr(start));
        setDateTo(toDayStr(now));
    };

    const toggleSpam = async (c: CallItem) => {
        try {
            await axios.patch(`/api/calls/${c.id}`, { spam: !c.spam });
            toast.success(!c.spam ? "Number flagged as spam" : "Spam flag removed");
            void load(1);
        } catch {
            toast.error("Failed to update spam flag");
        }
    };

    // Customer lookup inside the "Who called?" dialog — the same held party list
    // and the same matcher every party picker uses, so staff search the way they
    // always do. Only parties with a usable number can answer "who called?".
    const { hits: guessMatches } = usePartySearch(
        guessSearch,
        { enabled: guessFor !== null && guessSearch.trim().length >= 2 },
    );
    const guessHits = guessMatches.filter((r) => phoneMatchKey(r.phone));

    /** Answer "who called?" on a broken capture — writes the full number staff gave. */
    const confirmGuess = async () => {
        if (!guessFor || !guessPick) return;
        setGuessSaving(true);
        try {
            await axios.patch(`/api/calls/${guessFor.id}`, { confirmPhone: guessPick });
            toast.success("Number set");
            setGuessFor(null);
            void load(1);
        } catch (e) {
            toast.error(extractApiError(e, "Failed to confirm the number"));
        } finally {
            setGuessSaving(false);
        }
    };

    /** Undo a wrong pick — back to Unknown, with the part capture untouched. */
    const clearConfirmed = async (c: CallItem) => {
        try {
            await axios.patch(`/api/calls/${c.id}`, { confirmPhone: null });
            toast.success("Confirmation cleared");
            void load(1);
        } catch (e) {
            toast.error(extractApiError(e, "Failed to clear the confirmation"));
        }
    };

    // Base columns + the optional "Pushed by" one; drives every colSpan.
    const colCount = showHost ? 9 : 8;

    const openNote = (c: CallItem) => { setNoteFor(c); setNoteDraft(c.note ?? ""); };
    const saveNote = async () => {
        if (!noteFor) return;
        setNoteSaving(true);
        try {
            await axios.patch(`/api/calls/${noteFor.id}`, { note: noteDraft.trim() || null });
            toast.success("Note saved");
            setNoteFor(null);
            void load(1);
        } catch {
            toast.error("Failed to save note");
        } finally {
            setNoteSaving(false);
        }
    };



    return (
        <div className="flex h-full flex-col gap-3 p-4">
            {/* Filter bar */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                    <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search number…"
                        className="h-9 w-56 pl-8"
                    />
                </div>
                <div className="inline-flex items-center gap-3 text-sm">
                    <PhoneMissed size={15} className="text-muted-foreground" />
                    {/* Two ticks, mutually exclusive (ticking one clears the other);
                        neither ticked = "all" (default). */}
                    <label className="flex items-center gap-1.5">
                        <Checkbox
                            checked={missedMode === "only"}
                            onCheckedChange={(v) => setMissedMode(v === true ? "only" : "all")}
                        />
                        Miss call only
                    </label>
                    <label className="flex items-center gap-1.5">
                        <Checkbox
                            checked={missedMode === "exclude"}
                            onCheckedChange={(v) => setMissedMode(v === true ? "exclude" : "all")}
                        />
                        No misscall
                    </label>
                </div>
                <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={showInternal} onCheckedChange={(v) => setShowInternal(v === true)} /> Include internal
                </label>
                <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={showSpam} onCheckedChange={(v) => setShowSpam(v === true)} /> Spam
                </label>
                <label className="flex items-center gap-2 text-sm" title="Calls the PBX sent with no number — incoming without caller ID, and unanswered outgoing calls">
                    <Checkbox checked={showNoNumber} onCheckedChange={(v) => setShowNoNumber(v === true)} /> No-number calls
                </label>
                <label className="flex items-center gap-2 text-sm" title="Show which counter PC's bridge pushed each call">
                    <Checkbox checked={showHost} onCheckedChange={(v) => setShowHost(v === true)} /> Pushed by
                </label>
                <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
                    <span>{total} call{total === 1 ? "" : "s"}</span>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void load(1)} disabled={loading}>
                        <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
                    </Button>
                </div>
            </div>

            {/* Date range — most lookups are "recent" or "one specific day", so
                presets cover them and the two inputs handle anything else. */}
            <div className="flex flex-wrap items-center gap-2 text-sm">
                <CalendarDays size={15} className="text-muted-foreground" />
                {([
                    ["Today", () => setRange(0, "single")],
                    ["Yesterday", () => setRange(1, "single")],
                    ["Last 7 days", () => setRange(6)],
                    ["This month", () => setRange(0, "month")],
                ] as const).map(([label, apply]) => (
                    <Button key={label} variant="outline" size="sm" className="h-8" onClick={apply}>{label}</Button>
                ))}
                <TallyDateInput value={dateFrom} onValueChange={setDateFrom} className="h-8 w-38" aria-label="From date" />
                <span className="text-muted-foreground">to</span>
                <TallyDateInput value={dateTo} onValueChange={setDateTo} monthMode="end" className="h-8 w-38" aria-label="To date" />
                {(dateFrom || dateTo) && (
                    <Button variant="ghost" size="sm" className="h-8" onClick={() => setRange(null)}>Clear</Button>
                )}
            </div>

            {/* List */}
            <div className="min-h-0 flex-1 overflow-auto rounded-md border">
                <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted/99 text-left text-xs uppercase text-muted-foreground">
                        <tr>
                            <th className="px-3 py-2 font-medium">When</th>
                            <th className="px-3 py-2 font-medium">Direction</th>
                            <th className="px-3 py-2 font-medium">Number</th>
                            <th className="px-3 py-2 font-medium">Customer</th>
                            <th className="px-3 py-2 font-medium">Ext / Trunk</th>
                            {showHost && <th className="px-3 py-2 font-medium">Pushed by</th>}
                            <th className="px-3 py-2 font-medium">Duration</th>
                            <th className="px-3 py-2 font-medium">Note</th>
                            <th className="px-3 py-2 text-right font-medium">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.length === 0 && !loading && (
                            <tr><td colSpan={colCount} className="px-3 py-10 text-center text-muted-foreground">No calls found.</td></tr>
                        )}
                        {items.map((c, i) => (
                            <Fragment key={c.id}>
                                {/* Day divider — landmarks while scanning a long list. */}
                                {(i === 0 || dayLabel(items[i - 1].occurredAt) !== dayLabel(c.occurredAt)) && (
                                    <tr className="border-t bg-muted/40">
                                        <td colSpan={colCount} className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                                            {dayLabel(c.occurredAt)}
                                        </td>
                                    </tr>
                                )}
                                <tr className={`border-t ${c.spam ? "bg-red-50/60" : ""}`}>
                                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatDateTime(c.occurredAt)}</td>
                                    <td className="whitespace-nowrap px-3 py-2"><DirectionCell c={c} /></td>
                                    <td
                                        className="whitespace-nowrap px-3 py-2 font-medium"
                                        title={
                                            c.completedNumber
                                                ? `The PBX sent only ${c.rawNumber} — completed by staff`
                                                : (c.rawNumber ?? undefined)
                                        }
                                    >
                                        {/* A completed part number shows the number staff confirmed;
                                            the short capture stays in the tooltip, and in rawNumber. */}
                                        {c.completedNumber
                                            ? formatCallerNumber(c.completedNumber)
                                            : formatCallerNumber(c.rawNumber, c.direction)}
                                        {c.partialNumber && (
                                            c.completedNumber ? (
                                                <span
                                                    className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
                                                    title="Arrived incomplete; a staff member confirmed the full number."
                                                >
                                                    completed
                                                </span>
                                            ) : (
                                                <span
                                                    className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800"
                                                    title="The number arrived incomplete — the call was answered before the EPBX finished sending it."
                                                >
                                                    part number
                                                </span>
                                            )
                                        )}
                                    </td>
                                    <td className="px-3 py-2">
                                        {c.customer ? (
                                            <span className="inline-flex items-center gap-1.5">
                                                {c.customer.kind === "person" ? <User size={14} /> : <Building2 size={14} />}
                                                {c.customer.name}
                                            </span>
                                        ) : c.guesses.length ? (
                                            <button
                                                type="button"
                                                className="inline-flex items-center gap-1.5 rounded px-1 text-amber-700 underline decoration-dotted underline-offset-2 hover:bg-amber-50"
                                                title="The number arrived one digit short. These customers' numbers begin with the digits we got — pick the right one."
                                                onClick={() => { setGuessFor(c); setGuessPick(c.guesses[0].phone); setGuessSearch(""); }}
                                            >
                                                {c.guesses.length === 1
                                                    ? `${c.guesses[0].name}?`
                                                    : `${c.guesses.length} possible`}
                                            </button>
                                        ) : c.partialNumber ? (
                                            // Nothing to predict from — a wrong CLI shares no digits
                                            // with the real number — but the call was real, so staff
                                            // can still say who rang.
                                            <button
                                                type="button"
                                                className="rounded px-1 text-muted-foreground underline decoration-dotted underline-offset-2 hover:bg-muted/50"
                                                title="The number did not arrive properly. Set the customer who called."
                                                onClick={() => { setGuessFor(c); setGuessPick(""); setGuessSearch(""); }}
                                            >
                                                Set caller
                                            </button>
                                        ) : (
                                            <span className="text-muted-foreground">Unknown</span>
                                        )}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                                        {[c.fromExt && `from ${c.fromExt}`, c.toExt && `to ${c.toExt}`, c.trunk].filter(Boolean).join(" · ") || "—"}
                                    </td>
                                    {showHost && (
                                        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                                            {c.sourceHost ?? <span className="text-muted-foreground/65">—</span>}
                                            {c.alsoPushedBy.length > 0 && (
                                                <span
                                                    className="block text-[11px] text-muted-foreground/60"
                                                    title="Also pushed this call, but arrived after the winner"
                                                >
                                                    also {c.alsoPushedBy.join(", ")}
                                                </span>
                                            )}
                                        </td>
                                    )}
                                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{c.missed ? "—" : durationLabel(c.speechSec || c.durationSec)}</td>
                                    <td className="max-w-[16rem] truncate px-3 py-2 text-muted-foreground">{c.note ?? ""}</td>
                                    <td className="whitespace-nowrap px-3 py-2 text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Add / edit note" onClick={() => openNote(c)}>
                                                <StickyNote size={15} />
                                            </Button>
                                            {c.completedNumber && (
                                                <Button
                                                    variant="ghost" size="icon" className="h-8 w-8"
                                                    title="Clear this confirmation — back to Unknown"
                                                    onClick={() => void clearConfirmed(c)}
                                                >
                                                    <Eraser size={15} />
                                                </Button>
                                            )}
                                            {/* No lead from a part number — it would save a phone nobody can ring. */}
                                            {!c.customer && c.rawNumber && !c.partialNumber && (
                                                <Button variant="ghost" size="icon" className="h-8 w-8" title="Create lead from this number" onClick={() => setLeadPhone(formatCallerNumber(c.rawNumber, c.direction))}>
                                                    <UserPlus size={15} />
                                                </Button>
                                            )}
                                            <Button
                                                variant="ghost" size="icon" className="h-8 w-8"
                                                title={c.spam ? "Remove spam flag" : "Flag number as spam"}
                                                onClick={() => void toggleSpam(c)}
                                            >
                                                {c.spam ? <ShieldCheck size={15} className="text-emerald-600" /> : <ShieldAlert size={15} className="text-red-500" />}
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            </Fragment>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Load more — appends the next page rather than replacing the list, so
                you keep your place instead of jumping back to the top. */}
            <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Showing {items.length} of {total}</span>
                {items.length < total && (
                    <Button variant="outline" size="sm" disabled={loading} onClick={() => void load(page + 1)}>
                        {loading ? "Loading…" : "Load more"}
                    </Button>
                )}
            </div>

            {/* "Who called?" — the shortlist for a part number. A part capture one
                digit short has ten possible numbers, so more than one customer can
                fit; staff pick the right one and the row becomes a normal call. */}
            <Dialog open={guessFor !== null} onOpenChange={(o) => { if (!o) setGuessFor(null); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader><DialogTitle>Who called?</DialogTitle></DialogHeader>
                    {guessFor && (
                        <div className="space-y-3">
                            <p className="text-sm text-muted-foreground">
                                {guessFor.guesses.length ? (
                                    <>
                                        The number arrived incomplete — the EPBX sent only{" "}
                                        <span className="font-medium text-foreground">{guessFor.rawNumber}</span>{" "}
                                        before the call was answered. These customers&apos; numbers begin
                                        with those digits. Pick the one who rang, or ring back to check first.
                                    </>
                                ) : (
                                    <>
                                        The number did not arrive properly — the PBX sent only{" "}
                                        <span className="font-medium text-foreground">{guessFor.rawNumber}</span>,
                                        which shares nothing with a real number. The call was real, so search
                                        for the customer who rang and set their number.
                                    </>
                                )}
                            </p>
                            <div className="space-y-1">
                                {guessFor.guesses.map((g) => (
                                    <label
                                        key={g.phone}
                                        className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-sm ${
                                            guessPick === g.phone ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                                        }`}
                                    >
                                        <input
                                            type="radio"
                                            name="call-guess"
                                            value={g.phone}
                                            checked={guessPick === g.phone}
                                            onChange={() => setGuessPick(g.phone)}
                                        />
                                        {g.kind === "person" ? <User size={14} /> : <Building2 size={14} />}
                                        <span className="font-medium">{g.name}</span>
                                        <span className="ml-auto text-muted-foreground">{g.phone}</span>
                                    </label>
                                ))}
                            </div>
                            {/* No shortlist can reach a wrong CLI, and a shortlist can
                                be wrong — so any customer is reachable from here. */}
                            <div className="space-y-1 border-t pt-3">
                                <Input
                                    placeholder={guessFor.guesses.length ? "Not in the list? Search name or number…" : "Search name or number…"}
                                    value={guessSearch}
                                    onChange={(e) => setGuessSearch(e.target.value)}
                                />
                                {guessHits.map((h) => {
                                    const key = phoneMatchKey(h.phone) ?? "";
                                    return (
                                        <button
                                            key={`${h.type}-${h.id}`}
                                            type="button"
                                            className={`flex w-full items-center gap-2 rounded border px-3 py-2 text-left text-sm ${
                                                guessPick === key ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                                            }`}
                                            onClick={() => setGuessPick(key)}
                                        >
                                            {h.type === "customer" ? <User size={14} /> : <Building2 size={14} />}
                                            <span className="font-medium">{h.name}</span>
                                            <span className="ml-auto text-muted-foreground">{key}</span>
                                        </button>
                                    );
                                })}
                                {guessSearch.trim().length >= 2 && guessHits.length === 0 && (
                                    <p className="px-1 py-2 text-sm text-muted-foreground">
                                        No customer found with a complete number.
                                    </p>
                                )}
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setGuessFor(null)}>Cancel</Button>
                        <Button disabled={!guessPick || guessSaving} onClick={() => void confirmGuess()}>
                            {guessSaving ? "Saving…" : "Confirm"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Create-lead dialog (person), phone prefilled */}
            <CreatePersonDialog
                open={leadPhone !== null}
                onOpenChange={(o) => { if (!o) { setLeadPhone(null); void load(1); } }}
                initialPhone={leadPhone ?? undefined}
            />

            {/* Note dialog */}
            <Dialog open={noteFor !== null} onOpenChange={(o) => { if (!o) setNoteFor(null); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader><DialogTitle>Call note</DialogTitle></DialogHeader>
                    <Textarea
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        placeholder="What was this call about?"
                        rows={4}
                    />
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setNoteFor(null)}>Cancel</Button>
                        <Button onClick={() => void saveNote()} disabled={noteSaving}>{noteSaving ? "Saving…" : "Save"}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
