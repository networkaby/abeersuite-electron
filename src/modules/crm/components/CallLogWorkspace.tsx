"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
    PhoneIncoming, PhoneOutgoing, PhoneMissed, ArrowLeftRight, HelpCircle,
    User, Building2, UserPlus, ShieldAlert, ShieldCheck, StickyNote, RefreshCw, Search, CalendarDays,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { formatDateTime, formatCallerNumber } from "@/shared/lib/format";
import type { MissedMode } from "@/shared/lib/calls";
import CreatePersonDialog from "@/shared/components/CreatePersonDialog";

// ── Wire type (mirrors GET /api/calls) ──────────────────────────────────────────
type Direction = "INCOMING" | "OUTGOING" | "INTERNAL" | "UNKNOWN";
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
    const [noteSaving, setNoteSaving] = useState(false);

    // Page 1 replaces the list; any later page appends to it ("Load more"), so
    // scrolling back through older calls never loses what's already on screen.
    const load = useCallback(async (targetPage: number) => {
        setLoading(true);
        try {
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
            const { data } = await axios.get<CallsResponse>(`/api/calls?${params.toString()}`);
            setItems((prev) => (targetPage === 1 ? data.items : [...prev, ...data.items]));
            setTotal(data.pagination.total);
            setPage(targetPage);
        } catch {
            toast.error("Failed to load calls");
        } finally {
            setLoading(false);
        }
    }, [search, missedMode, showSpam, showInternal, dateFrom, dateTo, showNoNumber]);

    // `load` changes identity whenever a filter changes, which restarts the list
    // from page 1 — no separate page-reset effect needed.
    useEffect(() => { void load(1); }, [load]);

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
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 w-[9.5rem]" aria-label="From date" />
                <span className="text-muted-foreground">to</span>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 w-[9.5rem]" aria-label="To date" />
                {(dateFrom || dateTo) && (
                    <Button variant="ghost" size="sm" className="h-8" onClick={() => setRange(null)}>Clear</Button>
                )}
            </div>

            {/* List */}
            <div className="min-h-0 flex-1 overflow-auto rounded-md border">
                <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted/60 text-left text-xs uppercase text-muted-foreground">
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
                                <td className="whitespace-nowrap px-3 py-2 font-medium">{formatCallerNumber(c.rawNumber)}</td>
                                <td className="px-3 py-2">
                                    {c.customer ? (
                                        <span className="inline-flex items-center gap-1.5">
                                            {c.customer.kind === "person" ? <User size={14} /> : <Building2 size={14} />}
                                            {c.customer.name}
                                        </span>
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
                                        {!c.customer && c.rawNumber && (
                                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Create lead from this number" onClick={() => setLeadPhone(formatCallerNumber(c.rawNumber))}>
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
