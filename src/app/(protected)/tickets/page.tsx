"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Plus, Eye } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import TicketForm from "@/components/TicketForm";

interface Ticket {
    id: number;
    status: string;
    priority: string;
    escalated: boolean;
    createdAt: string;
    device: {
        type: string;
        brand: string;
        model: string;
        problem: string;
        customer: { name: string; phone: string };
    };
    technician?: { name: string };
    serviceCenter?: { name: string };
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

export default function TicketsPage() {
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);

    const fetchTickets = async () => {
        try {
            const res = await axios.get("/api/tickets");
            setTickets(res.data);
        } catch {
            toast.error("Failed to load tickets");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTickets();
    }, []);

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-3xl font-bold">Tickets</h1>
                <button
                    onClick={() => setShowForm(true)}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                >
                    <Plus size={18} />
                    New Ticket
                </button>
            </div>

            {showForm && (
                <TicketForm
                    onClose={() => {
                        setShowForm(false);
                        fetchTickets();
                    }}
                />
            )}

            {loading ? (
                <p className="text-gray-500">Loading...</p>
            ) : tickets.length === 0 ? (
                <div className="bg-white rounded-lg shadow p-12 text-center text-gray-400">
                    No tickets yet. Create your first one!
                </div>
            ) : (
                <div className="bg-white rounded-lg shadow overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                            <tr>
                                <th className="px-6 py-3 text-left">#</th>
                                <th className="px-6 py-3 text-left">Customer</th>
                                <th className="px-6 py-3 text-left">Device</th>
                                <th className="px-6 py-3 text-left">Problem</th>
                                <th className="px-6 py-3 text-left">Priority</th>
                                <th className="px-6 py-3 text-left">Status</th>
                                <th className="px-6 py-3 text-left">Technician</th>
                                <th className="px-6 py-3 text-left">Date</th>
                                <th className="px-6 py-3 text-left">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {tickets.map((t) => (
                                <tr key={t.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 text-gray-400">{t.id}</td>
                                    <td className="px-6 py-4">
                                        <p className="font-medium">{t.device.customer.name}</p>
                                        <p className="text-gray-400 text-xs">{t.device.customer.phone}</p>
                                    </td>
                                    <td className="px-6 py-4">
                                        <p>{t.device.brand} {t.device.model}</p>
                                        <p className="text-gray-400 text-xs">{t.device.type}</p>
                                    </td>
                                    <td className="px-6 py-4 max-w-[150px] truncate text-gray-600">{t.device.problem}</td>
                                    <td className="px-6 py-4">
                                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${priorityColors[t.priority]}`}>
                                            {t.priority}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[t.status]}`}>
                                            {t.status.replace("_", " ")}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-gray-500">
                                        {t.technician?.name || "—"}
                                    </td>
                                    <td className="px-6 py-4 text-gray-400">
                                        {new Date(t.createdAt).toLocaleDateString()}
                                    </td>
                                    <td className="px-6 py-4">
                                        <Link
                                            href={`/tickets/${t.id}`}
                                            className="p-1.5 rounded hover:bg-blue-50 text-blue-600 inline-flex"
                                        >
                                            <Eye size={15} />
                                        </Link>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}