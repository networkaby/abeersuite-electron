"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
    PhoneIncoming, PhoneOutgoing, PhoneMissed, ArrowLeftRight, HelpCircle,
    User, Building2, UserPlus, ShieldAlert, ShieldCheck, StickyNote, RefreshCw, Search,
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

    // Dialogs
    const [leadPhone, setLeadPhone] = useState<string | null>(null);
    const [noteFor, setNoteFor] = useState<CallItem | null>(null);
    const [noteDraft, setNoteDraft] = useState("");
    const [noteSaving, setNoteSaving] = useState(false);

    const fetchCalls = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            params.set("page", String(page));
            params.set("limit", String(PAGE_SIZE));
            if (search.trim()) params.set("search", search.trim());
            if (missedMode !== "all") params.set("missed", missedMode);
            if (showSpam) params.set("spam", "1");
            if (showInternal) params.set("direction", "all");
            const { data } = await axios.get<CallsResponse>(`/api/calls?${params.toString()}`);
            setItems(data.items);
            setTotal(data.pagination.total);
        } catch {
            toast.error("Failed to load calls");
        } finally {
            setLoading(false);
        }
    }, [page, search, missedMode, showSpam, showInternal]);

    useEffect(() => { void fetchCalls(); }, [fetchCalls]);

    // Reset to page 1 whenever a filter changes.
    useEffect(() => { setPage(1); }, [search, missedMode, showSpam, showInternal]);

    const toggleSpam = async (c: CallItem) => {
        try {
            await axios.patch(`/api/calls/${c.id}`, { spam: !c.spam });
            toast.success(!c.spam ? "Number flagged as spam" : "Spam flag removed");
            void fetchCalls();
        } catch {
            toast.error("Failed to update spam flag");
        }
    };

    const openNote = (c: CallItem) => { setNoteFor(c); setNoteDraft(c.note ?? ""); };
    const saveNote = async () => {
        if (!noteFor) return;
        setNoteSaving(true);
        try {
            await axios.patch(`/api/calls/${noteFor.id}`, { note: noteDraft.trim() || null });
            toast.success("Note saved");
            setNoteFor(null);
            void fetchCalls();
        } catch {
            toast.error("Failed to save note");
        } finally {
            setNoteSaving(false);
        }
    };

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
                <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
                    <span>{total} call{total === 1 ? "" : "s"}</span>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void fetchCalls()} disabled={loading}>
                        <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
                    </Button>
                </div>
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
                            <th className="px-3 py-2 font-medium">Duration</th>
                            <th className="px-3 py-2 font-medium">Note</th>
                            <th className="px-3 py-2 text-right font-medium">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.length === 0 && !loading && (
                            <tr><td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">No calls found.</td></tr>
                        )}
                        {items.map((c) => (
                            <tr key={c.id} className={`border-t ${c.spam ? "bg-red-50/60" : ""}`}>
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
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Page {page} of {totalPages}</span>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                    <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
                </div>
            </div>

            {/* Create-lead dialog (person), phone prefilled */}
            <CreatePersonDialog
                open={leadPhone !== null}
                onOpenChange={(o) => { if (!o) { setLeadPhone(null); void fetchCalls(); } }}
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
