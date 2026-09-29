"use client";

// /office/pos/counters — POS counter status board (manager / admin view)
//
// One card per active counter: who's on it, day opening, and live cash-in-drawer
// when occupied; the last close + carry-over float when free. Polls every 30s.
// Data: GET /api/pos/counters/status (see route for the running-cash math).

import { useCallback, useRef, useState } from "react";
import { GatedLink } from "@/shared/components/GatedLink";
import { useSession } from "next-auth/react";
import axios from "axios";
import { toast } from "sonner";
import {
    Loader2, RefreshCw, Clock, Users, Lock, Moon,
    AlertTriangle, ArrowDownUp, ArrowRight, LockOpen,
} from "lucide-react";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ShiftCloseDialog } from "@/modules/pos/components/ShiftCloseDialog";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { fmt } from "@/shared/lib/format/moneyInr";
import { usePolling } from "@/shared/hooks/usePolling";
import { POS_LIVE_POLL_MS } from "@/shared/lib/constants/polling";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { initials } from "@/shared/lib/format/initials";

type Person = { id: number; name: string };

type CounterCard = {
    counterId:        number;
    counterName:      string;
    branch:           { id: string; name: string };
    tillAccountId:    number;
    tillBalancePaise: string;
    status:           "OPEN" | "AWAITING_HANDOVER" | "FREE";
    open: {
        shiftId:              number;
        user:                 Person;
        openedAt:             string;
        openingFloatPaise:    string;
        tillMovementPaise:    string;
        runningExpectedPaise: string;
        handoverToUser:       Person | null;
        declaredByAPaise:     string | null;
    } | null;
    lastClose: {
        shiftId:           number;
        user:              Person;
        closedBy:          Person | null;
        closedAt:          string | null;
        declaredCashPaise: string | null;
        variancePaise:     string | null;
        toVaultPaise:      string | null;
    } | null;
};

const rupees = (paise: string | null) => (paise == null ? 0 : Number(paise) / 100);
const clock  = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const since  = (iso: string) => {
    const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
    const h = Math.floor(mins / 60), m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
export default function CountersStatusPage() {
    const { data: session } = useSession();
    const perms = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    // Force-close another operator's shift (e.g. they fell ill / their PC died) is
    // an oversight action gated by the dedicated `pos:shift:force-close` tick (the
    // "Can force-close shift" toggle on the Counters sidebar link) or env super-admin.
    // A plain operator holds only `pos:shift:close` (their OWN shift), never this.
    // The close API enforces the same pair.
    const canManage =
        perms.includes(PERMISSIONS.ADMIN_BYPASS) ||
        perms.includes(PERMISSIONS.POS_SHIFT_FORCE_CLOSE);

    const [cards, setCards]   = useState<CounterCard[]>([]);
    const [loading, setLoading] = useState(true);
    const [branchScope, setBranchScope] = useState<"active" | "all">("active");
    // Live-state filter (client-side): open = a shift is running (incl. handover),
    // closed = no open shift (free). Not the counter's isActive config.
    const [stateFilter, setStateFilter] = useState<"open" | "closed" | "all">("all");
    // The shift the admin is force-closing (drives the reused ShiftCloseDialog).
    const [closing, setClosing] = useState<{ shiftId: number; cashierName: string } | null>(null);

    const load = useCallback((opts?: { silent?: boolean }) => {
        if (!opts?.silent) setLoading(true);
        const q = new URLSearchParams();
        if (branchScope === "all") q.set("branchId", "all");
        axios.get<CounterCard[]>(`/api/pos/counters/status?${q}`)
            .then((r) => setCards(r.data))
            .catch((e) => {
                const msg = axios.isAxiosError(e) ? (e.response?.data as { error?: string })?.error : undefined;
                toast.error(msg ?? "Failed to load counters");
            })
            .finally(() => setLoading(false));
    }, [branchScope]);

    // One driver for both the first paint and the 30 s refresh: the very first load
    // shows the spinner, every later one is quiet. Polling pauses while the tab is
    // hidden and catches up on return.
    const loadedOnce = useRef(false);
    usePolling(() => {
        load(loadedOnce.current ? { silent: true } : undefined);
        loadedOnce.current = true;
    }, POS_LIVE_POLL_MS, true, branchScope);

    // This is the "revisit when real counters run side by side and one terminal
    // must notice another's shift without being told" that POS_LIVE_POLL_MS parked.
    // A shift opened, handed over or closed announces `ledger`; the counter records
    // themselves are `settings`. The 90-minute poll stays as the distant fallback,
    // not the mechanism. Always silent — nobody asked for this read.
    useRealtimeTopics(["ledger", "settings"], () => { load({ silent: true }); });

    const counts = {
        open:     cards.filter((c) => c.status === "OPEN").length,
        handover: cards.filter((c) => c.status === "AWAITING_HANDOVER").length,
        free:     cards.filter((c) => c.status === "FREE").length,
    };
    const cashInDrawers = cards.reduce(
        (s, c) => s + (c.open ? rupees(c.open.runningExpectedPaise) : rupees(c.tillBalancePaise)),
        0,
    );
    const shown = cards.filter((c) =>
        stateFilter === "all"  ? true :
        stateFilter === "open" ? (c.status === "OPEN" || c.status === "AWAITING_HANDOVER") :
                                 c.status === "FREE",
    );

    return (
        <ScrollArea className="h-full" type="always">
        <div className="space-y-6 px-6 pt-3 pb-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold">POS counters</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">Live status per counter — who&apos;s on, day opening, and cash in drawer.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Select value={stateFilter} onValueChange={(v) => setStateFilter(v as "open" | "closed" | "all")}>
                        <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="State" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All counters</SelectItem>
                            <SelectItem value="open">Open</SelectItem>
                            <SelectItem value="closed">Closed</SelectItem>
                        </SelectContent>
                    </Select>
                    <Select value={branchScope} onValueChange={(v) => setBranchScope(v as "active" | "all")}>
                        <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Branch" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="active">Active branch</SelectItem>
                            <SelectItem value="all">All branches</SelectItem>
                        </SelectContent>
                    </Select>
                    <button
                        onClick={() => load()}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs hover:bg-muted"
                    >
                        <RefreshCw size={13} /> Refresh
                    </button>
                </div>
            </div>

            {/* Summary strip */}
            <div className="flex flex-wrap gap-2.5">
                <Metric label="Open" value={String(counts.open)} className="text-emerald-600 dark:text-emerald-400" />
                <Metric label="Handover" value={String(counts.handover)} className="text-amber-600 dark:text-amber-400" />
                <Metric label="Free" value={String(counts.free)} className="text-muted-foreground" />
                <Metric label="Cash in drawers" value={`₹${fmt(cashInDrawers)}`} mono />
            </div>

            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" size={28} /></div>
            ) : shown.length === 0 ? (
                <div className="rounded-lg border border-border bg-card text-center py-16 text-muted-foreground">
                    {cards.length === 0
                        ? "No counters in this branch."
                        : `No ${stateFilter === "open" ? "open" : "closed"} counters right now.`}
                </div>
            ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {shown.map((c) => (
                        <CounterCardView
                            key={c.counterId}
                            card={c}
                            canManage={canManage}
                            onForceClose={(shiftId, cashierName) => setClosing({ shiftId, cashierName })}
                        />
                    ))}
                </div>
            )}

            {/* Admin force-close — reuses the cashier's ShiftCloseDialog against the
                target shift. The close API authorizes managers, so closedBy = the
                admin while the variance stays on the operator's shift. */}
            {closing && (
                <ShiftCloseDialog
                    open={true}
                    onOpenChange={(v) => { if (!v) setClosing(null); }}
                    shiftId={closing.shiftId}
                    forCashierName={closing.cashierName}
                    onClosed={() => load({ silent: true })}
                />
            )}
        </div>
        </ScrollArea>
    );
}

function Metric({ label, value, className, mono }: { label: string; value: string; className?: string; mono?: boolean }) {
    return (
        <div className="rounded-md bg-muted/50 px-3 py-2 min-w-[104px]">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className={`text-xl font-semibold ${mono ? "font-mono" : ""} ${className ?? ""}`}>{value}</div>
        </div>
    );
}

function CounterCardView({ card, canManage, onForceClose }: {
    card: CounterCard;
    canManage: boolean;
    onForceClose: (shiftId: number, cashierName: string) => void;
}) {
    const linkedShiftId = card.open?.shiftId ?? card.lastClose?.shiftId ?? null;
    // Force-close applies to a running (OPEN) shift only — the close API rejects
    // AWAITING_HANDOVER (that must be cancelled first).
    const showForceClose = canManage && card.status === "OPEN" && card.open != null;
    return (
        <div className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-border/80">
            <div className="flex items-center justify-between gap-2">
                <div className="truncate">
                    {linkedShiftId != null ? (
                        <GatedLink whenLocked="text" textClassName="font-medium" href={`/office/pos/shifts/${linkedShiftId}`} className="font-medium hover:underline">{card.counterName}</GatedLink>
                    ) : (
                        <span className="font-medium">{card.counterName}</span>
                    )}
                    <span className="ml-1.5 text-xs text-muted-foreground/70">· {card.branch.name}</span>
                </div>
                <StatusBadge status={card.status} />
            </div>

            {card.status === "FREE" ? (
                <FreeBody card={card} />
            ) : (
                <OpenBody card={card} />
            )}

            {showForceClose && (
                <div className="mt-3 border-t border-border pt-2.5">
                    <button
                        onClick={() => onForceClose(card.open!.shiftId, card.open!.user.name)}
                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"
                        title={`Count the drawer and close ${card.open!.user.name}'s shift`}
                    >
                        <LockOpen size={13} /> Force close &amp; count drawer
                    </button>
                </div>
            )}
        </div>
    );
}

function OpenBody({ card }: { card: CounterCard }) {
    const o = card.open!;
    const awaiting = card.status === "AWAITING_HANDOVER";
    return (
        <>
            <div className="my-3 flex items-center gap-2">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium ${awaiting ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-primary/10 text-primary"}`}>
                    {initials(o.user.name)}
                </div>
                <div className="leading-tight">
                    <div className="text-sm">
                        {o.user.name}
                        {awaiting && o.handoverToUser && (
                            <span className="text-muted-foreground"> <ArrowRight size={11} className="inline -mt-0.5" /> {o.handoverToUser.name}</span>
                        )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                        {awaiting ? "awaiting count · " : ""}since {clock(o.openedAt)} · {since(o.openedAt)}
                    </div>
                </div>
            </div>
            <dl className="space-y-1.5 border-t border-border pt-2.5 text-sm">
                <Line label="Day opening" value={`₹${fmt(rupees(o.openingFloatPaise))}`} />
                {awaiting ? (
                    <Line label="Declared" value={o.declaredByAPaise != null ? `₹${fmt(rupees(o.declaredByAPaise))}` : "—"} />
                ) : (
                    <Line label="Till movement" value={`${rupees(o.tillMovementPaise) < 0 ? "−" : "+"}₹${fmt(Math.abs(rupees(o.tillMovementPaise)))}`} />
                )}
                <Line label={awaiting ? "Expected ≈" : "In drawer ≈"} value={`₹${fmt(rupees(o.runningExpectedPaise))}`} strong />
            </dl>
        </>
    );
}

function FreeBody({ card }: { card: CounterCard }) {
    const lc = card.lastClose;
    return (
        <>
            <div className="my-3 flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Moon size={14} />
                </div>
                <div className="leading-tight">
                    <div className="text-sm text-muted-foreground">No open shift</div>
                    <div className="text-xs text-muted-foreground">
                        {lc?.closedBy && lc.closedAt
                            ? <>closed by {lc.closedBy.name} · {clock(lc.closedAt)}</>
                            : "counter idle"}
                    </div>
                </div>
            </div>
            <dl className="space-y-1.5 border-t border-border pt-2.5 text-sm">
                {lc && (
                    <>
                        <Line label="Last close declared" value={lc.declaredCashPaise != null ? `₹${fmt(rupees(lc.declaredCashPaise))}` : "—"} />
                        <Line label="Variance" value={<VarianceCell paise={lc.variancePaise} />} />
                        <Line label="Swept to vault" value={lc.toVaultPaise != null ? `₹${fmt(rupees(lc.toVaultPaise))}` : "—"} />
                    </>
                )}
                <Line label="In drawer now" value={`₹${fmt(rupees(card.tillBalancePaise))}`} strong />
            </dl>
        </>
    );
}

function Line({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
    return (
        <div className="flex items-baseline justify-between">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className={`font-mono ${strong ? "text-base font-medium" : ""}`}>{value}</dd>
        </div>
    );
}

function StatusBadge({ status }: { status: CounterCard["status"] }) {
    if (status === "OPEN") return (
        <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
            <Clock size={11} /> Open
        </span>
    );
    if (status === "AWAITING_HANDOVER") return (
        <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
            <Users size={11} /> Handover
        </span>
    );
    return (
        <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
            <Lock size={11} /> Free
        </span>
    );
}

function VarianceCell({ paise }: { paise: string | null }) {
    if (paise == null) return <span className="text-muted-foreground/65">—</span>;
    const amount = Number(paise) / 100;
    if (amount === 0) return <span className="text-emerald-700 dark:text-emerald-400">₹0</span>;
    const abs = Math.abs(amount);
    const colorClass = abs > 50 ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400";
    return (
        <span className={`inline-flex items-center gap-1 ${colorClass}`}>
            {abs > 50 && <AlertTriangle size={11} />}
            <ArrowDownUp size={11} />
            {amount > 0 ? "+" : "−"}₹{fmt(abs)}
        </span>
    );
}
