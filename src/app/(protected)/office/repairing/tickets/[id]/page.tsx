"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { formatDate, formatDateTime } from "@/shared/lib/format/formatDate";
import {
    Clock, User, Building2, AlertTriangle,
    Printer, Lock, Eye, NotebookPen, ArrowRightLeft,
} from "lucide-react";
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
import WorkActions from "@/modules/repairing/components/WorkActions";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Ticket {
    id: number;
    status: string;
    subStatusId?: string;
    pipelineId?: string | null;
    pipeline?: { id: string; label: string; color: string } | null;
    ticketSubStatus?: { id: string; label: string; color: string; actionLabel?: string | null; work?: { label: string; color: string } | null; successSubStatus?: { id: string; label: string } | null; failSubStatus?: { id: string; label: string } | null } | null;
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
        fromTransitions: { to: { id: string; label: string } }[];
    };
    device: {
        type: string;
        brand: string;
        model: string;
        problem: string;
        account: { name: string; phone?: string | null; email?: string | null } | null;
    };
    primaryOwner?: { id: number; name: string };
    participants?: { user: { id: number; name: string; role: string }; addedForRole?: string | null }[];
    serviceCenter?: { id: number; name: string };
    logs: {
        id: number;
        status: string;
        subStatusId?: string;
        note?: string;
        visibility: string;
        createdAt: string;
        changedBy: { name: string };
        ticketStatus: { label: string; color: string };
        ticketSubStatus?: { label: string; color: string } | null;
    }[];
}

export default function TicketDetailPage() {
    const { id } = useParams();
    const [ticket, setTicket] = useState<Ticket | null>(null);
    const [loading, setLoading] = useState(true);
    const [showEscalation, setShowEscalation] = useState(false);
    const [showAddNote, setShowAddNote] = useState(false);
    const [showWarrantyModal, setShowWarrantyModal] = useState(false);
    const [showTransferModal, setShowTransferModal] = useState(false);
    const [showRefEdit, setShowRefEdit] = useState(false);
    const [refValue, setRefValue] = useState("");
    const [savingRef, setSavingRef] = useState(false);
    const { data: session } = useSession();
    const sessionUser = session?.user as { id?: string } | undefined;
    const currentUserId = Number(sessionUser?.id ?? "0");
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

    const actionBtnBase = "w-full border border-border py-2 text-sm flex items-center justify-center gap-2 transition-colors hover:bg-muted rounded-md";

    // Work is "in progress" when the ticket has an owner AND an active work sub-status.
    // When true: StatusNav is locked, all Actions except Add Note are locked.
    const workInProgress = !!ticket.primaryOwner && !!ticket.ticketSubStatus?.work;

    // Single "Back" = the previous distinct step in this ticket's history (an undo of
    // the last move) — prefer the prior sub-status, else the prior main status.
    const backTarget = (() => {
        for (const log of ticket.logs) {
            if (log.subStatusId && log.subStatusId !== ticket.subStatusId)
                return { kind: "sub" as const, id: log.subStatusId, label: log.ticketSubStatus?.label ?? "previous step" };
        }
        for (const log of ticket.logs) {
            if (log.status && log.status !== ticket.status)
                return { kind: "status" as const, id: log.status, label: log.ticketStatus?.label ?? log.status };
        }
        return null;
    })();

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
                                    {ticket.ticketSubStatus && (
                                        <span className={`rounded-md border border-border px-3 py-1 text-xs font-medium ${ticket.ticketSubStatus.color}`}>
                                            {ticket.ticketSubStatus.label}
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

                        {/* Timeline — one card per log entry */}
                        <div className="rounded-lg border border-border bg-card p-6 shadow">
                            <h2 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                                <Clock size={16} /> Timeline
                            </h2>
                            {ticket.logs.length === 0 ? (
                                <p className="text-muted-foreground text-sm">No history yet.</p>
                            ) : (
                                <div className="space-y-3">
                                    {ticket.logs.map((log) => {
                                        const isNoteOnly = !log.subStatusId && log.note && log.status === ticket.status;
                                        return (
                                            <div
                                                key={log.id}
                                                className={`rounded-md border border-border border-l-4 bg-background p-3 ${log.subStatusId ? "border-l-accent" : isNoteOnly ? "border-l-primary" : "border-l-muted-foreground"
                                                    }`}
                                            >
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${log.ticketStatus.color}`}>
                                                            {log.ticketStatus.label}
                                                        </span>
                                                        {log.ticketSubStatus && (
                                                            <span className={`rounded px-2 py-0.5 text-xs font-medium ${log.ticketSubStatus.color}`}>
                                                                {log.ticketSubStatus.label}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {log.visibility === "public" ? (
                                                        <span className="flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                                                            <Eye size={10} /> Public
                                                        </span>
                                                    ) : (
                                                        <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                                                            <Lock size={10} /> Internal
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                                    <span className="flex items-center gap-1">
                                                        <User size={11} /> {log.changedBy.name}
                                                    </span>
                                                    <span className="flex items-center gap-1">
                                                        <Clock size={11} /> {formatDateTime(log.createdAt)}
                                                    </span>
                                                </div>
                                                {log.note && (
                                                    <p className="mt-2 text-sm text-foreground">{log.note}</p>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right Column — Actions */}
                    <div className="space-y-4">
                        {ticket.ticketSubStatus?.work && (
                            <div className="space-y-3 rounded-lg border border-border bg-card p-4 shadow">
                                <h2 className="text-sm font-semibold text-foreground">Current work</h2>
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ticket.primaryOwner ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" : "bg-muted text-muted-foreground"}`}>
                                        {ticket.primaryOwner ? "In progress" : "To do"}
                                    </span>
                                    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${ticket.ticketSubStatus.work.color}`}>
                                        {ticket.ticketSubStatus.work.label}
                                    </span>
                                    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${ticket.ticketSubStatus.color}`}>
                                        {ticket.ticketSubStatus.label}
                                    </span>
                                </div>
                                {ticket.ticketSubStatus.actionLabel && (
                                    <p className="text-xs font-medium text-primary">→ {ticket.ticketSubStatus.actionLabel}</p>
                                )}
                                <div className="flex flex-wrap gap-2">
                                    <WorkActions
                                        ticketId={ticket.id}
                                        workLabel={ticket.ticketSubStatus.work.label}
                                        successTarget={ticket.ticketSubStatus.successSubStatus ?? null}
                                        failTarget={ticket.ticketSubStatus.failSubStatus ?? null}
                                        isOwned={!!ticket.primaryOwner}
                                        isOwnerMe={ticket.primaryOwner?.id === currentUserId}
                                        onChanged={fetchTicket}
                                    />
                                </div>
                            </div>
                        )}
                        <StatusNav
                            ticketId={ticket.id}
                            statusId={ticket.status}
                            subStatusId={ticket.subStatusId ?? null}
                            isWarranty={ticket.isWarranty}
                            started={!!ticket.primaryOwner}
                            locked={workInProgress}
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
