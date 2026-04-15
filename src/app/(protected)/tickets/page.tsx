"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Plus, Eye, Search, X } from "lucide-react";
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

const STATUSES = ["RECEIVED", "DIAGNOSING", "REPAIRING", "ESCALATED", "RECEIVED_BACK", "READY", "RETURNED"];
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"];

export default function TicketsPage() {
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [filtered, setFiltered] = useState<Ticket[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [technicians, setTechnicians] = useState<any[]>([]);
    const [serviceCenters, setServiceCenters] = useState<any[]>([]);

    // Filters
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("");
    const [priorityFilter, setPriorityFilter] = useState("");
    const [technicianFilter, setTechnicianFilter] = useState("");
    const [serviceCenterFilter, setServiceCenterFilter] = useState("");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");

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
        axios.get("/api/users").then((r) => setTechnicians(r.data));
        axios.get("/api/service-centers").then((r) => setServiceCenters(r.data));
    }, []);

    // Apply filters
    useEffect(() => {
        let result = [...tickets];

        if (search) {
            const s = search.toLowerCase();
            result = result.filter(
                (t) =>
                    t.device.customer.name.toLowerCase().includes(s) ||
                    t.device.customer.phone.includes(s) ||
                    t.device.brand.toLowerCase().includes(s) ||
                    t.device.model.toLowerCase().includes(s) ||
                    String(t.id).includes(s)
            );
        }

        if (statusFilter) {
            result = result.filter((t) => t.status === statusFilter);
        }

        if (priorityFilter) {
            result = result.filter((t) => t.priority === priorityFilter);
        }

        if (technicianFilter) {
            result = result.filter((t) => t.technician?.name === technicianFilter);
        }

        if (serviceCenterFilter) {
            result = result.filter((t) => t.serviceCenter?.name === serviceCenterFilter);
        }

        if (dateFrom) {
            result = result.filter((t) => new Date(t.createdAt) >= new Date(dateFrom));
        }

        if (dateTo) {
            result = result.filter(
                (t) => new Date(t.createdAt) <= new Date(dateTo + "T23:59:59")
            );
        }

        setFiltered(result);
    }, [tickets, search, statusFilter, priorityFilter, technicianFilter, serviceCenterFilter, dateFrom, dateTo]);

    const clearFilters = () => {
        setSearch("");
        setStatusFilter("");
        setPriorityFilter("");
        setTechnicianFilter("");
        setServiceCenterFilter("");
        setDateFrom("");
        setDateTo("");
    };

    const hasFilters = search || statusFilter || priorityFilter || technicianFilter || serviceCenterFilter || dateFrom || dateTo;

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

            {/* Search & Filters */}
            <div className="bg-white rounded-lg shadow p-4 mb-4 space-y-3">
                {/* Search */}
                <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by customer name, phone, device, ticket #..."
                        className="w-full pl-9 pr-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>

                {/* Filter Row */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                    {/* Status */}
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="">All Status</option>
                        {STATUSES.map((s) => (
                            <option key={s} value={s}>{s.replace("_", " ")}</option>
                        ))}
                    </select>

                    {/* Priority */}
                    <select
                        value={priorityFilter}
                        onChange={(e) => setPriorityFilter(e.target.value)}
                        className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="">All Priority</option>
                        {PRIORITIES.map((p) => (
                            <option key={p} value={p}>{p}</option>
                        ))}
                    </select>

                    {/* Technician */}
                    <select
                        value={technicianFilter}
                        onChange={(e) => setTechnicianFilter(e.target.value)}
                        className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="">All Technicians</option>
                        {technicians.map((t) => (
                            <option key={t.id} value={t.name}>{t.name}</option>
                        ))}
                    </select>

                    {/* Service Center */}
                    <select
                        value={serviceCenterFilter}
                        onChange={(e) => setServiceCenterFilter(e.target.value)}
                        className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="">All Service Centers</option>
                        {serviceCenters.map((s) => (
                            <option key={s.id} value={s.name}>{s.name}</option>
                        ))}
                    </select>

                    {/* Date From */}
                    <input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />

                    {/* Date To */}
                    <input
                        type="date"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>

                {/* Results count + clear */}
                <div className="flex items-center justify-between text-sm text-gray-500">
                    <span>
                        Showing <span className="font-medium text-gray-700">{filtered.length}</span> of{" "}
                        <span className="font-medium text-gray-700">{tickets.length}</span> tickets
                    </span>
                    {hasFilters && (
                        <button
                            onClick={clearFilters}
                            className="flex items-center gap-1 text-red-500 hover:text-red-700"
                        >
                            <X size={14} />
                            Clear filters
                        </button>
                    )}
                </div>
            </div>

            {/* Table */}
            {loading ? (
                <p className="text-gray-500">Loading...</p>
            ) : filtered.length === 0 ? (
                <div className="bg-white rounded-lg shadow p-12 text-center text-gray-400">
                    {hasFilters ? "No tickets match your filters." : "No tickets yet. Create your first one!"}
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
                            {filtered.map((t) => (
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
                                    <td className="px-6 py-4 max-w-[150px] truncate text-gray-600">
                                        {t.device.problem}
                                    </td>
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