"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, ChevronRight } from "lucide-react";
import { timeAgo } from "@/lib/time-ago";

interface PipelineStage {
    id: string;
    label: string;
    color: string;
    _count: { tickets: number };
}

interface TicketRow {
    id: number;
    status: string;
    escalated: boolean;
    updatedAt: Date;
    pendingTeam: string[];
    device: { brand: string; model: string; customer: { name: string } };
    technician: { id: number; name: string } | null;
    ticketStatus: { id: string; label: string; color: string };
    ticketSubStatus: { label: string; color: string } | null;
}

interface Props {
    name: string;
    pipeline: PipelineStage[];
    allActiveTickets: TicketRow[];
    counts: { total: number; open: number; escalated: number; ready: number; actionItems: number };
}

const TEAM_TABS = [
    { key: null, label: "All Teams" },
    { key: "R2", label: "Technician" },
    { key: "R3", label: "Front Desk" },
    { key: "R4", label: "Despatch" },
] as const;

const TEAM_BADGE: Record<string, string> = {
    R2: "bg-blue-100 text-blue-700",
    R3: "bg-green-100 text-green-700",
    R4: "bg-orange-100 text-orange-700",
};

const TEAM_LABEL: Record<string, string> = {
    R2: "Technician",
    R3: "Front Desk",
    R4: "Despatch",
};

export default function AdminDashboard({ name, pipeline, allActiveTickets, counts }: Props) {
    const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
    const [selectedTeam, setSelectedTeam] = useState<string | null>(null);

    const filtered = allActiveTickets.filter(t => {
        if (selectedStageId && t.ticketStatus.id !== selectedStageId) return false;
        if (selectedTeam && !t.pendingTeam.includes(selectedTeam)) return false;
        return true;
    });

    const hasFilter = selectedStageId !== null || selectedTeam !== null;

    return (
        <div>
            <h1 className="text-2xl font-bold mb-1">Dashboard</h1>
            <p className="text-gray-400 text-sm mb-6">Welcome back, {name}</p>

            {/* Summary bar */}
            <div className="flex flex-wrap gap-3 mb-6">
                {[
                    { label: "Total", value: counts.total, color: "text-gray-700" },
                    { label: "Open", value: counts.open, color: "text-blue-600" },
                    { label: "Escalated", value: counts.escalated, color: "text-orange-600" },
                    { label: "Ready for Pickup", value: counts.ready, color: "text-green-600" },
                ].map(stat => (
                    <div key={stat.label} className="bg-white rounded-lg shadow px-4 py-2.5 flex items-center gap-2">
                        <span className="text-xs text-gray-500">{stat.label}</span>
                        <span className={`text-xl font-bold ${stat.color}`}>{stat.value}</span>
                    </div>
                ))}
                {counts.actionItems > 0 && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2.5 flex items-center gap-2">
                        <AlertCircle size={14} className="text-yellow-600" />
                        <span className="text-xs text-yellow-800 font-medium">{counts.actionItems} pending actions</span>
                    </div>
                )}
            </div>

            {/* Pipeline strip */}
            <div className="bg-white rounded-xl shadow p-4 mb-6">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Ticket Pipeline</h2>
                <div className="flex gap-2 overflow-x-auto pb-1">
                    {pipeline.map((stage, i) => (
                        <div key={stage.id} className="flex items-center gap-2 shrink-0">
                            <button
                                onClick={() => setSelectedStageId(prev => prev === stage.id ? null : stage.id)}
                                className={`flex flex-col items-center px-4 py-3 rounded-lg border transition-all min-w-[90px]
                                    ${stage._count.tickets === 0 ? "opacity-40" : ""}
                                    ${selectedStageId === stage.id
                                        ? "border-blue-400 bg-blue-50 ring-1 ring-blue-400"
                                        : "border-gray-200 hover:border-gray-300 hover:shadow-sm"}`}
                            >
                                <span className={`text-2xl font-bold ${stage._count.tickets > 0 ? "text-gray-800" : "text-gray-400"}`}>
                                    {stage._count.tickets}
                                </span>
                                <span className="text-xs text-gray-500 mt-0.5 text-center leading-tight">{stage.label}</span>
                            </button>
                            {i < pipeline.length - 1 && (
                                <ChevronRight size={14} className="text-gray-300 shrink-0" />
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Team tabs + ticket table */}
            <div className="bg-white rounded-xl shadow overflow-hidden">
                <div className="px-6 py-4 border-b flex items-center gap-4 flex-wrap">
                    <div className="flex gap-1">
                        {TEAM_TABS.map(tab => (
                            <button
                                key={String(tab.key)}
                                onClick={() => setSelectedTeam(tab.key)}
                                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors
                                    ${selectedTeam === tab.key
                                        ? "bg-blue-600 text-white"
                                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                    <span className="text-xs text-gray-400">
                        {filtered.length}{hasFilter ? ` of ${allActiveTickets.length}` : ""} tickets
                    </span>
                    {hasFilter ? (
                        <button
                            onClick={() => { setSelectedStageId(null); setSelectedTeam(null); }}
                            className="ml-auto text-xs text-gray-400 hover:text-gray-600"
                        >
                            Clear filters
                        </button>
                    ) : (
                        <Link href="/tickets" className="ml-auto text-xs text-blue-600 hover:underline">View all →</Link>
                    )}
                </div>
                {filtered.length === 0 ? (
                    <p className="px-6 py-8 text-sm text-gray-400 text-center">No tickets match this filter.</p>
                ) : (
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                            <tr>
                                <th className="px-5 py-3 text-left">#</th>
                                <th className="px-5 py-3 text-left">Customer</th>
                                <th className="px-5 py-3 text-left">Device</th>
                                <th className="px-5 py-3 text-left">Status</th>
                                <th className="px-5 py-3 text-left">Pending Team</th>
                                <th className="px-5 py-3 text-left">Technician</th>
                                <th className="px-5 py-3 text-left">Updated</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filtered.map(t => (
                                <tr key={t.id} className={`hover:bg-gray-50 ${t.escalated ? "bg-orange-50/30" : ""}`}>
                                    <td className="px-5 py-3">
                                        <Link href={`/tickets/${t.id}`} className="text-blue-600 font-medium hover:underline">#{t.id}</Link>
                                    </td>
                                    <td className="px-5 py-3 font-medium">{t.device.customer.name}</td>
                                    <td className="px-5 py-3 text-gray-500">{t.device.brand} {t.device.model}</td>
                                    <td className="px-5 py-3">
                                        <div className="flex flex-col gap-0.5">
                                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium w-fit ${t.ticketStatus.color}`}>
                                                {t.ticketStatus.label}
                                            </span>
                                            {t.ticketSubStatus && (
                                                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium w-fit ${t.ticketSubStatus.color}`}>
                                                    {t.ticketSubStatus.label}
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-5 py-3">
                                        <div className="flex flex-wrap gap-1">
                                            {t.pendingTeam.map(role => (
                                                <span key={role} className={`text-xs px-2 py-0.5 rounded-full font-medium ${TEAM_BADGE[role] ?? "bg-gray-100 text-gray-600"}`}>
                                                    {TEAM_LABEL[role] ?? role}
                                                </span>
                                            ))}
                                            {t.pendingTeam.length === 0 && <span className="text-xs text-gray-400">—</span>}
                                        </div>
                                    </td>
                                    <td className="px-5 py-3 text-gray-500">{t.technician?.name ?? "—"}</td>
                                    <td className="px-5 py-3 text-gray-400 text-xs">{timeAgo(t.updatedAt)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
