"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { toast } from "sonner";
import {
    Search, Phone, StickyNote, CalendarCheck, CheckSquare, Send, ShoppingCart, CreditCard,
    Wrench, HelpCircle, Handshake, Sparkles, RefreshCw, User, Building2, PhoneOff, PlusCircle,
    Package, ShieldCheck, ShieldAlert, Clock, Bookmark, Users2, X, PhoneIncoming, PhoneOutgoing, PhoneMissed, ArrowDownUp,
    MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/shared/components/NumericInput";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import CreatePersonDialog from "@/shared/components/CreatePersonDialog";
import { useNow, usePositionPicker } from "@/shared/hooks";
import { formatDate, formatDateTime } from "@/shared/lib/format";
import type { MissedMode } from "@/shared/lib/calls";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { LIFECYCLE_META, LIFECYCLES, type ContactLifecycle } from "@/modules/customer/lib/contactTypes";

// ── Wire types (mirror the reconnect APIs) ──────────────────────────────────────
type Kind = "person" | "company" | "caller";
interface Candidate {
    kind: Kind;
    id: number;
    name: string;
    phone: string | null;
    lifecycleStage: ContactLifecycle;
    ownerPositionId: string | null;
    lastActivityAt: string | null;
    dormantDays: number | null;
    /** Unsaved numbers only: reached us by call, message or both. */
    via?: "call" | "message" | "both";
}
/** One WhatsApp message of an unsaved number (from /api/messages/thread). */
interface CallerMessage { type: "message"; id: number; at: string; direction: string; kind: string; body: string; sentBy: string | null }
type ThreadItem = CallerMessage | { type: "call" };
interface CandidatesResponse { candidates: Candidate[]; total: number; nextCursor: number | null; truncated: boolean }

type TimelineSource = "sale" | "payment" | "repair" | "inquiry" | "deal" | "note" | "call" | "message" | "meeting" | "task";
interface TimelineEntry {
    key: string; at: string; source: TimelineSource; title: string;
    detail?: string; amountPaise?: number; ref?: { kind: "ticket" | "voucher"; id: number }; author?: string;
    direction?: "in" | "out";
    missed?: boolean;
}
interface TalkingPoint { line: string; fromKey: string }
interface Timeline { entries: TimelineEntry[]; talkingPoints: TalkingPoint[]; lastActivityAt: string | null }

interface PurchasedItem {
    productId: number; name: string; category: string | null;
    qty: number; times: number; lastBoughtAt: string; amountPaise: number; warrantyEndsAt: string | null;
}

interface CallerCall {
    id: number;
    direction: string;
    rawNumber: string | null;
    durationSec: number;
    speechSec: number;
    missed: boolean;
    note: string | null;
    occurredAt: string;
}

interface GroupOption { id: number; name: string }
interface CategoryOption { id: number; name: string }
interface WarrantyTermOption { id: number; name: string; durationDays: number | null }

type ActivityType = "any" | "sale" | "repair" | "inquiry" | "deal" | "note";
const ACTIVITY_TYPES: { value: ActivityType; label: string }[] = [
    { value: "any", label: "Any activity" },
    { value: "sale", label: "Sale" },
    { value: "repair", label: "Repair" },
    { value: "inquiry", label: "Inquiry" },
    { value: "deal", label: "Deal" },
    { value: "note", label: "Call / note" },
];
const FILTER_KEYS = ["activity", "activityType", "callLog", "messages", "sold", "notSold", "warranty", "revenue", "profit", "stage", "group", "owner", "type", "includeUnsaved"] as const;
type FilterKey = typeof FILTER_KEYS[number];
const noFilters = (): Record<FilterKey, boolean> => Object.fromEntries(FILTER_KEYS.map((k) => [k, false])) as Record<FilterKey, boolean>;

interface SavedFilterDto { id: number; name: string; isShared: boolean; payload: Record<string, unknown>; mine: boolean; ownerName?: string }

const SOURCE_META: Record<TimelineSource, { icon: typeof StickyNote; tint: string }> = {
    sale: { icon: ShoppingCart, tint: "text-green-600" },
    payment: { icon: CreditCard, tint: "text-emerald-600" },
    repair: { icon: Wrench, tint: "text-orange-600" },
    inquiry: { icon: HelpCircle, tint: "text-blue-600" },
    deal: { icon: Handshake, tint: "text-purple-600" },
    note: { icon: StickyNote, tint: "text-muted-foreground" },
    call: { icon: Phone, tint: "text-sky-600" },
    message: { icon: MessageCircle, tint: "text-green-600" },
    meeting: { icon: CalendarCheck, tint: "text-indigo-600" },
    task: { icon: CheckSquare, tint: "text-amber-600" },
};

const COMPOSER_KINDS: { kind: "NOTE" | "CALL" | "MEETING" | "TASK"; label: string; icon: typeof StickyNote }[] = [
    { kind: "CALL", label: "Call", icon: Phone },
    { kind: "NOTE", label: "Note", icon: StickyNote },
    { kind: "MEETING", label: "Meeting", icon: CalendarCheck },
    { kind: "TASK", label: "Task", icon: CheckSquare },
];

const ACTIVITY_MODES: { value: "quiet" | "never" | "all"; label: string }[] = [
    { value: "quiet", label: "Going quiet" },
    { value: "never", label: "Never contacted" },
    { value: "all", label: "Everyone" },
];

function agoShort(iso: string | null, now: number): string {
    if (!iso) return "never";
    const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
    if (days <= 0) return "today";
    if (days === 1) return "1 day";
    if (days < 14) return `${days} days`;
    if (days < 60) return `${Math.round(days / 7)} wks`;
    if (days < 365) return `${Math.round(days / 30)} mo`;
    return `${Math.round(days / 365)} yr`;
}

// ── One filter row — always visible by name; tick to activate, controls drop in ─
// Untick keeps the values in state (retick restores) — the clean "switch off one".
function FilterRow({
    label, checked, onToggle, summary, children, disabled,
}: {
    label: string; checked: boolean; onToggle: (v: boolean) => void; summary?: string; children?: React.ReactNode; disabled?: boolean;
}) {
    return (
        <div className={`border-b py-1.5 last:border-b-0 ${disabled ? "opacity-40 pointer-events-none" : ""}`}>
            <label className="flex cursor-pointer items-center gap-2">
                <Checkbox checked={checked} onCheckedChange={(v) => onToggle(v === true)} disabled={disabled} />
                <span className="flex-1 text-sm font-medium">{label}</span>
                {checked && summary && <span className="max-w-[95px] truncate text-[11px] text-primary">{summary}</span>}
            </label>
            {checked && children && <div className="mt-1.5 space-y-1.5 pl-6">{children}</div>}
        </div>
    );
}

// A "last X to Y days ago" window (from = older bound, to = newer). Blank = open.
// Used everywhere a time period is picked (activity, sold, not-sold, value).
function DayWindow({ from, setFrom, to, setTo }: { from: string; setFrom: (v: string) => void; to: string; setTo: (v: string) => void }) {
    return (
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <span>in last</span>
            <NumericInput min={0} value={from} onValueChange={setFrom} placeholder="all" className="h-8 w-14" />
            <span>to</span>
            <NumericInput min={0} value={to} onValueChange={setTo} placeholder="0" className="h-8 w-14" />
            <span>days ago</span>
        </div>
    );
}

// Category + name + a time window — shared by Sold / Not sold.
function ItemPicker({
    categoryId, setCategoryId, q, setQ, fromDays, setFromDays, toDays, setToDays, categories,
}: {
    categoryId: string; setCategoryId: (v: string) => void;
    q: string; setQ: (v: string) => void;
    fromDays: string; setFromDays: (v: string) => void; toDays: string; setToDays: (v: string) => void;
    categories: CategoryOption[];
}) {
    return (
        <>
            <Select value={categoryId || "any"} onValueChange={(v) => setCategoryId(v === "any" ? "" : v)}>
                <SelectTrigger className="h-8"><SelectValue placeholder="Any category" /></SelectTrigger>
                <SelectContent>
                    <SelectItem value="any">Any category</SelectItem>
                    {categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
            </Select>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Item name…" className="h-8" />
            <DayWindow from={fromDays} setFrom={setFromDays} to={toDays} setTo={setToDays} />
        </>
    );
}

// ₹ min–max over a "days ago" window — shared by Revenue / Profit.
function MoneyRange({
    min, setMin, max, setMax, fromDays, setFromDays, toDays, setToDays,
}: {
    min: string; setMin: (v: string) => void; max: string; setMax: (v: string) => void;
    fromDays: string; setFromDays: (v: string) => void; toDays: string; setToDays: (v: string) => void;
}) {
    return (
        <>
            <div className="flex items-center gap-1.5">
                <NumericInput mode="decimal" min={0} value={min} onValueChange={setMin} placeholder="min ₹" className="h-8" />
                <span className="text-xs text-muted-foreground">–</span>
                <NumericInput mode="decimal" min={0} value={max} onValueChange={setMax} placeholder="max ₹" className="h-8" />
            </div>
            <DayWindow from={fromDays} setFrom={setFromDays} to={toDays} setTo={setToDays} />
        </>
    );
}

export default function ReconnectWorkspace({
    groups, categories, warrantyTerms,
}: {
    groups: GroupOption[];
    categories: CategoryOption[];
    warrantyTerms: WarrantyTermOption[];
}) {
    // Seats, and which are mine, from the browser's cached copy — see usePositionPicker.
    const { positions, myPositionIds } = usePositionPicker();

    // "now" read via a hook — calling Date.now() during render trips react-hooks/purity.
    const now = useNow();

    // ── Filter checklist: which rows are ticked (active), + each row's values ─────
    // Untick keeps the value state — only ticked rows contribute to the query.
    const [enabled, setEnabled] = useState<Record<FilterKey, boolean>>({ ...noFilters(), activity: true });
    const toggle = (k: FilterKey) => (v: boolean) => setEnabled((e) => ({ ...e, [k]: v }));

    const [activity, setActivity] = useState<"quiet" | "never" | "all">("quiet");
    const [activityType, setActivityType] = useState<ActivityType>("any");
    const [activityPresence, setActivityPresence] = useState<"has" | "not">("has");
    const [activityFromDays, setActivityFromDays] = useState("");
    const [activityToDays, setActivityToDays] = useState("");
    const [callDir, setCallDir] = useState<"any" | "in" | "out">("out");
    const [callFromDays, setCallFromDays] = useState("");
    const [callToDays, setCallToDays] = useState("");
    const [callMissedMode, setCallMissedMode] = useState<MissedMode>("all");
    const [msgDir, setMsgDir] = useState<"any" | "in" | "out">("in");
    const [msgFromDays, setMsgFromDays] = useState("");
    const [msgToDays, setMsgToDays] = useState("");
    const [soldCategoryId, setSoldCategoryId] = useState("");
    const [soldProductQ, setSoldProductQ] = useState("");
    const [soldFromDays, setSoldFromDays] = useState("");
    const [soldToDays, setSoldToDays] = useState("");
    const [notSoldCategoryId, setNotSoldCategoryId] = useState("");
    const [notSoldProductQ, setNotSoldProductQ] = useState("");
    const [notSoldFromDays, setNotSoldFromDays] = useState("");
    const [notSoldToDays, setNotSoldToDays] = useState("");
    const [warrantyDays, setWarrantyDays] = useState("");
    const [warrantyTermIds, setWarrantyTermIds] = useState<number[]>([]);
    const [revenueMin, setRevenueMin] = useState("");
    const [revenueMax, setRevenueMax] = useState("");
    const [revenueFromDays, setRevenueFromDays] = useState("");
    const [revenueToDays, setRevenueToDays] = useState("");
    const [profitMin, setProfitMin] = useState("");
    const [profitMax, setProfitMax] = useState("");
    const [profitFromDays, setProfitFromDays] = useState("");
    const [profitToDays, setProfitToDays] = useState("");
    const [stage, setStage] = useState<ContactLifecycle | "">("");
    const [groupId, setGroupId] = useState("");
    const [ownerPositionId, setOwnerPositionId] = useState("");
    const [kind, setKind] = useState<"all" | "person" | "company">("all");
    const [q, setQ] = useState("");
    const [sort, setSort] = useState<"quietest" | "recent" | "nameAsc" | "nameDesc">("quietest");

    // ── Saved filters (Zoho-style views) ──
    const [savedFilters, setSavedFilters] = useState<SavedFilterDto[]>([]);
    const [savingNew, setSavingNew] = useState(false);
    const [newName, setNewName] = useState("");
    const [newShared, setNewShared] = useState(false);

    // ── List state ──
    const [list, setList] = useState<Candidate[]>([]);
    const [total, setTotal] = useState(0);
    const [truncated, setTruncated] = useState(false);
    const [nextCursor, setNextCursor] = useState<number | null>(null);
    const [loadingList, setLoadingList] = useState(false);

    // ── Selection + right pane ──
    const [selected, setSelected] = useState<Candidate | null>(null);
    const selectedRef = useRef(selected);
    useEffect(() => { selectedRef.current = selected; });
    const [leadPhone, setLeadPhone] = useState<string | null>(null);
    const [callerCalls, setCallerCalls] = useState<CallerCall[] | null>(null);
    const [callerMessages, setCallerMessages] = useState<CallerMessage[] | null>(null);
    const [loadingCallerCalls, setLoadingCallerCalls] = useState(false);
    const [rightTab, setRightTab] = useState<"timeline" | "items">("timeline");
    const [timeline, setTimeline] = useState<Timeline | null>(null);
    const [loadingTimeline, setLoadingTimeline] = useState(false);
    const [items, setItems] = useState<PurchasedItem[] | null>(null);
    const [loadingItems, setLoadingItems] = useState(false);

    // ── Composer + deal ──
    const [composerKind, setComposerKind] = useState<"NOTE" | "CALL" | "MEETING" | "TASK">("CALL");
    const [body, setBody] = useState("");
    const [posting, setPosting] = useState(false);
    const [dealTitle, setDealTitle] = useState("");
    const [creatingDeal, setCreatingDeal] = useState(false);
    const [showDealForm, setShowDealForm] = useState(false);

    // ── Inline note editing for unsaved caller calls ──
    const [editingCallNoteId, setEditingCallNoteId] = useState<number | null>(null);
    const [callNoteDraft, setCallNoteDraft] = useState("");
    const [savingCallNote, setSavingCallNote] = useState(false);
    const buildQuery = useCallback(() => {
        const p = new URLSearchParams();
        // Activity mode: unticked → show everyone (the base view).
        p.set("activity", enabled.activity ? activity : "all");
        if (enabled.activityType) {
            p.set("activityType", activityType);
            p.set("activityPresence", activityPresence);
            if (activityFromDays.trim()) p.set("activityFromDays", activityFromDays.trim());
            if (activityToDays.trim()) p.set("activityToDays", activityToDays.trim());
        }
        if (enabled.callLog) {
            p.set("callDirection", callDir);
            if (callFromDays.trim()) p.set("callFromDays", callFromDays.trim());
            if (callToDays.trim()) p.set("callToDays", callToDays.trim());
            if (callMissedMode !== "all") p.set("callMissed", callMissedMode);
        }
        if (enabled.messages) {
            p.set("msgDirection", msgDir);
            if (msgFromDays.trim()) p.set("msgFromDays", msgFromDays.trim());
            if (msgToDays.trim()) p.set("msgToDays", msgToDays.trim());
        }
        if (enabled.sold && (soldCategoryId || soldProductQ.trim())) {
            if (soldCategoryId) p.set("soldCategoryId", soldCategoryId);
            if (soldProductQ.trim()) p.set("soldProductQ", soldProductQ.trim());
            if (soldFromDays.trim()) p.set("soldFromDays", soldFromDays.trim());
            if (soldToDays.trim()) p.set("soldToDays", soldToDays.trim());
        }
        if (enabled.notSold && (notSoldCategoryId || notSoldProductQ.trim())) {
            if (notSoldCategoryId) p.set("notSoldCategoryId", notSoldCategoryId);
            if (notSoldProductQ.trim()) p.set("notSoldProductQ", notSoldProductQ.trim());
            if (notSoldFromDays.trim()) p.set("notSoldFromDays", notSoldFromDays.trim());
            if (notSoldToDays.trim()) p.set("notSoldToDays", notSoldToDays.trim());
        }
        if (enabled.warranty && warrantyDays.trim()) {
            p.set("warrantyEndingDays", warrantyDays.trim());
            if (warrantyTermIds.length) p.set("warrantyTermIds", warrantyTermIds.join(","));
        }
        if (enabled.revenue && (revenueMin.trim() || revenueMax.trim())) {
            if (revenueMin.trim()) p.set("revenueMin", revenueMin.trim());
            if (revenueMax.trim()) p.set("revenueMax", revenueMax.trim());
            if (revenueFromDays.trim()) p.set("revenueFromDays", revenueFromDays.trim());
            if (revenueToDays.trim()) p.set("revenueToDays", revenueToDays.trim());
        }
        if (enabled.profit && (profitMin.trim() || profitMax.trim())) {
            if (profitMin.trim()) p.set("profitMin", profitMin.trim());
            if (profitMax.trim()) p.set("profitMax", profitMax.trim());
            if (profitFromDays.trim()) p.set("profitFromDays", profitFromDays.trim());
            if (profitToDays.trim()) p.set("profitToDays", profitToDays.trim());
        }
        if (enabled.stage && stage) p.set("stage", stage);
        if (enabled.group && groupId) p.set("groupId", groupId);
        if (enabled.owner && ownerPositionId) p.set("ownerPositionId", ownerPositionId);
        if (enabled.type && kind !== "all") p.set("kind", kind);
        if (enabled.includeUnsaved) p.set("includeUnsaved", "true");
        if (q.trim()) p.set("q", q.trim());
        p.set("sort", sort);
        return p;
    }, [
        enabled, activity, activityType, activityPresence, activityFromDays, activityToDays,
        callDir, callFromDays, callToDays, callMissedMode, msgDir, msgFromDays, msgToDays,
        soldCategoryId, soldProductQ, soldFromDays, soldToDays,
        notSoldCategoryId, notSoldProductQ, notSoldFromDays, notSoldToDays,
        warrantyDays, warrantyTermIds, revenueMin, revenueMax, revenueFromDays, revenueToDays,
        profitMin, profitMax, profitFromDays, profitToDays, stage, groupId, ownerPositionId, kind, q, sort,
    ]);

    const activeCount = Object.values(enabled).filter(Boolean).length;
    const clearAll = () => setEnabled(noFilters());
    const toggleTerm = (id: number) => setWarrantyTermIds((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

    // ── Saved filters: capture the whole checklist state, and restore it ──────────
    const serializeFilters = (): Record<string, unknown> => ({
        enabled, activity, activityType, activityPresence, activityFromDays, activityToDays,
        callDir, callFromDays, callToDays, callMissedMode, msgDir, msgFromDays, msgToDays,
        soldCategoryId, soldProductQ, soldFromDays, soldToDays,
        notSoldCategoryId, notSoldProductQ, notSoldFromDays, notSoldToDays,
        warrantyDays, warrantyTermIds, revenueMin, revenueMax, revenueFromDays, revenueToDays,
        profitMin, profitMax, profitFromDays, profitToDays, stage, groupId, ownerPositionId, kind, sort,
    });

    const applyFilters = (p: Record<string, unknown>) => {
        const s = (v: unknown, d = "") => (typeof v === "string" ? v : d);
        setEnabled({ ...noFilters(), ...(p.enabled as Record<FilterKey, boolean> | undefined) });
        setActivity((p.activity as typeof activity) ?? "quiet");
        setActivityType((p.activityType as ActivityType) ?? "any");
        setActivityPresence((p.activityPresence as typeof activityPresence) ?? "has");
        setActivityFromDays(s(p.activityFromDays));
        setActivityToDays(s(p.activityToDays));
        setCallDir((p.callDir as "any" | "in" | "out") ?? "out");
        setCallFromDays(s(p.callFromDays));
        setCallToDays(s(p.callToDays));
        setCallMissedMode(p.callMissed === "only" || p.callMissed === "exclude" ? p.callMissed : "all");
        setMsgDir((p.msgDir as "any" | "in" | "out") ?? "in");
        setMsgFromDays(s(p.msgFromDays));
        setMsgToDays(s(p.msgToDays));
        setSoldCategoryId(s(p.soldCategoryId));
        setSoldProductQ(s(p.soldProductQ));
        setSoldFromDays(s(p.soldFromDays));
        setSoldToDays(s(p.soldToDays));
        setNotSoldCategoryId(s(p.notSoldCategoryId));
        setNotSoldProductQ(s(p.notSoldProductQ));
        setNotSoldFromDays(s(p.notSoldFromDays));
        setNotSoldToDays(s(p.notSoldToDays));
        setWarrantyDays(s(p.warrantyDays));
        setWarrantyTermIds(Array.isArray(p.warrantyTermIds) ? (p.warrantyTermIds as number[]) : []);
        setRevenueMin(s(p.revenueMin)); setRevenueMax(s(p.revenueMax));
        setRevenueFromDays(s(p.revenueFromDays)); setRevenueToDays(s(p.revenueToDays));
        setProfitMin(s(p.profitMin)); setProfitMax(s(p.profitMax));
        setProfitFromDays(s(p.profitFromDays)); setProfitToDays(s(p.profitToDays));
        setStage((p.stage as ContactLifecycle | "") ?? "");
        setGroupId(s(p.groupId)); setOwnerPositionId(s(p.ownerPositionId));
        setKind((p.kind as typeof kind) ?? "all");

        setSort((p.sort as typeof sort) ?? "quietest");
    };

    const loadSaved = useCallback(async () => {
        try {
            const res = await axios.get<SavedFilterDto[]>("/api/crm/reconnect/filters");
            setSavedFilters(res.data);
        } catch { /* non-fatal — the bar just shows empty */ }
    }, []);
    useEffect(() => { loadSaved(); }, [loadSaved]);

    // A call logged or a customer contacted from another desk changes who is
    // still worth reconnecting with — and the saved lists this works from.
    // The open customer's timeline / items reload quietly too, so a note logged
    // on another machine appears here without a blank flash.
    useRealtimeTopics(["parties", "tickets"], () => {
        loadSaved(); loadList();
        if (!selected) return;
        if (selected.kind === "caller") { if (selected.phone) void loadCallerCalls(selected.phone, true); return; }
        void loadTimeline(selected, true);
        if (items !== null) void loadItems(selected, true);
    });

    const saveNew = async () => {
        if (!newName.trim()) return;
        try {
            await axios.post("/api/crm/reconnect/filters", { name: newName.trim(), isShared: newShared, payload: serializeFilters() });
            setSavingNew(false); setNewName(""); setNewShared(false);
            await loadSaved();
            toast.success("Filter saved");
        } catch {
            toast.error("Failed to save filter");
        }
    };

    const deleteSaved = async (id: number) => {
        try {
            await axios.delete(`/api/crm/reconnect/filters/${id}`);
            setSavedFilters((prev) => prev.filter((f) => f.id !== id));
        } catch {
            toast.error("Failed to delete filter");
        }
    };

    const loadList = useCallback(async () => {
        setLoadingList(true);
        try {
            const res = await axios.get<CandidatesResponse>(`/api/crm/reconnect/candidates?${buildQuery().toString()}`);
            setList(res.data.candidates);
            setTotal(res.data.total);
            setTruncated(res.data.truncated);
            setNextCursor(res.data.nextCursor);
        } catch {
            toast.error("Failed to load customers");
        } finally {
            setLoadingList(false);
        }
    }, [buildQuery]);

    // Debounce so typing in search / dormancy / item filters doesn't hammer the API.
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(loadList, 300);
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [loadList]);

    const loadMore = async () => {
        if (nextCursor == null) return;
        try {
            const p = buildQuery();
            p.set("cursor", String(nextCursor));
            const res = await axios.get<CandidatesResponse>(`/api/crm/reconnect/candidates?${p.toString()}`);
            setList((prev) => [...prev, ...res.data.candidates]);
            setNextCursor(res.data.nextCursor);
        } catch {
            toast.error("Failed to load more");
        }
    };

    const loadTimeline = useCallback(async (c: Candidate, quiet = false) => {
        if (!quiet) { setLoadingTimeline(true); setTimeline(null); }
        try {
            const res = await axios.get<Timeline>(`/api/crm/reconnect/timeline?kind=${c.kind}&id=${c.id}`);
            // A quiet refresh that lands after the user picked someone else is dropped.
            if (quiet && selectedRef.current !== c) return;
            setTimeline(res.data);
        } catch {
            if (!quiet) toast.error("Failed to load timeline");
        } finally {
            if (!quiet) setLoadingTimeline(false);
        }
    }, []);

    const loadItems = useCallback(async (c: Candidate, quiet = false) => {
        if (!quiet) setLoadingItems(true);
        try {
            const res = await axios.get<{ items: PurchasedItem[] }>(`/api/crm/reconnect/items?kind=${c.kind}&id=${c.id}`);
            if (quiet && selectedRef.current !== c) return;
            setItems(res.data.items);
        } catch {
            if (!quiet) toast.error("Failed to load items");
        } finally {
            if (!quiet) setLoadingItems(false);
        }
    }, []);

    const loadCallerCalls = useCallback(async (phone: string, quiet = false) => {
        if (!quiet) {
            setLoadingCallerCalls(true);
            setCallerCalls(null);
            setCallerMessages(null);
        }
        try {
            const [calls, thread] = await Promise.all([
                axios.get<{ items: CallerCall[] }>(`/api/calls?phone=${encodeURIComponent(phone)}&direction=all`),
                axios.get<{ items: ThreadItem[] }>(`/api/messages/thread?phone=${encodeURIComponent(phone)}`)
                    .catch(() => ({ data: { items: [] as ThreadItem[] } })), // messages are extra — never block the call log
            ]);
            if (quiet && selectedRef.current?.phone !== phone) return;
            setCallerCalls(calls.data.items);
            // Newest first, like the call list.
            setCallerMessages(thread.data.items.filter((i): i is CallerMessage => i.type === "message").reverse());
        } catch {
            if (!quiet) toast.error("Failed to load call log");
        } finally {
            if (!quiet) setLoadingCallerCalls(false);
        }
    }, []);

    const select = (c: Candidate) => {
        setSelected(c);
        setRightTab("timeline");
        setItems(null);
        setCallerCalls(null);
        setCallerMessages(null);
        setShowDealForm(false); setDealTitle(""); setBody(""); setComposerKind("CALL");
        if (c.kind === "caller" && c.phone) {
            void loadCallerCalls(c.phone);
        } else {
            loadTimeline(c);
        }
    };

    // Lazily load the Items tab the first time it's opened for a customer.
    useEffect(() => {
        if (rightTab === "items" && selected && items === null && !loadingItems) loadItems(selected);
    }, [rightTab, selected, items, loadingItems, loadItems]);

    const targetBody = useMemo(
        () => (selected ? (selected.kind === "person" ? { personId: selected.id } : { companyId: selected.id }) : null),
        [selected],
    );

    const addLog = async (direction?: "out" | "in") => {
        if (!selected || !targetBody || !body.trim()) return;
        setPosting(true);
        try {
            await axios.post("/api/crm/reconnect/log", { ...targetBody, kind: composerKind, body: body.trim(), ...(direction ? { direction } : {}) });
            setBody("");
            await loadTimeline(selected);
            toast.success("Added to timeline");
        } catch {
            toast.error("Failed to log");
        } finally {
            setPosting(false);
        }
    };

    const changeStage = async (next: ContactLifecycle) => {
        if (!selected || !targetBody || next === selected.lifecycleStage) return;
        try {
            await axios.patch("/api/crm/reconnect/stage", { ...targetBody, lifecycleStage: next });
            setSelected({ ...selected, lifecycleStage: next });
            setList((prev) => prev.map((c) => (c.kind === selected.kind && c.id === selected.id ? { ...c, lifecycleStage: next } : c)));
            toast.success(`Moved to ${LIFECYCLE_META[next].label}`);
        } catch {
            toast.error("Failed to update stage");
        }
    };

    // Recheck this customer's real record (any repair/sale) and auto-bump Lead/Prospect → Customer.
    // `silent` = called after a bulk refresh, to sync the open customer's badge without a second toast.
    const [refreshingStage, setRefreshingStage] = useState(false);
    const refreshStage = async (opts?: { silent?: boolean }) => {
        if (!selected || !targetBody) return;
        setRefreshingStage(true);
        try {
            const res = await axios.post<{ lifecycleStage: ContactLifecycle; changed: boolean }>("/api/crm/reconnect/refresh-stage", targetBody);
            if (res.data.changed) {
                setSelected({ ...selected, lifecycleStage: res.data.lifecycleStage });
                setList((prev) => prev.map((c) => (c.kind === selected.kind && c.id === selected.id ? { ...c, lifecycleStage: res.data.lifecycleStage } : c)));
                if (!opts?.silent) toast.success(`Has a sale/repair — moved to ${LIFECYCLE_META[res.data.lifecycleStage].label}`);
            } else if (!opts?.silent) {
                toast.message("No change — already up to date");
            }
        } catch {
            if (!opts?.silent) toast.error("Failed to refresh");
        } finally {
            setRefreshingStage(false);
        }
    };

    // Bulk: recheck EVERY Lead/Prospect customer in one background call, then
    // resync the visible list (and the open customer, if any) without blocking the UI.
    const [bulkRefreshing, setBulkRefreshing] = useState(false);
    const refreshAllStages = async () => {
        setBulkRefreshing(true);
        toast.message("Refreshing everyone's stage in the background…");
        try {
            const res = await axios.post<{ checked: number; updated: number }>("/api/crm/reconnect/refresh-stage/all");
            toast.success(`Checked ${res.data.checked} customers — ${res.data.updated} moved to Customer`);
            await loadList();
            if (selected) await refreshStage({ silent: true });
        } catch {
            toast.error("Failed to refresh stages");
        } finally {
            setBulkRefreshing(false);
        }
    };

    const createDeal = async () => {
        if (!selected || !targetBody || !dealTitle.trim()) return;
        setCreatingDeal(true);
        try {
            await axios.post("/api/deals", { title: dealTitle.trim(), ...targetBody });
            setShowDealForm(false); setDealTitle("");
            toast.success("Deal created — find it on the Deals board");
        } catch {
            toast.error("Failed to create deal");
        } finally {
            setCreatingDeal(false);
        }
    };

    // Short value summaries shown on each ticked row.
    const stageSummary = stage ? LIFECYCLE_META[stage].label : "";
    const groupSummary = groups.find((g) => String(g.id) === groupId)?.name ?? "";
    const ownerSummary = positions.find((p) => p.id === ownerPositionId)?.title ?? "";

    return (
        <div className="flex h-full gap-3 p-3">
            {/* ── LEFT: filter checklist (tick to activate, untick keeps values) ── */}
            <aside className="flex w-64 shrink-0 flex-col overflow-y-auto rounded-lg border bg-card">
                {/* Bulk stage recheck — runs in the background, doesn't block the page */}
                <div className="border-b px-3 py-2">
                    <button
                        type="button"
                        onClick={refreshAllStages}
                        disabled={bulkRefreshing}
                        className="flex w-full items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-60"
                        title="Recheck every Lead/Prospect for a real sale/repair and bump to Customer"
                    >
                        <RefreshCw className={`size-3.5 ${bulkRefreshing ? "animate-spin" : ""}`} />
                        {bulkRefreshing ? "Refreshing all stages…" : "Refresh all stages"}
                    </button>
                </div>

                {/* Saved filters (Zoho-style views) */}
                <div className="border-b px-3 py-2">
                    <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground"><Bookmark className="size-3" /> Saved filters</span>
                        <button type="button" onClick={() => setSavingNew((v) => !v)} className="text-[11px] text-primary hover:underline">＋ Save current</button>
                    </div>
                    {savingNew && (
                        <div className="mt-1.5 flex flex-col gap-1.5 rounded border p-1.5">
                            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Filter name…" className="h-7" />
                            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                <Checkbox checked={newShared} onCheckedChange={(v) => setNewShared(v === true)} /> Share with team
                            </label>
                            <div className="flex gap-1">
                                <Button size="sm" className="h-7" onClick={saveNew} disabled={!newName.trim()}>Save</Button>
                                <Button size="sm" variant="ghost" className="h-7" onClick={() => { setSavingNew(false); setNewName(""); }}>Cancel</Button>
                            </div>
                        </div>
                    )}
                    {savedFilters.length > 0 ? (
                        <div className="mt-1.5 flex flex-col gap-0.5">
                            {savedFilters.map((f) => (
                                <div key={f.id} className="group flex items-center gap-1">
                                    <button type="button" onClick={() => applyFilters(f.payload)} className="flex min-w-0 flex-1 items-center gap-1 rounded px-1.5 py-1 text-left text-sm hover:bg-muted">
                                        <span className="truncate">{f.name}</span>
                                        {f.isShared && <Users2 className="size-3 shrink-0 text-muted-foreground" />}
                                        {!f.mine && <span className="shrink-0 text-[10px] text-muted-foreground">· {f.ownerName}</span>}
                                    </button>
                                    {f.mine && (
                                        <button type="button" onClick={() => deleteSaved(f.id)} className="shrink-0 text-muted-foreground opacity-0 hover:text-red-600 group-hover:opacity-100" title="Delete">
                                            <X className="size-3.5" />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        !savingNew && <p className="mt-1 text-[11px] text-muted-foreground">None yet — set filters, then Save current.</p>
                    )}
                </div>

                <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-card px-3 py-2">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">Filters{activeCount ? ` · ${activeCount} on` : ""}</span>
                    <button type="button" onClick={clearAll} className="text-[11px] text-muted-foreground hover:text-foreground">Clear all</button>
                </div>
                <div className="px-3">
                    <FilterRow label="Include unsaved" checked={enabled.includeUnsaved} onToggle={toggle("includeUnsaved")} />

                    <FilterRow label="Activity" checked={enabled.activity} onToggle={toggle("activity")} summary={ACTIVITY_MODES.find((m) => m.value === activity)?.label}>
                        <div className="flex flex-col gap-1">
                            {ACTIVITY_MODES.map((m) => (
                                <button key={m.value} type="button" onClick={() => setActivity(m.value)}
                                    className={`rounded-md px-2.5 py-1 text-left text-sm ${activity === m.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{m.label}</button>
                            ))}
                        </div>
                    </FilterRow>

                    <FilterRow label="Has activity of type" checked={enabled.activityType} onToggle={toggle("activityType")} summary={`${activityPresence === "not" ? "no " : ""}${activityType}`}>
                        <div className="flex gap-1">
                            {(["has", "not"] as const).map((pv) => (
                                <button key={pv} type="button" onClick={() => setActivityPresence(pv)}
                                    className={`flex-1 rounded-md px-2 py-1 text-xs font-medium ${activityPresence === pv ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{pv === "has" ? "Has" : "Doesn't have"}</button>
                            ))}
                        </div>
                        <Select value={activityType} onValueChange={(v) => setActivityType(v as ActivityType)}>
                            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>{ACTIVITY_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                        </Select>
                        <DayWindow from={activityFromDays} setFrom={setActivityFromDays} to={activityToDays} setTo={setActivityToDays} />
                        <p className="text-[11px] text-muted-foreground">Window blank = ever. Use a range for a past period / festive season.</p>
                    </FilterRow>

                    <FilterRow label="Call log" checked={enabled.callLog} onToggle={toggle("callLog")} summary={`${callDir === "any" ? "any call" : callDir === "in" ? "incoming" : "outgoing"}${callMissedMode === "only" ? " · miscalls" : callMissedMode === "exclude" ? " · connected" : ""}`}>
                        <div className="flex gap-1">
                            {([["out", "Outgoing"], ["in", "Incoming"], ["any", "Any"]] as const).map(([d, label]) => (
                                <button key={d} type="button" onClick={() => setCallDir(d)}
                                    className={`flex-1 rounded-md px-2 py-1 text-xs font-medium ${callDir === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{label}</button>
                            ))}
                        </div>
                        <div className="flex items-center gap-3">
                            <PhoneMissed className="size-3.5 shrink-0 text-red-600" />
                            {/* Two ticks, mutually exclusive (ticking one clears the
                                other); neither ticked = include all (default). */}
                            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <Checkbox
                                    checked={callMissedMode === "only"}
                                    onCheckedChange={(v) => setCallMissedMode(v === true ? "only" : "all")}
                                />
                                Miss call only
                            </label>
                            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <Checkbox
                                    checked={callMissedMode === "exclude"}
                                    onCheckedChange={(v) => setCallMissedMode(v === true ? "exclude" : "all")}
                                />
                                No misscall
                            </label>
                        </div>
                        <DayWindow from={callFromDays} setFrom={setCallFromDays} to={callToDays} setTo={setCallToDays} />
                        <p className="text-[11px] text-muted-foreground">
                            {callMissedMode === "only"
                                ? "Customers we MISSED — unanswered calls of this direction — in the window."
                                : callMissedMode === "exclude"
                                    ? "Customers with a CONNECTED call of this direction — miscalls ignored."
                                    : "Customers with any logged call of this direction in the window."}
                        </p>
                    </FilterRow>

                    <FilterRow label="Messages" checked={enabled.messages} onToggle={toggle("messages")} summary={msgDir === "any" ? "any message" : msgDir === "in" ? "received" : "sent"}>
                        <div className="flex gap-1">
                            {([["in", "Received"], ["out", "Sent"], ["any", "Any"]] as const).map(([d, label]) => (
                                <button key={d} type="button" onClick={() => setMsgDir(d)}
                                    className={`flex-1 rounded-md px-2 py-1 text-xs font-medium ${msgDir === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{label}</button>
                            ))}
                        </div>
                        <DayWindow from={msgFromDays} setFrom={setMsgFromDays} to={msgToDays} setTo={setMsgToDays} />
                        <p className="text-[11px] text-muted-foreground">Customers with a WhatsApp message of this direction in the window.</p>
                    </FilterRow>

                    <FilterRow label="Sold item" checked={enabled.sold} onToggle={toggle("sold")} summary={[categories.find((c) => String(c.id) === soldCategoryId)?.name, soldProductQ.trim()].filter(Boolean).join(" · ")}>
                        <ItemPicker categoryId={soldCategoryId} setCategoryId={setSoldCategoryId} q={soldProductQ} setQ={setSoldProductQ} fromDays={soldFromDays} setFromDays={setSoldFromDays} toDays={soldToDays} setToDays={setSoldToDays} categories={categories} />
                        <p className="text-[11px] text-muted-foreground">We sold them this — pitch a related item (printer → ink).</p>
                    </FilterRow>

                    <FilterRow label="Not sold" checked={enabled.notSold} onToggle={toggle("notSold")} summary={[categories.find((c) => String(c.id) === notSoldCategoryId)?.name, notSoldProductQ.trim()].filter(Boolean).join(" · ")}>
                        <ItemPicker categoryId={notSoldCategoryId} setCategoryId={setNotSoldCategoryId} q={notSoldProductQ} setQ={setNotSoldProductQ} fromDays={notSoldFromDays} setFromDays={setNotSoldFromDays} toDays={notSoldToDays} setToDays={setNotSoldToDays} categories={categories} />
                        <p className="text-[11px] text-muted-foreground">We never sold them this — e.g. has a printer, no ink in 60 days.</p>
                    </FilterRow>

                    <FilterRow label="Warranty ending" checked={enabled.warranty} onToggle={toggle("warranty")} summary={warrantyDays.trim() ? `≤${warrantyDays.trim()}d` : ""}>
                        <div className="flex items-center gap-1.5">
                            <span className="text-xs text-muted-foreground">within</span>
                            <NumericInput min={0} value={warrantyDays} onValueChange={setWarrantyDays} placeholder="e.g. 30" className="h-8" />
                            <span className="text-xs text-muted-foreground">days</span>
                        </div>
                        {warrantyTerms.length > 0 && (
                            <div>
                                <div className="mb-1 text-[11px] text-muted-foreground">Consider warranties (none = all):</div>
                                <div className="flex flex-wrap gap-1">
                                    {warrantyTerms.map((t) => (
                                        <button key={t.id} type="button" onClick={() => toggleTerm(t.id)}
                                            className={`rounded-full border px-2 py-0.5 text-[11px] ${warrantyTermIds.includes(t.id) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}>{t.name}</button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </FilterRow>

                    <FilterRow label="Revenue (turnover)" checked={enabled.revenue} onToggle={toggle("revenue")} summary={revenueMin.trim() || revenueMax.trim() ? `₹${revenueMin.trim() || "0"}–${revenueMax.trim() || "∞"}` : ""}>
                        <MoneyRange min={revenueMin} setMin={setRevenueMin} max={revenueMax} setMax={setRevenueMax} fromDays={revenueFromDays} setFromDays={setRevenueFromDays} toDays={revenueToDays} setToDays={setRevenueToDays} />
                    </FilterRow>

                    <FilterRow label="Profit (margin)" checked={enabled.profit} onToggle={toggle("profit")} summary={profitMin.trim() || profitMax.trim() ? `₹${profitMin.trim() || "0"}–${profitMax.trim() || "∞"}` : ""}>
                        <MoneyRange min={profitMin} setMin={setProfitMin} max={profitMax} setMax={setProfitMax} fromDays={profitFromDays} setFromDays={setProfitFromDays} toDays={profitToDays} setToDays={setProfitToDays} />
                        <p className="text-[11px] text-muted-foreground">Derived margin — a decision signal, not audited-exact.</p>
                    </FilterRow>

                    <FilterRow label="Stage" checked={enabled.stage} onToggle={toggle("stage")} summary={stageSummary}>
                        <Select value={stage || "any"} onValueChange={(v) => setStage(v === "any" ? "" : (v as ContactLifecycle))}>
                            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="any">Any stage</SelectItem>
                                {LIFECYCLES.map((s) => <SelectItem key={s} value={s}>{LIFECYCLE_META[s].label}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </FilterRow>

                    {groups.length > 0 && (
                        <FilterRow label="Group" checked={enabled.group} onToggle={toggle("group")} summary={groupSummary}>
                            <Select value={groupId || "any"} onValueChange={(v) => setGroupId(v === "any" ? "" : v)}>
                                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="any">Any group</SelectItem>
                                    {groups.map((g) => <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </FilterRow>
                    )}

                    <FilterRow label="Owner" checked={enabled.owner} onToggle={toggle("owner")} summary={ownerSummary}>
                        <Select value={ownerPositionId || "any"} onValueChange={(v) => setOwnerPositionId(v === "any" ? "" : v)}>
                            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="any">Any owner</SelectItem>
                                {myPositionIds.length > 0 && positions.filter((p) => myPositionIds.includes(p.id)).map((p) => (
                                    <SelectItem key={`mine-${p.id}`} value={p.id}>★ {p.title} (mine)</SelectItem>
                                ))}
                                {positions.map((p) => (
                                    <SelectItem key={p.id} value={p.id}>{p.title}{p.branchName ? ` · ${p.branchName}` : ""}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FilterRow>

                    <FilterRow label="Type" checked={enabled.type} onToggle={toggle("type")} summary={kind !== "all" ? kind : ""}>
                        <div className="flex gap-1">
                            {(["all", "person", "company"] as const).map((k) => (
                                <button key={k} type="button" onClick={() => setKind(k)}
                                    className={`flex-1 rounded-md px-2 py-1 text-xs font-medium capitalize ${kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{k}</button>
                            ))}
                        </div>
                    </FilterRow>
                </div>
            </aside>

            {/* ── MIDDLE: candidate list ────────────────────────────────────── */}
            <div className="flex w-80 shrink-0 flex-col overflow-hidden rounded-lg border bg-card">
                <div className="border-b p-2">
                    <div className="relative">
                        <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name…" className="h-8 pl-8" />
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                        <ArrowDownUp className="size-3 shrink-0 text-muted-foreground" />
                        <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
                            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="quietest">Quietest first</SelectItem>
                                <SelectItem value="recent">Recently active</SelectItem>
                                <SelectItem value="nameAsc">Name A–Z</SelectItem>
                                <SelectItem value="nameDesc">Name Z–A</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between px-0.5 text-[11px] text-muted-foreground">
                        <span>{loadingList ? "Loading…" : `${total} found`}{truncated ? " (capped)" : ""}</span>
                        <button type="button" onClick={loadList} className="inline-flex items-center gap-1 hover:text-foreground">
                            <RefreshCw className="size-3" /> Refresh
                        </button>
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto">
                    {!loadingList && list.length === 0 && (
                        <p className="p-4 text-center text-sm text-muted-foreground">No customers match this filter.</p>
                    )}
                    {list.map((c) => {
                        const active = selected?.kind === c.kind && selected.id === c.id;
                        const meta = LIFECYCLE_META[c.lifecycleStage];
                        return (
                            <button
                                key={`${c.kind}:${c.id}`}
                                type="button"
                                onClick={() => select(c)}
                                className={`flex w-full items-center gap-2 border-b px-3 py-2 text-left hover:bg-muted/60 ${active ? "bg-muted" : ""}`}
                            >
                                {c.kind === "company" ? <Building2 className="size-4 shrink-0 text-muted-foreground" /> : c.kind === "caller" ? (c.via === "message" ? <MessageCircle className="size-4 shrink-0 text-amber-500" /> : <Phone className="size-4 shrink-0 text-amber-500" />) : <User className="size-4 shrink-0 text-muted-foreground" />}
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium">{c.name}</div>
                                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                        {c.kind === "caller" ? (
                                            <Badge variant="secondary" className="border-amber-300 bg-amber-50 text-amber-700 px-1 py-0 text-[10px] dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-300">Unsaved</Badge>
                                        ) : (
                                            <Badge variant="secondary" className={`${meta.color} px-1 py-0 text-[10px]`}>{meta.label}</Badge>
                                        )}
                                        {c.phone && <span className="truncate">{c.phone}</span>}
                                    </div>
                                </div>
                                <div className="shrink-0 text-right text-[11px]">
                                    <div className={c.lastActivityAt ? "text-muted-foreground" : "text-red-500"}>{agoShort(c.lastActivityAt, now)}</div>
                                    <div className="text-muted-foreground">quiet</div>
                                </div>
                            </button>
                        );
                    })}
                    {nextCursor != null && (
                        <button type="button" onClick={loadMore} className="w-full py-2 text-center text-xs font-medium text-primary hover:underline">
                            Load more
                        </button>
                    )}
                </div>
            </div>

            {/* ── RIGHT: header + Timeline | Items tabs ─────────────────────── */}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card">
                {!selected ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                        <PhoneOff className="size-8" />
                        <p className="text-sm">Pick a customer to see their story and start the conversation.</p>
                    </div>
                ) : (
                    <div className="flex h-full flex-col">
                        {/* Header */}
                        <div className="border-b p-3">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        {selected.kind === "company" ? <Building2 className="size-4 text-muted-foreground" /> : selected.kind === "caller" ? (selected.via === "message" ? <MessageCircle className="size-4 text-amber-500" /> : <Phone className="size-4 text-amber-500" />) : <User className="size-4 text-muted-foreground" />}
                                        <h2 className="truncate text-lg font-semibold">{selected.name}</h2>
                                    </div>
                                    <div className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
                                        {selected.kind === "caller" ? (
                                            <span className="inline-flex items-center gap-1 text-amber-600"><Phone className="size-3.5" /> {selected.phone} · Unsaved number · {agoShort(selected.lastActivityAt, now)}</span>
                                        ) : (
                                            <>
                                                {selected.phone ? <span className="inline-flex items-center gap-1"><Phone className="size-3.5" /> {selected.phone}</span> : <span className="italic">No phone on file</span>}
                                                <span>· quiet {agoShort(selected.lastActivityAt, now)}</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1.5">
                                    {selected.kind === "caller" ? (
                                        <Button size="sm" onClick={() => setLeadPhone(selected.phone ?? "")}>
                                            <PlusCircle className="size-4" /> Add as lead
                                        </Button>
                                    ) : (
                                        <>
                                            <Select value={selected.lifecycleStage} onValueChange={(v) => changeStage(v as ContactLifecycle)}>
                                                <SelectTrigger className="h-8 w-[130px]"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    {LIFECYCLES.map((s) => <SelectItem key={s} value={s}>{LIFECYCLE_META[s].label}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                            <Button size="sm" variant="outline" onClick={() => refreshStage()} disabled={refreshingStage} title="Check for a repair/sale and auto-update the stage">
                                                <RefreshCw className={`size-4 ${refreshingStage ? "animate-spin" : ""}`} />
                                            </Button>
                                            <Button size="sm" variant="outline" onClick={() => setShowDealForm((v) => !v)}>
                                                <PlusCircle className="size-4" /> Deal
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>

                            {showDealForm && (
                                <div className="mt-2 flex items-center gap-2 rounded-md border bg-muted/40 p-2">
                                    <Input value={dealTitle} onChange={(e) => setDealTitle(e.target.value)} placeholder="Deal title (e.g. New laptop)" className="h-8" />
                                    <Button size="sm" onClick={createDeal} disabled={creatingDeal || !dealTitle.trim()}>Create</Button>
                                </div>
                            )}

                            {/* Tabs — hidden for unknown callers */}
                            {selected.kind !== "caller" && (
                            <div className="mt-3 flex gap-1">
                                {(["timeline", "items"] as const).map((t) => (
                                    <button
                                        key={t}
                                        type="button"
                                        onClick={() => setRightTab(t)}
                                        className={`rounded-md px-3 py-1 text-sm font-medium capitalize ${rightTab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                                    >
                                        {t === "items" ? "Items / buying" : "Timeline"}
                                    </button>
                                ))}
                            </div>
                            )}
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto p-3">
                            {selected.kind === "caller" ? (
                                /* Unknown caller — call log + create lead */
                                <div className="flex flex-col gap-3">
                                    <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-500/30 dark:bg-amber-950/20">
                                        <div className="flex items-center gap-2">
                                            <Phone className="size-4 text-amber-600 dark:text-amber-300" />
                                            <div>
                                                <p className="text-sm font-medium">{selected.phone}</p>
                                                <p className="text-[11px] text-muted-foreground">{selected.via === "message" ? "Messaged" : selected.via === "both" ? "Called / messaged" : "Called"} {agoShort(selected.lastActivityAt, now)}</p>
                                            </div>
                                        </div>
                                        <Button size="sm" onClick={() => setLeadPhone(selected.phone ?? "")}>
                                            <PlusCircle className="size-4 mr-1" /> Add as lead
                                        </Button>
                                    </div>

                                    {/* Call log entries */}
                                    {loadingCallerCalls && <p className="text-sm text-muted-foreground">Loading calls…</p>}
                                    {callerCalls && callerCalls.length === 0 && !loadingCallerCalls && !callerMessages?.length && (
                                        <p className="text-sm text-muted-foreground">No calls on record.</p>
                                    )}
                                    {callerCalls?.map((c) => (
                                        <div key={c.id} className="flex items-start gap-2.5 rounded-lg border p-2.5">
                                            <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted ${c.missed ? (c.direction === "INCOMING" ? "text-red-600" : "text-amber-600") : "text-sky-600"}`}>
                                                {c.direction === "INCOMING" ? <PhoneIncoming className="size-3.5" /> : <PhoneOutgoing className="size-3.5" />}
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-baseline justify-between gap-2">
                                                    <span className="text-sm font-medium">
                                                        {c.direction === "INCOMING" ? "Incoming" : "Outgoing"}
                                                        {c.missed && <span className="ml-1 text-red-600">· missed</span>}
                                                    </span>
                                                    <span className="shrink-0 text-[11px] text-muted-foreground">{formatDateTime(c.occurredAt)}</span>
                                                </div>
                                                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                                                    <span>{c.speechSec || c.durationSec ? `${Math.round((c.speechSec || c.durationSec) / 60)}m ${c.speechSec || c.durationSec}s` : "—"}</span>
                                                    {c.rawNumber && <span className="truncate">{c.rawNumber}</span>}
                                                </div>
                                                {editingCallNoteId === c.id ? (
                                                    <div className="mt-1 space-y-1.5">
                                                        <Textarea
                                                            value={callNoteDraft}
                                                            onChange={(e) => setCallNoteDraft(e.target.value)}
                                                            placeholder="Add a note…"
                                                            rows={2}
                                                            className="text-sm"
                                                        />
                                                        <div className="flex justify-end gap-1.5">
                                                            <Button size="sm" variant="ghost" onClick={() => setEditingCallNoteId(null)} disabled={savingCallNote}>Cancel</Button>
                                                            <Button size="sm" onClick={async () => {
                                                                setSavingCallNote(true);
                                                                try {
                                                                    await axios.patch(`/api/calls/${c.id}`, { note: callNoteDraft.trim() || null });
                                                                    setCallerCalls((prev) => prev?.map((x) => x.id === c.id ? { ...x, note: callNoteDraft.trim() || null } : x) ?? null);
                                                                    setEditingCallNoteId(null);
                                                                    toast.success("Note saved");
                                                                } catch {
                                                                    toast.error("Failed to save note");
                                                                } finally {
                                                                    setSavingCallNote(false);
                                                                }
                                                            }} disabled={savingCallNote}>{savingCallNote ? "Saving…" : "Save"}</Button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="mt-1 flex items-start gap-1.5">
                                                        {c.note && <p className="flex-1 whitespace-pre-wrap text-sm text-muted-foreground">{c.note}</p>}
                                                        <Button
                                                            variant="ghost" size="icon" className="h-6 w-6 shrink-0"
                                                            title="Add / edit note"
                                                            onClick={() => { setEditingCallNoteId(c.id); setCallNoteDraft(c.note ?? ""); }}
                                                        >
                                                            <StickyNote className="size-3.5" />
                                                        </Button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}

                                    {/* WhatsApp messages from / to this number */}
                                    {callerMessages && callerMessages.length > 0 && (
                                        <>
                                            <div className="flex items-center gap-1.5 pt-1 text-xs font-semibold uppercase text-muted-foreground">
                                                <MessageCircle className="size-3.5" /> Messages
                                            </div>
                                            {callerMessages.map((m) => (
                                                <div key={m.id} className="flex items-start gap-2.5 rounded-lg border p-2.5">
                                                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-green-600">
                                                        <MessageCircle className="size-3.5" />
                                                    </span>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-baseline justify-between gap-2">
                                                            <span className="text-sm font-medium">{m.direction === "IN" ? "Received" : `Sent${m.sentBy ? ` · ${m.sentBy}` : ""}`}</span>
                                                            <span className="shrink-0 text-[11px] text-muted-foreground">{formatDateTime(m.at)}</span>
                                                        </div>
                                                        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-muted-foreground">{m.body || `[${m.kind}]`}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </>
                                    )}
                                </div>
                            ) : rightTab === "timeline" ? (
                                <>
                                    {loadingTimeline && <p className="text-sm text-muted-foreground">Loading timeline…</p>}

                                    {/* Talking points */}
                                    {timeline && timeline.talkingPoints.length > 0 && (
                                        <div className="mb-4 space-y-1.5 rounded-lg border border-primary/30 bg-primary/5 p-3">
                                            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase text-primary">
                                                <Sparkles className="size-3.5" /> How to open the conversation
                                            </div>
                                            {timeline.talkingPoints.map((tp) => (
                                                <p key={tp.fromKey} className="text-sm">“{tp.line}”</p>
                                            ))}
                                        </div>
                                    )}

                                    {/* Composer */}
                                    <div className="mb-4 space-y-2 rounded-lg border p-2">
                                        <div className="flex gap-1">
                                            {COMPOSER_KINDS.map(({ kind: k, label, icon: Icon }) => (
                                                <button
                                                    key={k}
                                                    type="button"
                                                    onClick={() => setComposerKind(k)}
                                                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${composerKind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                                                >
                                                    <Icon className="size-3.5" /> {label}
                                                </button>
                                            ))}
                                        </div>
                                        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder={`Log a ${composerKind.toLowerCase()} on this customer…`} />
                                        <div className="flex justify-end gap-1.5">
                                            {composerKind === "CALL" ? (
                                                <>
                                                    <Button size="sm" variant="outline" onClick={() => addLog("out")} disabled={posting || !body.trim()}>
                                                        <PhoneOutgoing className="size-4" /> We called them
                                                    </Button>
                                                    <Button size="sm" onClick={() => addLog("in")} disabled={posting || !body.trim()}>
                                                        <PhoneIncoming className="size-4" /> They called us
                                                    </Button>
                                                </>
                                            ) : (
                                                <Button size="sm" onClick={() => addLog()} disabled={posting || !body.trim()}>
                                                    <Send className="size-4" /> Log {composerKind.toLowerCase()}
                                                </Button>
                                            )}
                                        </div>
                                    </div>

                                    {/* Timeline feed */}
                                    <div className="space-y-3">
                                        {timeline && timeline.entries.length === 0 && !loadingTimeline && (
                                            <p className="text-sm text-muted-foreground">No history yet — this is a cold contact. A friendly first call is a great start.</p>
                                        )}
                                        {timeline?.entries.map((e) => {
                                            const meta = SOURCE_META[e.source];
                                            // Miscall stands out: incoming-missed red (a customer we
                                            // missed), outgoing-unanswered amber (our unanswered call).
                                            const missedTone = e.direction === "out" ? "text-amber-600" : "text-red-600";
                                            const Icon = e.source === "call" && e.missed
                                                ? PhoneMissed
                                                : e.source === "call" && e.direction ? (e.direction === "in" ? PhoneIncoming : PhoneOutgoing) : meta.icon;
                                            const tint = e.source === "call" && e.missed ? missedTone : meta.tint;
                                            return (
                                                <div key={e.key} className="flex gap-2.5">
                                                    <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted ${tint}`}>
                                                        <Icon className="size-3.5" />
                                                    </span>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-baseline justify-between gap-2">
                                                            <span className={`text-sm font-medium ${e.source === "call" && e.missed ? missedTone : ""}`}>{e.title}</span>
                                                            <span className="shrink-0 text-[11px] text-muted-foreground">{formatDateTime(e.at)}</span>
                                                        </div>
                                                        {e.detail && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{e.detail}</p>}
                                                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                                            {e.amountPaise != null && <span className="font-semibold tabular-nums text-foreground">{formatRupeesFromPaise(e.amountPaise)}</span>}
                                                            {e.author && <span>· {e.author}</span>}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </>
                            ) : (
                                /* Items / buying-behaviour tab */
                                <div className="space-y-2">
                                    {loadingItems && <p className="text-sm text-muted-foreground">Loading items…</p>}
                                    {items && items.length === 0 && !loadingItems && (
                                        <p className="text-sm text-muted-foreground">No purchases on record yet.</p>
                                    )}
                                    {items?.map((it) => {
                                        const warrantyDaysLeft = it.warrantyEndsAt ? Math.round((new Date(it.warrantyEndsAt).getTime() - now) / 86_400_000) : null;
                                        return (
                                            <div key={it.productId} className="flex items-start gap-2.5 rounded-lg border p-2.5">
                                                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                                                    <Package className="size-3.5" />
                                                </span>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-baseline justify-between gap-2">
                                                        <span className="truncate text-sm font-medium">{it.name}</span>
                                                        <span className="shrink-0 text-sm font-semibold tabular-nums">{formatRupeesFromPaise(it.amountPaise)}</span>
                                                    </div>
                                                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                                                        {it.category && <Badge variant="secondary" className="px-1 py-0 text-[10px]">{it.category}</Badge>}
                                                        <span>bought {it.times}× · {it.qty} units</span>
                                                        <span>· last {agoShort(it.lastBoughtAt, now)} ago</span>
                                                        {warrantyDaysLeft != null && (
                                                            warrantyDaysLeft >= 0 ? (
                                                                <span className={`inline-flex items-center gap-0.5 ${warrantyDaysLeft <= 30 ? "text-amber-600" : "text-emerald-600"}`}>
                                                                    <ShieldCheck className="size-3" /> warranty ends {formatDate(it.warrantyEndsAt!)} ({warrantyDaysLeft}d)
                                                                </span>
                                                            ) : (
                                                                <span className="inline-flex items-center gap-0.5 text-muted-foreground">
                                                                    <ShieldAlert className="size-3" /> warranty expired {formatDate(it.warrantyEndsAt!)}
                                                                </span>
                                                            )
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {items && items.length > 0 && (
                                        <p className="flex items-center gap-1 pt-1 text-[11px] text-muted-foreground">
                                            <Clock className="size-3" /> Most-bought first — spot consumables to re-pitch.
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Create-lead dialog for unknown callers */}
            <CreatePersonDialog
                open={leadPhone !== null}
                onOpenChange={(o) => { if (!o) { setLeadPhone(null); void loadList(); } }}
                initialPhone={leadPhone ?? undefined}
            />
        </div>
    );
}
