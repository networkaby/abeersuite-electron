"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import {
    ArrowLeft,
    Clock,
    User,
    Wrench,
    Building2,
    AlertTriangle,
    Printer,
} from "lucide-react";
import Link from "next/link";
import TicketStatusUpdate from "@/components/TicketStatusUpdate";
import TicketEscalation from "@/components/TicketEscalation";




interface Ticket {
    id: number;
    status: string;
    priority: string;
    notes?: string;
    accessInfo?: string;
    estimatedCost?: number;
    escalated: boolean;
    escalatedAt?: string;
    expectedReturn?: string;
    receivedBackAt?: string;
    externalRef?: string;
    createdAt: string;
    updatedAt: string;
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
        note?: string;
        createdAt: string;
        changedBy: { name: string };
    }[];
}

const statusColors: Record<string, string> = {
    RECEIVED: "bg-gray-100 text-gray-600",
    DIAGNOSING: "bg-blue-100 text-blue-600",
    REPAIRING: "bg-yellow-100 text-yellow-600",
    ESCALATED: "bg-orange-100 text-orange-600",
    RECEIVED_BACK: "bg-purple-100 text-purple-600",
    READY: "bg-green-100 text-green-600",
    RETURNED: "bg-gray-100 text-gray-400",
};

const priorityColors: Record<string, string> = {
    LOW: "bg-gray-100 text-gray-500",
    NORMAL: "bg-blue-50 text-blue-500",
    HIGH: "bg-orange-100 text-orange-500",
    URGENT: "bg-red-100 text-red-600",
};

export default function TicketDetailPage() {
    const { id } = useParams();
    const router = useRouter();
    const { data: session } = useSession();
    const [ticket, setTicket] = useState<Ticket | null>(null);
    const [loading, setLoading] = useState(true);
    const [showStatusUpdate, setShowStatusUpdate] = useState(false);
    const [showEscalation, setShowEscalation] = useState(false);

    const fetchTicket = async () => {
        try {
            const res = await axios.get(`/api/tickets/${id}`);
            setTicket(res.data);
        } catch {
            toast.error("Failed to load ticket");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTicket();
    }, [id]);

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
                        Created {new Date(ticket.createdAt).toLocaleString()}
                    </p>
                </div>
                <div className="flex gap-2">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${priorityColors[ticket.priority]}`}>
                        {ticket.priority}
                    </span>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusColors[ticket.status]}`}>
                        {ticket.status.replace("_", " ")}
                    </span>
                </div>
            </div>

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
                                    <p className="font-medium text-green-600">৳ {ticket.estimatedCost}</p>
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
                                    <p>{ticket.escalatedAt ? new Date(ticket.escalatedAt).toLocaleDateString() : "—"}</p>
                                </div>
                                <div>
                                    <p className="text-gray-400 text-xs uppercase mb-1">Expected Return</p>
                                    <p>{ticket.expectedReturn ? new Date(ticket.expectedReturn).toLocaleDateString() : "—"}</p>
                                </div>
                                {ticket.receivedBackAt && (
                                    <div>
                                        <p className="text-gray-400 text-xs uppercase mb-1">Received Back</p>
                                        <p>{new Date(ticket.receivedBackAt).toLocaleDateString()}</p>
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
                        {ticket.logs.length === 0 ? (
                            <p className="text-gray-400 text-sm">No history yet.</p>
                        ) : (
                            <div className="space-y-4">
                                {ticket.logs.map((log) => (
                                    <div key={log.id} className="flex gap-3">
                                        <div className="w-2 h-2 rounded-full bg-blue-400 mt-2 shrink-0" />
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[log.status]}`}>
                                                    {log.status.replace("_", " ")}
                                                </span>
                                                <span className="text-xs text-gray-400">
                                                    by {log.changedBy.name}
                                                </span>
                                                <span className="text-xs text-gray-400">
                                                    {new Date(log.createdAt).toLocaleString()}
                                                </span>
                                            </div>
                                            {log.note && (
                                                <p className="text-sm text-gray-500 mt-1">{log.note}</p>
                                            )}
                                        </div>
                                    </div>
                                ))}
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
                    {ticket.status !== "RETURNED" && (
                        <div className="bg-white rounded-xl shadow p-4 space-y-2">
                            <h2 className="font-semibold text-gray-700 mb-3 text-sm">Actions</h2>

                            <button
                                onClick={() => setShowStatusUpdate(true)}
                                className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700"
                            >
                                Update Status
                            </button>

                            {!ticket.escalated && (
                                <button
                                    onClick={() => setShowEscalation(true)}
                                    className="w-full border border-orange-400 text-orange-500 rounded-lg py-2 text-sm hover:bg-orange-50 flex items-center justify-center gap-2"
                                >
                                    <AlertTriangle size={15} />
                                    Escalate to Service Center
                                </button>
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
                    )}

                    {/* Always show print even if RETURNED */}
                    {ticket.status === "RETURNED" && (
                        <div className="bg-white rounded-xl shadow p-4">
                            <Link
                                href={`/receipt/${ticket.id}`}
                                target="_blank"
                                className="w-full border border-gray-300 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50 flex items-center justify-center gap-2"
                            >
                                <Printer size={15} />
                                Print Receipt
                            </Link>
                        </div>
                    )}
                </div>
            </div>

            {/* Modals */}
            {showStatusUpdate && (
                <TicketStatusUpdate
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
        </div>
    );
}