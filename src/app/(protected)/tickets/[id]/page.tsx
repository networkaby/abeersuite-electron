"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { formatDate, formatDateTime } from "@/lib/format-date";
import {
    ArrowLeft,
    Clock,
    User,
    Wrench,
    Building2,
    AlertTriangle,
    Printer,
    Lock,
    Eye,
    NotebookPen,
} from "lucide-react";
import Link from "next/link";
import TicketEscalation from "@/components/TicketEscalation";
import StatusUpdateCombined from "@/components/StatusUpdateCombined";
import AddNoteModal from "@/components/AddNoteModal";
import WarrantyBadge from "@/components/WarrantyBadge";
import WarrantyConvertModal from "@/components/WarrantyConvertModal";
import { useSession } from "next-auth/react";
interface Ticket {
    id: number;
    status: string;
    subStatusId?: string;
    ticketSubStatus?: { id: string; label: string; color: string } | null;
    priority: string;
    ticketPriority: { label: string; color: string };
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
        customer: { name: string; phone: string; email?: string };
    };
    technician?: { id: number; name: string };
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
    warrantyLogs: {
        id: number;
        fromWarranty: boolean;
        toWarranty: boolean;
        fromStatus: string;
        toStatus: string;
        voidReason?: string | null;
        note?: string | null;
        createdAt: string;
        changedBy: { name: string };
    }[];
}


export default function TicketDetailPage() {
    const { id } = useParams();
    const [ticket, setTicket] = useState<Ticket | null>(null);
    const [loading, setLoading] = useState(true);
    const [showStatusUpdate, setShowStatusUpdate] = useState(false);
    const [showEscalation, setShowEscalation] = useState(false);
    const [showAddNote, setShowAddNote] = useState(false);
    const [showWarrantyModal, setShowWarrantyModal] = useState(false);
    const [showRefEdit, setShowRefEdit] = useState(false);
    const [refValue, setRefValue] = useState("");
    const [savingRef, setSavingRef] = useState(false);
    const { data: session } = useSession();
    const userRoles = (session?.user as { roles?: string[] } | undefined)?.roles ?? [];
    const canConvertWarranty = userRoles.some((r) => r === "R1" || r === "R2");

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

    useEffect(() => {
        fetchTicket();
    }, [fetchTicket]);

    if (loading) return <p className="text-gray-500">Loading...</p>;
    if (!ticket) return <p className="text-gray-500">Ticket not found.</p>;

    return (
        <div className="max-w-5xl mx-auto">
            {/* Header */}
            <div className="flex items-center gap-4 mb-6">
                <Link href="/tickets" className="text-gray-400 hover:text-gray-600">
                    <ArrowLeft size={20} />
                </Link>
                <div className="flex-1">
                    <h1 className="text-2xl font-bold">Ticket #{ticket.id}</h1>
                    <p className="text-gray-400 text-sm">
                        Created {formatDateTime(ticket.createdAt)}
                    </p>
                </div>
                <div className="flex gap-2 flex-wrap">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${ticket.ticketPriority.color}`}>
                        {ticket.ticketPriority.label}
                    </span>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${ticket.ticketStatus.color}`}>
                        {ticket.ticketStatus.label}
                    </span>
                    {ticket.ticketSubStatus && (
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${ticket.ticketSubStatus.color}`}>
                            {ticket.ticketSubStatus.label}
                        </span>
                    )}
                </div>
            </div>

            {/* Warranty banner */}
            {ticket.isWarranty && (
                <div className={`mb-4 rounded-xl border px-5 py-3 flex items-center gap-3 text-sm ${
                    ticket.warrantyStatus === "voided" ? "bg-red-50 border-red-200 text-red-700" :
                    ticket.warrantyStatus === "confirmed" ? "bg-green-50 border-green-200 text-green-700" :
                    "bg-amber-50 border-amber-200 text-amber-700"
                }`}>
                    <WarrantyBadge isWarranty={ticket.isWarranty} warrantyStatus={ticket.warrantyStatus} />
                    <span className="flex-1">
                        {ticket.warrantyStatus === "voided" && ticket.voidReason && `Void reason: ${ticket.voidReason.replace(/_/g, " ")}`}
                        {ticket.warrantyStatus === "confirmed" && "Warranty confirmed — no charge to customer."}
                        {ticket.warrantyStatus === "claimed" && "Warranty claim in progress."}
                    </span>
                    {ticket.warrantyRef && <span className="text-xs opacity-70">Ref: {ticket.warrantyRef}</span>}
                </div>
            )}

            <div className="grid grid-cols-3 gap-6">
                {/* Left Column */}
                <div className="col-span-2 space-y-6">

                    {/* Customer & Device */}
                    <div className="bg-white rounded-xl shadow p-6">
                        <h2 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
                            <User size={16} /> Customer & Device
                        </h2>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                                <p className="text-gray-400 text-xs uppercase mb-1">Customer</p>
                                <p className="font-medium">{ticket.device.customer.name}</p>
                                <p className="text-gray-500">{ticket.device.customer.phone}</p>
                                {ticket.device.customer.email && (
                                    <p className="text-gray-500">{ticket.device.customer.email}</p>
                                )}
                            </div>
                            <div>
                                <p className="text-gray-400 text-xs uppercase mb-1">Device</p>
                                <p className="font-medium">{ticket.device.brand} {ticket.device.model}</p>
                                <p className="text-gray-500">{ticket.device.type}</p>
                            </div>
                            <div className="col-span-2">
                                <p className="text-gray-400 text-xs uppercase mb-1">Problem</p>
                                <p className="text-gray-700">{ticket.device.problem}</p>
                            </div>
                            {ticket.accessInfo && (
                                <div>
                                    <p className="text-gray-400 text-xs uppercase mb-1">Access Info</p>
                                    <p className="font-mono bg-gray-50 px-2 py-1 rounded text-gray-700">{ticket.accessInfo}</p>
                                </div>
                            )}
                            {ticket.estimatedCost && (
                                <div>
                                    <p className="text-gray-400 text-xs uppercase mb-1">Estimated Cost</p>
                                    <p className="font-medium text-green-600">₹ {ticket.estimatedCost}</p>
                                </div>
                            )}
                            {ticket.notes && (
                                <div className="col-span-2">
                                    <p className="text-gray-400 text-xs uppercase mb-1">Notes</p>
                                    <p className="text-gray-600">{ticket.notes}</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Escalation Info */}
                    {ticket.escalated && (
                        <div className="bg-orange-50 border border-orange-200 rounded-xl p-6">
                            <h2 className="font-semibold text-orange-700 mb-4 flex items-center gap-2">
                                <Building2 size={16} /> Escalated to External
                            </h2>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <p className="text-gray-400 text-xs uppercase mb-1">Service Center</p>
                                    <p className="font-medium">{ticket.serviceCenter?.name || "—"}</p>
                                </div>
                                <div>
                                    <p className="text-gray-400 text-xs uppercase mb-1">External Ref</p>
                                    <p className="font-medium">{ticket.externalRef || "—"}</p>
                                </div>
                                <div>
                                    <p className="text-gray-400 text-xs uppercase mb-1">Escalated At</p>
                                    <p>{ticket.escalatedAt ? formatDate(ticket.escalatedAt) : "—"}</p>
                                </div>
                                <div>
                                    <p className="text-gray-400 text-xs uppercase mb-1">Expected Return</p>
                                    <p>{ticket.expectedReturn ? formatDate(ticket.expectedReturn) : "—"}</p>
                                </div>
                                {ticket.receivedBackAt && (
                                    <div>
                                        <p className="text-gray-400 text-xs uppercase mb-1">Received Back</p>
                                        <p>{formatDate(ticket.receivedBackAt)}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Timeline */}
                    <div className="bg-white rounded-xl shadow p-6">
                        <h2 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
                            <Clock size={16} /> Timeline
                        </h2>
                        {ticket.warrantyLogs.length > 0 && (
                            <div className="mb-4 space-y-3">
                                {ticket.warrantyLogs.map((wl) => (
                                    <div key={wl.id} className="flex gap-3">
                                        <div className="w-2 h-2 rounded-full mt-2 shrink-0 bg-amber-400" />
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                                                    {wl.toWarranty
                                                        ? wl.toStatus === "voided" ? "Warranty Voided" : "Converted to Warranty"
                                                        : "Removed from Warranty"}
                                                </span>
                                                <span className="text-xs text-gray-400">by {wl.changedBy.name}</span>
                                                <span className="text-xs text-gray-400">{formatDateTime(wl.createdAt)}</span>
                                            </div>
                                            {(wl.voidReason || wl.note) && (
                                                <p className="text-sm text-gray-500 mt-0.5">
                                                    {wl.voidReason && <span>Reason: {wl.voidReason.replace(/_/g, " ")}. </span>}
                                                    {wl.note}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                <hr className="border-dashed border-gray-200" />
                            </div>
                        )}
                        {ticket.logs.length === 0 && ticket.warrantyLogs.length === 0 ? (
                            <p className="text-gray-400 text-sm">No history yet.</p>
                        ) : ticket.logs.length === 0 ? null : (
                            <div className="space-y-4">
                                {ticket.logs.map((log) => {
                                    const isNoteOnly = !log.subStatusId && log.note && log.status === ticket.status;
                                    return (
                                        <div key={log.id} className="flex gap-3">
                                            <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${
                                                log.subStatusId ? "bg-purple-400" : isNoteOnly ? "bg-green-400" : "bg-blue-400"
                                            }`} />
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${log.ticketStatus.color}`}>
                                                        {log.ticketStatus.label}
                                                    </span>
                                                    {log.ticketSubStatus && (
                                                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${log.ticketSubStatus.color}`}>
                                                            {log.ticketSubStatus.label}
                                                        </span>
                                                    )}
                                                    <span className="text-xs text-gray-400">by {log.changedBy.name}</span>
                                                    <span className="text-xs text-gray-400">{formatDateTime(log.createdAt)}</span>
                                                </div>
                                                {log.note && (
                                                    <div className="flex items-start gap-2 mt-1">
                                                        <p className="text-sm text-gray-600 flex-1">{log.note}</p>
                                                        {log.visibility === "public" ? (
                                                            <span className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded shrink-0">
                                                                <Eye size={10} /> Public
                                                            </span>
                                                        ) : (
                                                            <span className="flex items-center gap-1 text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded shrink-0">
                                                                <Lock size={10} /> Internal
                                                            </span>
                                                        )}
                                                    </div>
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
                    {/* Technician */}
                    <div className="bg-white rounded-xl shadow p-4">
                        <h2 className="font-semibold text-gray-700 mb-3 flex items-center gap-2 text-sm">
                            <Wrench size={15} /> Assigned Technician
                        </h2>
                        <p className="text-sm text-gray-600">
                            {ticket.technician?.name || "Unassigned"}
                        </p>
                    </div>

                    {/* Actions */}
                    <div className="bg-white rounded-xl shadow p-4 space-y-2">
                        <h2 className="font-semibold text-gray-700 mb-3 text-sm">Actions</h2>

                        <button
                            onClick={() => setShowStatusUpdate(true)}
                            className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700"
                        >
                            Update Status
                        </button>

                        <button
                            onClick={() => setShowAddNote(true)}
                            className="w-full border border-gray-300 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50 flex items-center justify-center gap-2"
                        >
                            <NotebookPen size={15} />
                            Add Note
                        </button>

                        {canConvertWarranty && ticket.status !== "S7" && ticket.status !== "S8" && (
                            <button
                                onClick={() => setShowWarrantyModal(true)}
                                className={`w-full border rounded-lg py-2 text-sm flex items-center justify-center gap-2 ${
                                    ticket.isWarranty
                                        ? "border-red-300 text-red-600 hover:bg-red-50"
                                        : "border-amber-300 text-amber-600 hover:bg-amber-50"
                                }`}
                            >
                                {ticket.isWarranty ? "⚙ Manage Warranty" : "⚙ Mark as Warranty"}
                            </button>
                        )}

                        {/* Escalate — only when not yet escalated and status can transition to S4 */}
                        {!ticket.escalated && !ticket.ticketStatus.isTerminal &&
                            ticket.ticketStatus.fromTransitions.some(t => t.to.id === "S4") && (
                            <button
                                onClick={() => setShowEscalation(true)}
                                className="w-full border border-orange-400 text-orange-500 rounded-lg py-2 text-sm hover:bg-orange-50 flex items-center justify-center gap-2"
                            >
                                <AlertTriangle size={15} />
                                Escalate to Service Centre
                            </button>
                        )}

                        {/* Update Ref # — visible when already escalated */}
                        {ticket.escalated && (
                            showRefEdit ? (
                                <div className="border border-gray-200 rounded-lg p-3 space-y-2">
                                    <p className="text-xs text-gray-500 font-medium">External Ref # / RMA</p>
                                    <input
                                        type="text"
                                        value={refValue}
                                        onChange={e => setRefValue(e.target.value)}
                                        placeholder="Job #, RMA code…"
                                        className="w-full border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                                        autoFocus
                                    />
                                    <div className="flex gap-2">
                                        <button onClick={() => setShowRefEdit(false)} className="flex-1 text-xs py-1.5 border rounded hover:bg-gray-50">Cancel</button>
                                        <button onClick={saveRef} disabled={savingRef} className="flex-1 text-xs py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                                            {savingRef ? "Saving…" : "Save"}
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    onClick={() => { setRefValue(ticket.externalRef ?? ""); setShowRefEdit(true); }}
                                    className="w-full border border-gray-300 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50 flex items-center justify-center gap-2"
                                >
                                    <Building2 size={15} />
                                    {ticket.externalRef ? `Ref: ${ticket.externalRef}` : "Add External Ref # / RMA"}
                                </button>
                            )
                        )}

                        <Link
                            href={`/receipt/${ticket.id}`}
                            target="_blank"
                            className="w-full border border-gray-300 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50 flex items-center justify-center gap-2"
                        >
                            <Printer size={15} />
                            Print Receipt
                        </Link>
                    </div>

                </div>
            </div>

            {/* Modals */}
            {showStatusUpdate && (
                <StatusUpdateCombined
                    ticket={ticket}
                    onClose={() => {
                        setShowStatusUpdate(false);
                        fetchTicket();
                    }}
                />
            )}

            {showEscalation && (
                <TicketEscalation
                    ticket={ticket}
                    onClose={() => {
                        setShowEscalation(false);
                        fetchTicket();
                    }}
                />
            )}

            {showAddNote && (
                <AddNoteModal
                    ticketId={ticket.id}
                    onClose={() => {
                        setShowAddNote(false);
                        fetchTicket();
                    }}
                />
            )}

            {showWarrantyModal && (
                <WarrantyConvertModal
                    ticketId={ticket.id}
                    isWarranty={ticket.isWarranty}
                    warrantyStatus={ticket.warrantyStatus}
                    warrantyRef={ticket.warrantyRef}
                    purchaseDate={ticket.purchaseDate}
                    onClose={() => {
                        setShowWarrantyModal(false);
                        fetchTicket();
                    }}
                />
            )}

        </div>
    );
}
