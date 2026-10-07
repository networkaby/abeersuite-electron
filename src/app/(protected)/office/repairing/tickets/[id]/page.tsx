"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { formatDate, formatDateTime } from "@/shared/lib/format/formatDate";
import {
    Clock, User, Building2, AlertTriangle,
    Printer, Lock, Eye, NotebookPen, ArrowRightLeft,
    Check, X, MessageSquare, RefreshCw, ArrowRight, CornerUpLeft, Flag,
    GitBranch, ExternalLink, Bug, Truck, ChevronDown, Receipt, Pencil, Trash2,
    type LucideIcon,
} from "lucide-react";
import { useDeleteWithConfirm } from "@/shared/hooks";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { statusHasWorkflowRole } from "@/shared/lib/constants/workflow";
import { timeAgo } from "@/shared/lib/format/timeAgo";
import { badgeColor } from "@/shared/lib/format/entityColor";
import Link from "next/link";
import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";
import { PRIORITY_META } from "@/shared/lib/constants/badges";
import TicketEscalation from "@/modules/repairing/components/TicketEscalation";
import StatusNav from "@/modules/repairing/components/StatusNav";
import AddNoteModal from "@/modules/repairing/components/AddNoteModal";
import WarrantyDetailsBadge from "@/modules/repairing/components/WarrantyDetailsBadge";
import WarrantyConvertModal from "@/modules/repairing/components/WarrantyConvertModal";
import PipelineTransferModal from "@/modules/repairing/components/PipelineTransferModal";
import TicketInvoicesPanel from "@/modules/repairing/components/TicketInvoicesPanel";
import RepairWhatsAppButtons from "@/modules/repairing/components/RepairWhatsAppButtons";
import UserAvatar from "@/shared/components/UserAvatar";
import { editFormUrl } from "@/modules/inventory/components/VoucherActionsMenu";
import ShippingSlipModal from "@/modules/repairing/components/ShippingSlipModal";
import EditTicketModal from "@/modules/repairing/components/EditTicketModal";
import BillDetailsPanel, { type BillDraft } from "@/modules/repairing/components/BillDetailsPanel";
import WorkActions from "@/modules/repairing/components/WorkActions";
import DevOverridePanel from "@/modules/repairing/components/DevOverridePanel";
import { resolveTicketSource, type WorkArg } from "@/modules/repairing/lib/ticketSources";
import { useSession } from "next-auth/react";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";

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
    accessories?: string;
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
    serviceCenter?: { id: number; name: string };
    logs: {
        id: number;
        status: string;
        workerId?: string;
        note?: string;
        visibility: string;
        // Structured record on the log row — slip logs carry their frozen copy;
        // bill logs carry the linked voucher + payment split.
        data?: {
            shippingSlip?: { seq?: number; partyName?: string };
            bill?: { voucherId: number; voucherRef: string; voucherType: string; status: "full" | "partial" | "credit" };
        } | null;
        createdAt: string;
        // Actor is a frozen JSON snapshot now (no User FK) — see ActorSnapshot.
        author?: { userId?: number; userName?: string; avatarUrl?: string | null; positionTitle?: string | null } | null;
        ticketStatus: { label: string; color: string };
        ticketWorker?: { label: string; color: string } | null;
    }[];
}

// A stored service-slip record in the ticket's context bag. The latest one is
// editable in place until `locked` (set when the device is sent to service).
type SlipRecord = {
    seq?: number;
    partyAccountId?: number;
    partyName?: string;
    ref?: string | null;
    date?: string;
    device?: { type: string; brand: string; model: string; problem: string };
    accessories?: string | null;
    condition?: string | null;
    notes?: string | null;
    showOwner?: boolean;
    contactName?: string | null;
    contactPhone?: string | null;
    locked?: boolean;
    sentAt?: string;
};

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
    const [showEdit, setShowEdit] = useState(false);
    const [showDev, setShowDev] = useState(false);
    const [showRefEdit, setShowRefEdit] = useState(false);
    const [refValue, setRefValue] = useState("");
    const [savingRef, setSavingRef] = useState(false);
    const { data: session } = useSession();
    const sessionUser = session?.user as { id?: string; permissions?: string[] } | undefined;
    // Dev-only debug surfaces (the raw ticket-context panel). Gated on an admin
    // permission — visible to admins / the super-admin bypass, hidden from staff.
    const perms = sessionUser?.permissions ?? [];
    const canDebug = perms.includes(PERMISSIONS.ADMIN_BYPASS) || perms.includes(PERMISSIONS.SETTINGS_MANAGE);
    // Edit-ticket action is gated on tickets:edit (admin bypass passes) — the same
    // grant surfaced by the role page's Tickets CRUD row.
    // Read on the CRUD ladder — a Delete grant is also Edit (only the top rung is
    // carried in the session); admin bypass passes.
    const canEditTicket = hasPermissionWithScope(perms, PERMISSIONS.TICKETS_EDIT);
    const canDeleteTicket = hasPermissionWithScope(perms, PERMISSIONS.TICKETS_DELETE);
    // Deleting takes the whole ticket and its timeline; the server refuses when a
    // bill or a child ticket is attached and its message comes back in the toast.
    const router = useRouter();
    const { remove: removeTicket, deleting } = useDeleteWithConfirm({
        url: (tid) => `/api/tickets/${tid}`,
        message: () => "Delete this ticket? Its notes, works and timeline go with it. This cannot be undone.",
        successMessage: "Ticket deleted",
        onSuccess: () => router.push("/office/repairing/tickets"),
    });
    // TODO(rbac): repairing actions temporarily open to all staff — re-gate on
    // position-based permissions when RBAC is re-wired.
    const canConvertWarranty = true;
    const canTransfer = false; // Pipeline transfer hidden for now (re-enable when needed).

    // Repair tickets are NOT owned/assigned (that system is retired from this UI).
    // Instead we keep a SOFT record of who contributed — the distinct people who
    // authored any timeline entry (status moves, works, notes, slips, bills).
    // TODO(audit): the assign backend (/assign route, assignedPositionId,
    // participants) is still live for Deals/Tasks — remove during that audit.
    const contributors = (() => {
        const seen = new Map<string, { name: string; avatarUrl?: string | null; positionTitle?: string | null }>();
        for (const l of ticket?.logs ?? []) {
            const a = l.author;
            if (!a?.userName) continue;
            const key = String(a.userId ?? a.userName);
            if (!seen.has(key)) seen.set(key, { name: a.userName, avatarUrl: a.avatarUrl, positionTitle: a.positionTitle });
        }
        return Array.from(seen.values());
    })();

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
    // A worker's status move, note or bill on another PC shows up here without F5.
    useRealtimeTopics(["tickets"], () => { void fetchTicket(); });

    if (loading) return <p className="text-muted-foreground">Loading...</p>;
    if (!ticket) return <p className="text-muted-foreground">Ticket not found.</p>;
    // Every repair ticket carries its device (TicketRepair.deviceId is required).
    // No device = a deal or help-desk ticket opened on the repair page by number.
    if (!ticket.device) return <p className="text-muted-foreground">Ticket #{ticket.id} is not a repair ticket.</p>;

    // The "Current work" card lets the technician advance the ticket's Work (Accept /
    // Reject → next worker/status) right on the ticket page, mirroring the Work Inbox
    // card. Kept as a named flag so it's easy to hide again if the duplication bites.
    const SHOW_CURRENT_WORK: boolean = true;

    const actionBtnBase = "w-full border border-border py-2 text-sm flex items-center justify-center gap-2 transition-colors hover:bg-muted rounded-md";

    // Work is "in progress" when the current worker carries an active Work step.
    // (Ownership is retired from this UI, so there's no owner gate any more.)
    // When true: StatusNav is locked, all Actions except Add Note are locked.
    const workInProgress = !!ticket.ticketWorker?.work;

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

    // Shipping-slip history (context bag) — a device may loop through several
    // service centres, one copy per send. The latest is editable in place ONLY
    // until it's sent (locked on entry to a "Sent To Service" status); a later
    // re-escalation then starts a fresh slip. Legacy = single slip.
    const shippingSlips: SlipRecord[] = (() => {
        const c = ticket.context && typeof ticket.context === "object" && !Array.isArray(ticket.context)
            ? (ticket.context as Record<string, unknown>)
            : {};
        if (Array.isArray(c.shippingSlips)) return c.shippingSlips as SlipRecord[];
        return c.shippingSlip ? [c.shippingSlip as SlipRecord] : [];
    })();
    const latestSlip = shippingSlips[shippingSlips.length - 1];
    // The latest slip is editable while we're still at the send stage and it
    // hasn't been committed (locked) by a send yet.
    const slipEditable =
        !!latestSlip && !latestSlip.locked && statusHasWorkflowRole("shipToService", ticket.status);

    // Ongoing draft bill saved on the ticket (context bag).
    const savedBill =
        (ticket.context &&
            typeof ticket.context === "object" &&
            ((ticket.context as Record<string, unknown>).billDraft as Partial<BillDraft> | undefined)) ||
        undefined;
    const billDraft: BillDraft = {
        products: savedBill?.products ?? [],
        services: savedBill?.services ?? [],
    };

    return (
        <div className="flex h-full flex-col">
            <PathBreadcrumb
                root={{ href: "/office/repairing", label: "Repair & Warranty" }}
                escapeBack
                labels={{ tickets: "All Repair" }}
            />
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">

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
                                <div className="flex flex-wrap items-center justify-end gap-2">
                                    <WarrantyDetailsBadge
                                        isWarranty={ticket.isWarranty}
                                        warrantyStatus={ticket.warrantyStatus}
                                        warrantyRef={ticket.warrantyRef}
                                        purchaseDate={ticket.purchaseDate}
                                        voidReason={ticket.voidReason}
                                    />
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
                                    {/* Soft contributor record — no ownership/assignment. */}
                                    <div className="space-y-2">
                                        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                            <User size={15} /> Contributors
                                        </h2>
                                        {contributors.length === 0 ? (
                                            <p className="text-xs text-muted-foreground">No activity yet.</p>
                                        ) : (
                                            <div className="space-y-1.5">
                                                {contributors.map((c) => (
                                                    <div key={c.name} className="flex items-center gap-2" title={c.positionTitle ?? undefined}>
                                                        <UserAvatar avatarUrl={c.avatarUrl} name={c.name} sizePx={22} />
                                                        <span className="truncate text-xs text-foreground">{c.name}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Ongoing draft bill — stock products + service charges (no ledger impact) */}
                        <BillDetailsPanel
                            ticketId={ticket.id}
                            customerAccountId={ticket.device.account?.id ?? null}
                            canGenerateBill={statusHasWorkflowRole("readyToBill", ticket.status)}
                            initial={billDraft}
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
                                                            {log.author?.userName && (
                                                                <UserAvatar avatarUrl={log.author.avatarUrl} name={log.author.userName} sizePx={18} />
                                                            )}
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
                                                    {/* Slip logs carry their frozen copy — open the service slip or the packet label. */}
                                                    {log.data?.shippingSlip && (
                                                        <div className="mt-1 flex flex-wrap items-center gap-3">
                                                            <Link
                                                                href={`/shipping-slip/${ticket.id}${log.data.shippingSlip.seq ? `?n=${log.data.shippingSlip.seq}` : ""}`}
                                                                target="_blank"
                                                                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                                                            >
                                                                <Truck size={12} /> Open service slip{log.data.shippingSlip.seq ? ` #${log.data.shippingSlip.seq}` : ""}
                                                            </Link>
                                                            <Link
                                                                href={`/shipping-label/${ticket.id}${log.data.shippingSlip.seq ? `?n=${log.data.shippingSlip.seq}` : ""}`}
                                                                target="_blank"
                                                                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                                                            >
                                                                <Printer size={12} /> Label
                                                            </Link>
                                                        </div>
                                                    )}
                                                    {/* Bill logs — open the linked voucher. */}
                                                    {log.data?.bill && editFormUrl(log.data.bill.voucherType, log.data.bill.voucherId) && (
                                                        <Link
                                                            href={editFormUrl(log.data.bill.voucherType, log.data.bill.voucherId)!}
                                                            className="mt-1 inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                                                        >
                                                            <Receipt size={12} /> Open bill {log.data.bill.voucherRef}
                                                        </Link>
                                                    )}
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
                                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                                        In progress
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
                                        // Ownership retired from repair UI: no claim step, anyone can complete.
                                        isOwned={true}
                                        isOwnerMe={true}
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
                            started={workInProgress}
                            locked={workInProgress}
                            leavePrompt={ticket.ticketStatus.leavePrompt}
                            nextStatuses={ticket.ticketStatus.fromTransitions.map((t) => t.to)}
                            backTarget={backTarget}
                            forwardBlockedReason={
                                statusHasWorkflowRole("shipToService", ticket.status) && shippingSlips.length === 0
                                    ? "Create a service slip before moving forward"
                                    : null
                            }
                            onChanged={fetchTicket}
                        />

                        {/* Invoices linked to this ticket — the panel renders its own
                            card and hides entirely when nothing is linked yet. */}
                        <TicketInvoicesPanel ticketId={ticket.id} />

                        {/* Actions */}
                        <div className="space-y-2 rounded-lg border border-border bg-card p-4 shadow">
                            <h2 className="font-semibold text-foreground mb-3 text-sm">Actions</h2>

                            {canEditTicket && !ticket.ticketStatus.isTerminal && (
                                <Button onClick={() => setShowEdit(true)} variant="outline" className={actionBtnBase} disabled={workInProgress}>
                                    <Pencil size={15} /> Edit Ticket
                                </Button>
                            )}

                            <Button onClick={() => setShowAddNote(true)} variant="outline" className={actionBtnBase}>
                                <NotebookPen size={15} /> Add Note
                            </Button>

                            <RepairWhatsAppButtons ticketId={ticket.id} className={actionBtnBase} />

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

                            {statusHasWorkflowRole("shipToService", ticket.status) && !ticket.ticketStatus.isTerminal && (
                                <Button onClick={() => setShowShippingSlip(true)} variant="outline" className={actionBtnBase}>
                                    <Truck size={15} /> {slipEditable ? "Edit Service Slip" : "Create Service Slip"}
                                </Button>
                            )}

                            {shippingSlips.length > 0 && (
                                <>
                                    <Link
                                        href={`/shipping-slip/${ticket.id}`}
                                        target="_blank"
                                        className={`${actionBtnBase} inline-flex`}
                                    >
                                        <Truck size={15} /> Print Service Slip
                                    </Link>
                                    <Link
                                        href={`/shipping-label/${ticket.id}`}
                                        target="_blank"
                                        className={`${actionBtnBase} inline-flex`}
                                    >
                                        <Printer size={15} /> Print Shipping Label
                                    </Link>
                                </>
                            )}
                            {shippingSlips.length > 1 && (
                                <div className="space-y-1 rounded-md border border-border bg-muted/30 px-3 py-2">
                                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Past sends</p>
                                    {shippingSlips.map((s, i) => (
                                        <Link
                                            key={i}
                                            href={`/shipping-slip/${ticket.id}?n=${s.seq ?? i + 1}`}
                                            target="_blank"
                                            className="flex items-center justify-between gap-2 text-xs text-primary hover:underline"
                                        >
                                            <span className="truncate">#{s.seq ?? i + 1} → {s.partyName ?? "—"}</span>
                                            <span className="shrink-0 text-muted-foreground">{s.date ? formatDate(s.date) : ""}</span>
                                        </Link>
                                    ))}
                                </div>
                            )}

                            <Link
                                href={`/receipt/${ticket.id}`}
                                target="_blank"
                                className={`${actionBtnBase} inline-flex`}
                            >
                                <Printer size={15} /> Print Receipt
                            </Link>

                            {/* Destructive — kept last and visually separated so it is
                                never the button you hit by accident. */}
                            {canDeleteTicket && (
                                <div className="mt-3 border-t border-border pt-3">
                                    <Button
                                        onClick={() => removeTicket(ticket.id)}
                                        variant="outline"
                                        disabled={deleting}
                                        className={`${actionBtnBase} text-destructive hover:bg-destructive/10`}
                                    >
                                        <Trash2 size={15} /> {deleting ? "Deleting…" : "Delete Ticket"}
                                    </Button>
                                </div>
                            )}
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
            {showEdit && (
                <EditTicketModal
                    ticketId={ticket.id}
                    initial={{
                        deviceType: ticket.device.type ?? "",
                        brand: ticket.device.brand ?? "",
                        model: ticket.device.model ?? "",
                        problem: ticket.device.problem ?? "",
                        accessories: ticket.accessories ?? "",
                        priority: ticket.priority,
                        accessInfo: ticket.accessInfo ?? "",
                        estimatedCost: ticket.estimatedCost != null ? String(ticket.estimatedCost) : "",
                        notes: ticket.notes ?? "",
                    }}
                    onClose={() => setShowEdit(false)}
                    onSaved={fetchTicket}
                />
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
                    owner={{
                        name: ticket.device.account?.name ?? "",
                        phone: ticket.device.account?.phone ?? null,
                    }}
                    existing={slipEditable && latestSlip?.partyAccountId != null ? {
                        partyAccountId: latestSlip.partyAccountId,
                        partyName:      latestSlip.partyName ?? "",
                        ref:            latestSlip.ref ?? null,
                        device:         latestSlip.device ?? { type: "", brand: "", model: "", problem: "" },
                        accessories:    latestSlip.accessories ?? null,
                        condition:      latestSlip.condition ?? null,
                        notes:          latestSlip.notes ?? null,
                        showOwner:      latestSlip.showOwner,
                        contactName:    latestSlip.contactName ?? null,
                        contactPhone:   latestSlip.contactPhone ?? null,
                    } : null}
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
