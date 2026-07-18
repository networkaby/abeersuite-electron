"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { formatDate, formatDateTime } from "@/shared/lib/format/formatDate";
import {
    Clock, User, Building2, AlertTriangle,
    Printer, Lock, Eye, NotebookPen, ArrowRightLeft,
    Check, X, MessageSquare, RefreshCw, ArrowRight, CornerUpLeft, Flag,
    GitBranch, ExternalLink, Bug, Truck, ChevronDown,
    type LucideIcon,
} from "lucide-react";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { timeAgo } from "@/shared/lib/format/timeAgo";
import { badgeColor } from "@/shared/lib/format/entityColor";
import Link from "next/link";
import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";
import { PRIORITY_META } from "@/utils/constants";
import TicketEscalation from "@/modules/repairing/components/TicketEscalation";
import StatusNav from "@/modules/repairing/components/StatusNav";
import AddNoteModal from "@/modules/repairing/components/AddNoteModal";
import WarrantyBadge from "@/modules/repairing/components/WarrantyBadge";
import WarrantyConvertModal from "@/modules/repairing/components/WarrantyConvertModal";
import TicketOwnershipPanel from "@/modules/repairing/components/TicketOwnershipPanel";
import PipelineTransferModal from "@/modules/repairing/components/PipelineTransferModal";
import TicketInvoicesPanel from "@/modules/repairing/components/TicketInvoicesPanel";
import ShippingSlipModal from "@/modules/repairing/components/ShippingSlipModal";
import BillDetailsPanel, { type BillDraft } from "@/modules/repairing/components/BillDetailsPanel";
import WorkActions from "@/modules/repairing/components/WorkActions";
import DevOverridePanel from "@/modules/repairing/components/DevOverridePanel";
import { resolveTicketSource, type WorkArg } from "@/modules/repairing/lib/ticketSources";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Ticket {
    id: number;
    status: string;
    workerId?: string;
    pipelineId?: string | null;
    pipeline?: { id: string; label: string; color: string } | null;
    ticketWorker?: { id: string; label: string; color: string; actionLabel?: string | null; work?: { label: string; color: string; successLabel?: string | null; failLabel?: string | null; startLabel?: string | null; prompt?: string | null; successPopup?: boolean; failPopup?: boolean; args?: WorkArg[] | null } | null; successWorker?: { id: string; label: string } | null; failWorker?: { id: string; label: string } | null; successStatus?: { id: string; label: string } | null; failStatus?: { id: string; label: string } | null } | null;
    priority: string;
    notes?: string;
    accessInfo?: string;
    estimatedCost?: number;
    escalated: boolean;
    escalatedAt?: string;
    expectedReturn?: string;
    receivedBackAt?: string;
    externalRef?: string;
    isWarranty: boolean;
    warrantyStatus: string;
    voidReason?: string | null;
    warrantyRef?: string | null;
    purchaseDate?: string | null;
    createdAt: string;
    updatedAt: string;
    ticketStatus: {
        label: string;
        color: string;
        isTerminal: boolean;
        leavePrompt?: string | null;
        fromTransitions: { to: { id: string; label: string; color?: string; isTerminal?: boolean } }[];
    };
    device: {
        type: string;
        brand: string;
        model: string;
        problem: string;
        account: { id: number; name: string; phone?: string | null; email?: string | null } | null;
    };
    // Soft, unstructured data bag — collected outcome values, spawnedFrom breadcrumb,
    // etc. Shown raw in the dev-only debug panel (no end-user UI yet).
    context?: Record<string, unknown> | null;
    parent?: { id: number } | null;
    // Spawned sub-pipeline children, gathered across ALL entity tables (MirrorChild).
    children?: {
        type: "ticket" | "task" | "deal";
        id: string;
        pipelineId: string | null;
        pipelineLabel: string | null;
        pipelineColor: string | null;
        statusLabel: string | null;
        statusColor: string | null;
        subLabel: string | null;
        subColor: string | null;
        isTerminal: boolean;
        title: string | null;
    }[];
    primaryOwner?: { id: number; name: string };
    participants?: { user: { id: number; name: string; role: string }; addedForRole?: string | null }[];
    serviceCenter?: { id: number; name: string };
    logs: {
        id: number;
        status: string;
        workerId?: string;
        note?: string;
        visibility: string;
        createdAt: string;
        // Actor is a frozen JSON snapshot now (no User FK) — see ActorSnapshot.
        author?: { userName?: string } | null;
        ticketStatus: { label: string; color: string };
        ticketWorker?: { label: string; color: string } | null;
    }[];
}

type LogKind = "success" | "fail" | "note" | "entered" | "advanced" | "retry" | "revert" | "system";

// System-generated notes that aren't outcomes/entries — shown muted in the timeline.
const SYSTEM_NOTE_RE = /^(Ticket created|Claimed by|Passed to|Returned to unassigned|Secondary owner|Reopened from|Transferred|Escalat|✓ )/;

function classifyLog(note?: string): LogKind {
    if (!note) return "system";                              // bare status / worker change
    if (note.startsWith("Work done · Success")) return "success";
    if (note.startsWith("Work done · Unsuccess")) return "fail";
    if (note.startsWith("Entered:")) return "entered";
    if (note.startsWith("Auto-advanced")) return "advanced";
    if (note.startsWith("Retry limit")) return "retry";
    if (note.startsWith("Reverted")) return "revert";
    if (SYSTEM_NOTE_RE.test(note)) return "system";
    return "note";                                           // human free-text
}

const KIND_META: Record<LogKind, { icon: LucideIcon; dot: string; lead?: string }> = {
    success: { icon: Check, dot: "bg-green-100 text-green-600 dark:bg-green-950 dark:text-green-400", lead: "Success" },
    fail: { icon: X, dot: "bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400", lead: "Unsuccess" },
    note: { icon: MessageSquare, dot: "bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400" },
    entered: { icon: ArrowRight, dot: "bg-muted text-muted-foreground" },
    advanced: { icon: ArrowRightLeft, dot: "bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400", lead: "Auto-advanced" },
    retry: { icon: RefreshCw, dot: "bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400", lead: "Retry limit reached" },
    revert: { icon: CornerUpLeft, dot: "bg-muted text-muted-foreground", lead: "Reverted" },
    system: { icon: Flag, dot: "bg-muted text-muted-foreground" },
};

// Strip the machine prefix so the row reads cleanly beside its icon.
function timelineText(note: string | undefined, kind: LogKind): string | null {
    if (!note) return null;
    if (kind === "success" || kind === "fail") return note.split(" — ").slice(1).join(" — ").trim() || null;
    if (kind === "entered" || kind === "advanced") return null;   // the worker badge already conveys it
    if (kind === "retry") return null;                            // the lead label conveys it
    return note;                                                  // note / system / revert
}

export default function TicketDetailPage() {
    const { id } = useParams();
    const [ticket, setTicket] = useState<Ticket | null>(null);
    const [loading, setLoading] = useState(true);
    const [showEscalation, setShowEscalation] = useState(false);
    const [showAddNote, setShowAddNote] = useState(false);
    const [showWarrantyModal, setShowWarrantyModal] = useState(false);
    const [showTransferModal, setShowTransferModal] = useState(false);
    const [showShippingSlip, setShowShippingSlip] = useState(false);
    const [showDev, setShowDev] = useState(false);
    const [showRefEdit, setShowRefEdit] = useState(false);
    const [refValue, setRefValue] = useState("");
    const [savingRef, setSavingRef] = useState(false);
    const { data: session } = useSession();
    const sessionUser = session?.user as { id?: string; permissions?: string[] } | undefined;
    const currentUserId = Number(sessionUser?.id ?? "0");
    // Dev-only debug surfaces (the raw ticket-context panel). Gated on an admin
    // permission — visible to admins / the super-admin bypass, hidden from staff.
    const perms = sessionUser?.permissions ?? [];
    const canDebug = perms.includes(PERMISSIONS.ADMIN_BYPASS) || perms.includes(PERMISSIONS.SETTINGS_MANAGE);
    // TODO(rbac): repairing actions temporarily open to all staff — re-gate on
    // position-based permissions when RBAC is re-wired.
    const canConvertWarranty = true;
    const canManageOwnership = true;
    const canTransfer = true;

    const saveRef = async () => {
        if (!ticket) return;
        setSavingRef(true);
        try {
            await axios.put(`/api/tickets/${ticket.id}`, { externalRef: refValue });
            toast.success("Reference saved");
            setShowRefEdit(false);
            fetchTicket();
        } catch {
            toast.error("Failed to save reference");
        } finally {
            setSavingRef(false);
        }
    };

    const fetchTicket = useCallback(async () => {
        try {
            const res = await axios.get(`/api/tickets/${id}`);
            setTicket(res.data);
        } catch {
            toast.error("Failed to load ticket");
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => { fetchTicket(); }, [fetchTicket]);

    if (loading) return <p className="text-muted-foreground">Loading...</p>;
    if (!ticket) return <p className="text-muted-foreground">Ticket not found.</p>;

    // The "Current work" card lets the technician advance the ticket's Work (Accept /
    // Reject → next worker/status) right on the ticket page, mirroring the Work Inbox
    // card. Kept as a named flag so it's easy to hide again if the duplication bites.
    const SHOW_CURRENT_WORK: boolean = true;

    const actionBtnBase = "w-full border border-border py-2 text-sm flex items-center justify-center gap-2 transition-colors hover:bg-muted rounded-md";

    // Work is "in progress" when the ticket has an owner AND an active work worker.
    // When true: StatusNav is locked, all Actions except Add Note are locked.
    const workInProgress = !!ticket.primaryOwner && !!ticket.ticketWorker?.work;

    // Single "Back" = true undo — the previous *resting* (status, worker) pair
    // from history. Single pass over logs (newest first), returning the first that:
    //   • has a valid ticketStatus (skip stale logs whose status ID is gone), and
    //   • isn't the current state, and
    //   • isn't the transient "bare arrival" of the current status — when a ticket
    //     auto-advances into a status it briefly sits at `status/no-sub` for a
    //     fraction of a second before the entry worker is applied. That
    //     intermediate is never a real rest point; returning it gives a useless
    //     "back to self" (e.g. "Back to Diagnosing" while already in Diagnosing).
    const curStatus = ticket.status;
    const curSub = ticket.workerId ?? null;
    const backTarget = (() => {
        for (const log of ticket.logs) {
            if (!log.ticketStatus) continue;
            const logSub = log.workerId ?? null;
            if (log.status === curStatus && logSub === curSub) continue;        // current state
            if (log.status === curStatus && logSub === null) continue;          // bare-arrival artifact
            const subLabel = log.ticketWorker?.label;
            return {
                statusId: log.status,
                workerId: logSub,
                label: subLabel
                    ? `${log.ticketStatus.label} › ${subLabel}`
                    : log.ticketStatus.label,
            };
        }
        return null;
    })();

    // A shipping slip snapshot already saved on this ticket (context bag) → offer reprint.
    const hasShippingSlip = !!(
        ticket.context &&
        typeof ticket.context === "object" &&
        (ticket.context as Record<string, unknown>).shippingSlip
    );

    // "Create Shipping Slip" shows at the send-to-service stage. Gated on the
    // STATUS label (status-only model) — not the old `escalated` boolean, which
    // only the legacy Escalate modal sets. Any status named "… Send to Service"
    // qualifies, so renamed / extra stages keep working.
    const isSendToService = /send to service/i.test(ticket.ticketStatus.label ?? "");

    // Ongoing draft bill saved on the ticket (context bag).
    const savedBill =
        (ticket.context &&
            typeof ticket.context === "object" &&
            ((ticket.context as Record<string, unknown>).billDraft as Partial<BillDraft> | undefined)) ||
        undefined;
    const billDraft: BillDraft = {
        products: savedBill?.products ?? [],
        charges: savedBill?.charges ?? [],
    };

    return (
        <div className="flex h-full flex-col">
            <PathBreadcrumb
                root={{ href: "/office/repairing/tickets", label: "Tickets" }}
                escapeBack
                labels={{ tickets: "Tickets" }}
            />
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">

                {/* Warranty banner */}
                {ticket.isWarranty && (
                    <div className={`mb-4 flex items-center gap-3 rounded-lg border border-border px-5 py-3 text-sm ${ticket.warrantyStatus === "VOID" ? "bg-destructive/10 text-destructive" :
                        ticket.warrantyStatus === "ACTIVE" ? "bg-secondary/40 text-foreground" :
                            "bg-primary/10 text-primary"
                        }`}>
                        <WarrantyBadge isWarranty={ticket.isWarranty} warrantyStatus={ticket.warrantyStatus} />
                        <span className="flex-1">
                            {ticket.warrantyStatus === "VOID" && ticket.voidReason && `Void reason: ${ticket.voidReason.replace(/_/g, " ")}`}
                            {ticket.warrantyStatus === "ACTIVE" && "Warranty confirmed — no charge to customer."}
                            {ticket.warrantyStatus === "CLAIMED" && "Warranty claim in progress."}
                        </span>
                        {ticket.warrantyRef && <span className="text-xs opacity-70">Ref: {ticket.warrantyRef}</span>}
                    </div>
                )}

                <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
                    {/* Left Column — main */}
                    <div className="min-w-0 space-y-5">

                        {/* Ticket header + Customer & Device */}
                        <div className="rounded-lg border border-border bg-card p-6 shadow">
                            {/* Header: ticket # + badges — full width */}
                            <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
                                <div>
                                    <h1 className="text-2xl font-bold">Ticket #{ticket.id}</h1>
                                    <p className="text-muted-foreground text-sm">Created {formatDateTime(ticket.createdAt)}</p>
                                </div>
                                <div className="flex flex-wrap justify-end gap-2">
                                    {ticket.pipeline && (
                                        <span className={`rounded-md border border-border px-3 py-1 text-xs font-medium ${ticket.pipeline.color}`}>
                                            {ticket.pipeline.label}
                                        </span>
                                    )}
                                    <span className={`rounded-md border border-border px-3 py-1 text-xs font-medium ${PRIORITY_META[ticket.priority]?.color ?? ""}`}>
                                        {PRIORITY_META[ticket.priority]?.label ?? ticket.priority}
                                    </span>
                                    <span className={`rounded-md border border-border px-3 py-1 text-xs font-medium ${ticket.ticketStatus.color}`}>
                                        {ticket.ticketStatus.label}
                                    </span>
                                    {ticket.ticketWorker && (
                                        <span className={`rounded-md border border-border px-3 py-1 text-xs font-medium ${badgeColor(ticket.ticketWorker.color).className}`} style={badgeColor(ticket.ticketWorker.color).style}>
                                            {ticket.ticketWorker.label}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Body: Customer & Device left | Ownership right */}
                            <div className="flex gap-6">
                                <div className="min-w-0 flex-1">
                                    <h2 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                                        <User size={16} /> Customer & Device
                                    </h2>
                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                        <div>
                                            <p className="text-muted-foreground text-xs uppercase mb-1">Customer</p>
                                            <p className="font-medium">{ticket.device.account?.name}</p>
                                            <p className="text-muted-foreground">{ticket.device.account?.phone}</p>
                                            {ticket.device.account?.email && (
                                                <p className="text-muted-foreground">{ticket.device.account.email}</p>
                                            )}
                                        </div>
                                        <div>
                                            <p className="text-muted-foreground text-xs uppercase mb-1">Device</p>
                                            <p className="font-medium">{ticket.device.brand} {ticket.device.model}</p>
                                            <p className="text-muted-foreground">{ticket.device.type}</p>
                                        </div>
                                        <div className="col-span-2">
                                            <p className="text-muted-foreground text-xs uppercase mb-1">Problem</p>
                                            <p className="text-foreground">{ticket.device.problem}</p>
                                        </div>
                                        {ticket.accessInfo && (
                                            <div>
                                                <p className="text-muted-foreground text-xs uppercase mb-1">Access Info</p>
                                                <p className="font-mono bg-muted px-2 py-1 text-foreground">{ticket.accessInfo}</p>
                                            </div>
                                        )}
                                        {ticket.estimatedCost && (
                                            <div>
                                                <p className="text-muted-foreground text-xs uppercase mb-1">Estimated Cost</p>
                                                <p className="font-medium text-primary">₹ {ticket.estimatedCost}</p>
                                            </div>
                                        )}
                                        {ticket.notes && (
                                            <div className="col-span-2">
                                                <p className="text-muted-foreground text-xs uppercase mb-1">Notes</p>
                                                <p className="text-foreground">{ticket.notes}</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="w-px shrink-0 bg-border" />
                                <div className="w-52 shrink-0">
                                    <TicketOwnershipPanel
                                        embedded
                                        ticketId={ticket.id}
                                        primaryOwner={ticket.primaryOwner}
                                        participants={ticket.participants ?? []}
                                        currentUserId={currentUserId}
                                        canManage={canManageOwnership}
                                        isTerminal={ticket.ticketStatus.isTerminal}
                                        onChanged={fetchTicket}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Ongoing draft bill — stock products + service charges (no ledger impact) */}
                        <BillDetailsPanel
                            ticketId={ticket.id}
                            customerAccountId={ticket.device.account?.id ?? null}
                            initial={billDraft}
                            onSaved={fetchTicket}
                        />

                        {/* Escalation Info */}
                        {ticket.escalated && (
                            <div className="rounded-lg border border-border bg-muted p-6">
                                <h2 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                                    <Building2 size={16} /> Escalated to External
                                </h2>
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div>
                                        <p className="text-muted-foreground text-xs uppercase mb-1">Service Center</p>
                                        <p className="font-medium">{ticket.serviceCenter?.name || "—"}</p>
                                    </div>
                                    <div>
                                        <p className="text-muted-foreground text-xs uppercase mb-1">External Ref</p>
                                        <p className="font-medium">{ticket.externalRef || "—"}</p>
                                    </div>
                                    <div>
                                        <p className="text-muted-foreground text-xs uppercase mb-1">Escalated At</p>
                                        <p>{ticket.escalatedAt ? formatDate(ticket.escalatedAt) : "—"}</p>
                                    </div>
                                    <div>
                                        <p className="text-muted-foreground text-xs uppercase mb-1">Expected Return</p>
                                        <p>{ticket.expectedReturn ? formatDate(ticket.expectedReturn) : "—"}</p>
                                    </div>
                                    {ticket.receivedBackAt && (
                                        <div>
                                            <p className="text-muted-foreground text-xs uppercase mb-1">Received Back</p>
                                            <p>{formatDate(ticket.receivedBackAt)}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Timeline — vertical activity rail (newest first) */}
                        <div className="rounded-lg border border-border bg-card p-6 shadow">
                            <h2 className="mb-4 flex items-center gap-2 font-semibold text-foreground">
                                <Clock size={16} /> Timeline
                                {ticket.logs.length > 0 && (
                                    <span className="text-xs font-normal text-muted-foreground">· {ticket.logs.length}</span>
                                )}
                            </h2>
                            {ticket.logs.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No history yet.</p>
                            ) : (
                                <div className="relative">
                                    {ticket.logs.map((log, idx) => {
                                        const kind = classifyLog(log.note);
                                        const meta = KIND_META[kind];
                                        const Icon = meta.icon;
                                        const text = timelineText(log.note, kind);
                                        // Text a human actually typed (a note, or the remark on an
                                        // outcome) is the signal — highlight it; system text stays quiet.
                                        const isHuman = kind === "note" || ((kind === "success" || kind === "fail") && !!text);
                                        const prev = ticket.logs[idx - 1];                       // newer entry above
                                        const showStatus = !prev || prev.status !== log.status;  // collapse repeated stage label
                                        const isLast = idx === ticket.logs.length - 1;
                                        return (
                                            <div key={log.id} className="relative flex gap-3 pb-4 last:pb-0">
                                                {!isLast && <span className="absolute bottom-0 left-[13px] top-7 w-px bg-border" aria-hidden />}
                                                <span className={`relative z-10 mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full ${meta.dot}`}>
                                                    <Icon size={13} />
                                                </span>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                                        {meta.lead && <span className="text-sm font-medium text-foreground">{meta.lead}</span>}
                                                        {log.ticketWorker ? (
                                                            <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${badgeColor(log.ticketWorker.color).className}`} style={badgeColor(log.ticketWorker.color).style}>
                                                                {log.ticketWorker.label}
                                                            </span>
                                                        ) : (kind === "note" && !meta.lead && (
                                                            <span className="text-sm font-medium text-foreground">Note</span>
                                                        ))}
                                                        {showStatus && (
                                                            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${log.ticketStatus.color}`}>
                                                                {log.ticketStatus.label}
                                                            </span>
                                                        )}
                                                        <span className="ml-auto flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                                                            {log.visibility === "public"
                                                                ? <Eye size={11} className="text-primary" aria-label="Public" />
                                                                : <Lock size={11} aria-label="Internal" />}
                                                            <span>{log.author?.userName ?? "—"}</span>
                                                            <span title={formatDateTime(log.createdAt)}>· {timeAgo(log.createdAt)}</span>
                                                        </span>
                                                    </div>
                                                    {text && (isHuman ? (
                                                        <div className={`mt-1.5 rounded-md border px-3 py-2 text-sm text-foreground ${log.visibility === "public" ? "border-primary/30 bg-primary/5" : "border-border bg-muted/50"}`}>
                                                            {log.visibility === "public" && (
                                                                <span className="mb-1 flex items-center gap-1 text-[11px] font-medium text-primary">
                                                                    <Eye size={11} /> Sent to customer
                                                                </span>
                                                            )}
                                                            {text}
                                                        </div>
                                                    ) : (
                                                        <p className="mt-1 text-sm text-muted-foreground">{text}</p>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right Column — Actions */}
                    <div className="space-y-4">
                        {/* DEV (admin-gated): collapsed by default to save space. One toggle
                            reveals both the raw Ticket.context bag and the status/worker
                            override escape-hatch. */}
                        {canDebug && (
                            <div className="rounded-lg border border-dashed border-amber-400/70 bg-amber-50/40 dark:border-amber-700/60 dark:bg-amber-950/10">
                                <button
                                    type="button"
                                    onClick={() => setShowDev((v) => !v)}
                                    className="flex w-full items-center gap-2 px-4 py-2 text-sm font-semibold text-amber-700 dark:text-amber-300"
                                    aria-expanded={showDev}
                                >
                                    <Bug size={14} /> Dev tools
                                    <span className="ml-auto flex items-center gap-2">
                                        <span className="rounded bg-amber-200/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">dev</span>
                                        <ChevronDown size={14} className={`transition-transform ${showDev ? "rotate-180" : ""}`} />
                                    </span>
                                </button>
                                {showDev && (
                                    <div className="space-y-3 border-t border-amber-400/40 p-3 dark:border-amber-700/40">
                                        {/* Raw Ticket.context — the soft data bag where collected
                                            outcome values + spawnedFrom land. */}
                                        <div className="space-y-2">
                                            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-amber-700/90 dark:text-amber-300/90">Ticket context</h3>
                                            {ticket.context && Object.keys(ticket.context).length > 0 ? (
                                                <div className="space-y-1">
                                                    {Object.entries(ticket.context).map(([k, v]) => (
                                                        <div key={k} className="flex gap-2 text-xs">
                                                            <span className="shrink-0 font-mono text-amber-800/80 dark:text-amber-200/80">{k}</span>
                                                            <span className="min-w-0 flex-1 wrap-break-word text-right font-mono text-foreground">
                                                                {v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v)}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="text-xs text-muted-foreground">Empty — no context stored yet.</p>
                                            )}
                                        </div>
                                        {/* Force the ticket onto any (status, worker) pair in its
                                            pipeline with no routing — escape hatch for a stuck ticket. */}
                                        <DevOverridePanel
                                            ticketId={ticket.id}
                                            pipelineId={ticket.pipelineId}
                                            currentStatusId={ticket.status}
                                            currentWorkerId={ticket.workerId ?? null}
                                            onChanged={fetchTicket}
                                        />
                                    </div>
                                )}
                            </div>
                        )}
                        {/* TEMP (dev): the "Current work" card duplicates the Work Inbox so we
                            don't navigate between two pages. Hidden to avoid confusion — flip the
                            `false &&` guard to re-enable. */}
                        {SHOW_CURRENT_WORK && ticket.ticketWorker?.work && (
                            <div className="space-y-3 rounded-lg border border-border bg-card p-4 shadow">
                                <h2 className="text-sm font-semibold text-foreground">Current work</h2>
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ticket.primaryOwner ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" : "bg-muted text-muted-foreground"}`}>
                                        {ticket.primaryOwner ? "In progress" : "To do"}
                                    </span>
                                    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${badgeColor(ticket.ticketWorker.work.color).className}`} style={badgeColor(ticket.ticketWorker.work.color).style}>
                                        {ticket.ticketWorker.work.label}
                                    </span>
                                    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${badgeColor(ticket.ticketWorker.color).className}`} style={badgeColor(ticket.ticketWorker.color).style}>
                                        {ticket.ticketWorker.label}
                                    </span>
                                </div>
                                {ticket.ticketWorker.actionLabel && (
                                    <p className="text-xs font-medium text-primary">→ {ticket.ticketWorker.actionLabel}</p>
                                )}
                                {/* Bound arguments — resolved live from the ticket, shown read-only. */}
                                {(ticket.ticketWorker.work.args ?? []).some((a) => a.source !== "user") && (
                                    <div className="flex flex-wrap gap-2">
                                        {(ticket.ticketWorker.work.args ?? []).filter((a) => a.source !== "user").map((a) => (
                                            <span key={a.key || a.label} className="rounded-md border border-border bg-muted/40 px-2 py-1 text-xs">
                                                <span className="text-muted-foreground">{a.label}: </span>
                                                <span className="font-medium text-foreground">{resolveTicketSource(a.source, ticket) ?? "—"}</span>
                                            </span>
                                        ))}
                                    </div>
                                )}
                                <div className="flex flex-wrap gap-2">
                                    <WorkActions
                                        ticketId={ticket.id}
                                        workLabel={ticket.ticketWorker.work.label}
                                        successLabel={ticket.ticketWorker.work.successLabel}
                                        failLabel={ticket.ticketWorker.work.failLabel}
                                        startLabel={ticket.ticketWorker.work.startLabel}
                                        prompt={ticket.ticketWorker.work.prompt}
                                        successPopup={ticket.ticketWorker.work.successPopup}
                                        failPopup={ticket.ticketWorker.work.failPopup}
                                        args={ticket.ticketWorker.work.args ?? []}
                                        successTarget={ticket.ticketWorker.successWorker ?? null}
                                        failTarget={ticket.ticketWorker.failWorker ?? null}
                                        successStatusTarget={ticket.ticketWorker.successStatus ?? null}
                                        failStatusTarget={ticket.ticketWorker.failStatus ?? null}
                                        isOwned={!!ticket.primaryOwner}
                                        isOwnerMe={ticket.primaryOwner?.id === currentUserId}
                                        onChanged={fetchTicket}
                                    />
                                </div>
                            </div>
                        )}
                        {ticket.parent && (
                            <Link href={`/office/repairing/tickets/${ticket.parent.id}`} className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground hover:bg-muted">
                                <CornerUpLeft size={13} className="shrink-0" /> Child of ticket <span className="font-medium text-foreground">#{ticket.parent.id}</span>
                            </Link>
                        )}
                        {ticket.children && ticket.children.length > 0 && (
                            <div className="space-y-2 rounded-lg border border-border bg-card p-4 shadow">
                                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                    <GitBranch size={14} /> Sub-pipelines
                                </h2>
                                {ticket.children.map((c) => (
                                    <div key={`${c.type}-${c.id}`} className="rounded-md border border-border p-2.5">
                                        <div className="flex items-center gap-2">
                                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                                {c.type}
                                            </span>
                                            {c.pipelineLabel && (
                                                <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${badgeColor(c.pipelineColor).className}`} style={badgeColor(c.pipelineColor).style}>
                                                    {c.pipelineLabel}
                                                </span>
                                            )}
                                            {c.type === "ticket" ? (
                                                <Link href={`/office/repairing/tickets/${c.id}`} className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline">
                                                    Open #{c.id} <ExternalLink size={11} />
                                                </Link>
                                            ) : (
                                                <span className="ml-auto text-xs text-muted-foreground">#{c.id}</span>
                                            )}
                                        </div>
                                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                            {c.statusLabel && (
                                                <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${badgeColor(c.statusColor).className}`} style={badgeColor(c.statusColor).style}>
                                                    {c.statusLabel}
                                                </span>
                                            )}
                                            {c.subLabel && (
                                                <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${badgeColor(c.subColor).className}`} style={badgeColor(c.subColor).style}>
                                                    {c.subLabel}
                                                </span>
                                            )}
                                            {c.isTerminal && (
                                                <span className="inline-flex items-center gap-1 text-[11px] text-green-700 dark:text-green-400"><Check size={11} /> done</span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        <StatusNav
                            ticketId={ticket.id}
                            statusId={ticket.status}
                            workerId={ticket.workerId ?? null}
                            isWarranty={ticket.isWarranty}
                            started={!!ticket.primaryOwner}
                            locked={workInProgress}
                            leavePrompt={ticket.ticketStatus.leavePrompt}
                            nextStatuses={ticket.ticketStatus.fromTransitions.map((t) => t.to)}
                            backTarget={backTarget}
                            onChanged={fetchTicket}
                        />

                        {/* Invoices linked to this ticket (tickets are info-only — bill via Invoice.ticketId) */}
                        <div className="rounded-lg border border-border bg-card p-4 shadow">
                            <TicketInvoicesPanel ticketId={ticket.id} />
                        </div>

                        {/* Actions */}
                        <div className="space-y-2 rounded-lg border border-border bg-card p-4 shadow">
                            <h2 className="font-semibold text-foreground mb-3 text-sm">Actions</h2>

                            <Button onClick={() => setShowAddNote(true)} variant="outline" className={actionBtnBase}>
                                <NotebookPen size={15} /> Add Note
                            </Button>

                            {canTransfer && !ticket.ticketStatus.isTerminal && (
                                <Button onClick={() => setShowTransferModal(true)} variant="outline" className={actionBtnBase} disabled={workInProgress}>
                                    <ArrowRightLeft size={15} /> Transfer Pipeline
                                </Button>
                            )}

                            {canConvertWarranty && ticket.status !== "S7" && ticket.status !== "S8" && (
                                <Button onClick={() => setShowWarrantyModal(true)} variant="outline" className={actionBtnBase} disabled={workInProgress}>
                                    {ticket.isWarranty ? "⚙ Manage Warranty" : "⚙ Mark as Warranty"}
                                </Button>
                            )}

                            {!ticket.escalated && !ticket.ticketStatus.isTerminal &&
                                ticket.ticketStatus.fromTransitions.some(t => t.to.id === "S4") && (
                                    <Button onClick={() => setShowEscalation(true)} variant="outline" className={actionBtnBase} disabled={workInProgress}>
                                        <AlertTriangle size={15} /> Escalate to Service Centre
                                    </Button>
                                )}

                            {ticket.escalated && (
                                showRefEdit ? (
                                    <div className="space-y-2 rounded-md border border-border p-3">
                                        <p className="text-xs text-muted-foreground font-medium">External Ref # / RMA</p>
                                        <Input
                                            type="text"
                                            value={refValue}
                                            onChange={e => setRefValue(e.target.value)}
                                            placeholder="Job #, RMA code…"
                                            className="px-2 py-1.5"
                                            autoFocus
                                        />
                                        <div className="flex gap-2">
                                            <Button onClick={() => setShowRefEdit(false)} variant="outline" size="xs" className="flex-1">Cancel</Button>
                                            <Button onClick={saveRef} disabled={savingRef} size="xs" className="flex-1">
                                                {savingRef ? "Saving…" : "Save"}
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <Button
                                        onClick={() => { setRefValue(ticket.externalRef ?? ""); setShowRefEdit(true); }}
                                        variant="outline"
                                        className={actionBtnBase}
                                    >
                                        <Building2 size={15} />
                                        {ticket.externalRef ? `Ref: ${ticket.externalRef}` : "Add External Ref # / RMA"}
                                    </Button>
                                )
                            )}

                            {isSendToService && !ticket.ticketStatus.isTerminal && (
                                <Button onClick={() => setShowShippingSlip(true)} variant="outline" className={actionBtnBase}>
                                    <Truck size={15} /> Create Shipping Slip
                                </Button>
                            )}

                            {hasShippingSlip && (
                                <Link
                                    href={`/shipping-slip/${ticket.id}`}
                                    target="_blank"
                                    className={`${actionBtnBase} inline-flex`}
                                >
                                    <Truck size={15} /> Print Shipping Slip
                                </Link>
                            )}

                            <Link
                                href={`/receipt/${ticket.id}`}
                                target="_blank"
                                className={`${actionBtnBase} inline-flex`}
                            >
                                <Printer size={15} /> Print Receipt
                            </Link>
                        </div>
                    </div>
                </div>
            </div>

            {/* Modals */}
            {showEscalation && (
                <TicketEscalation ticket={ticket} onClose={() => { setShowEscalation(false); fetchTicket(); }} />
            )}
            {showAddNote && (
                <AddNoteModal ticketId={ticket.id} onClose={() => { setShowAddNote(false); fetchTicket(); }} />
            )}
            {showTransferModal && (
                <PipelineTransferModal
                    ticketId={ticket.id}
                    currentPipelineLabel={ticket.pipeline?.label}
                    onClose={() => { setShowTransferModal(false); fetchTicket(); }}
                />
            )}
            {showShippingSlip && (
                <ShippingSlipModal
                    ticketId={ticket.id}
                    device={{
                        type: ticket.device.type,
                        brand: ticket.device.brand,
                        model: ticket.device.model,
                        problem: ticket.device.problem,
                    }}
                    onClose={() => setShowShippingSlip(false)}
                    onSaved={fetchTicket}
                />
            )}
            {showWarrantyModal && (
                <WarrantyConvertModal
                    ticketId={ticket.id}
                    isWarranty={ticket.isWarranty}
                    warrantyStatus={ticket.warrantyStatus}
                    warrantyRef={ticket.warrantyRef}
                    purchaseDate={ticket.purchaseDate}
                    onClose={() => { setShowWarrantyModal(false); fetchTicket(); }}
                />
            )}
        </div>
    );
}
