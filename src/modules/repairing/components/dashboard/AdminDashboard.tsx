"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, ChevronRight } from "lucide-react";
import { timeAgo } from "@/lib/time-ago";
import { Button } from "@/components/ui/button";

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
    device: { brand: string; model: string; customer: { name: string } | null; company: { name: string } | null };
    primaryOwner: { id: number; name: string } | null;
    ticketStatus: { id: string; label: string; color: string };
    ticketSubStatus: { label: string; color: string } | null;
}

interface Props {
    name: string;
    pipeline: PipelineStage[];
    allActiveTickets: TicketRow[];
    counts: { total: number; open: number; escalated: number; ready: number; actionItems: number };
    roles: { id: string; label: string; color: string }[];
    contextLabel?: string | null;
    ticketsHref?: string;
}

export default function AdminDashboard({ name, pipeline, allActiveTickets, counts, roles, contextLabel, ticketsHref = "/tickets" }: Props) {
    const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
    const [selectedTeam, setSelectedTeam] = useState<string | null>(null);

    const TEAM_TABS = [
        { key: null, label: "All Teams" },
        ...roles.filter(r => r.id !== "R1").map(r => ({ key: r.id, label: r.label })),
    ];

    const TEAM_BADGE = Object.fromEntries(roles.map(r => [r.id, r.color]));
    const TEAM_LABEL = Object.fromEntries(roles.map(r => [r.id, r.label]));

    const filtered = allActiveTickets.filter(t => {
        if (selectedStageId && t.ticketStatus.id !== selectedStageId) return false;
        if (selectedTeam && !t.pendingTeam.includes(selectedTeam)) return false;
        return true;
    });

    const hasFilter = selectedStageId !== null || selectedTeam !== null;

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold mb-1">Dashboard</h1>
                <p className="text-muted-foreground text-sm">
                    Welcome back, {name}{contextLabel ? ` · ${contextLabel}` : ""}
                </p>
            </div>

            {/* Summary bar */}
            <div className="flex flex-wrap gap-3">
                {[
                    { label: "Total", value: counts.total, color: "text-foreground" },
                    { label: "Open", value: counts.open, color: "text-primary" },
                    { label: "Escalated", value: counts.escalated, color: "text-foreground" },
                    { label: "Ready for Pickup", value: counts.ready, color: "text-primary" },
                ].map(stat => (
                    <div key={stat.label} className="flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 shadow">
                        <span className="text-xs text-muted-foreground">{stat.label}</span>
                        <span className={`text-xl font-bold ${stat.color}`}>{stat.value}</span>
                    </div>
                ))}
                {counts.actionItems > 0 && (
                    <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-4 py-2.5">
                        <AlertCircle size={14} className="text-foreground" />
                        <span className="text-xs text-foreground font-medium">{counts.actionItems} pending actions</span>
                    </div>
                )}
            </div>

            {/* Pipeline strip */}
            <div className="rounded-lg border border-border bg-card p-4 shadow">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Ticket Pipeline</h2>
                <div className="flex gap-2 overflow-x-auto pb-1">
                    {pipeline.map((stage, i) => (
                        <div key={stage.id} className="flex items-center gap-2 shrink-0">
                            <Button
                                onClick={() => setSelectedStageId(prev => prev === stage.id ? null : stage.id)}
                                variant="outline"
                                className={`flex h-auto min-w-[90px] flex-col items-center px-4 py-3 transition-all
                                    ${stage._count.tickets === 0 ? "opacity-40" : ""}
                                    ${selectedStageId === stage.id
                                        ? "border-primary bg-primary/10"
                                        : "border-border hover:bg-muted"}`}
                            >
                                <span className={`text-2xl font-bold ${stage._count.tickets > 0 ? "text-foreground" : "text-muted-foreground"}`}>
                                    {stage._count.tickets}
                                </span>
                                <span className="text-xs text-muted-foreground mt-0.5 text-center leading-tight">{stage.label}</span>
                            </Button>
                            {i < pipeline.length - 1 && (
                                <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Team tabs + ticket table */}
            <div className="overflow-hidden rounded-lg border border-border shadow">
                <div className="flex items-center gap-4 border-b border-border bg-muted px-6 py-4">
                    <div className="flex gap-1">
                        {TEAM_TABS.map(tab => (
                            <Button
                                key={String(tab.key)}
                                onClick={() => setSelectedTeam(tab.key)}
                                variant="outline"
                                size="xs"
                                className={`h-auto px-3 py-1.5 text-xs font-medium transition-colors
                                    ${selectedTeam === tab.key
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "border-border bg-card text-muted-foreground hover:bg-muted"}`}
                            >
                                {tab.label}
                            </Button>
                        ))}
                    </div>
                    <span className="text-xs text-muted-foreground">
                        {filtered.length}{hasFilter ? ` of ${allActiveTickets.length}` : ""} tickets
                    </span>
                    {hasFilter ? (
                        <Button
                            onClick={() => { setSelectedStageId(null); setSelectedTeam(null); }}
                            variant="ghost"
                            size="xs"
                            className="ml-auto h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
                        >
                            Clear filters
                        </Button>
                    ) : (
                        <Link href={ticketsHref} className="ml-auto text-xs text-primary hover:underline">View all →</Link>
                    )}
                </div>
                {filtered.length === 0 ? (
                    <p className="px-6 py-8 text-sm text-muted-foreground text-center">No tickets match this filter.</p>
                ) : (
                    <table className="w-full text-sm">
                        <thead className="bg-muted text-muted-foreground text-xs uppercase">
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
                        <tbody className="divide-y divide-border">
                            {filtered.map(t => (
                                <tr key={t.id} className={`hover:bg-muted/40 ${t.escalated ? "bg-secondary/20" : ""}`}>
                                    <td className="px-5 py-3">
                                        <Link href={`/tickets/${t.id}`} className="text-primary font-medium hover:underline">#{t.id}</Link>
                                    </td>
                                    <td className="px-5 py-3 font-medium">{(t.device.customer ?? t.device.company)?.name}</td>
                                    <td className="px-5 py-3 text-muted-foreground">{t.device.brand} {t.device.model}</td>
                                    <td className="px-5 py-3">
                                        <div className="flex flex-col gap-0.5">
                                            <span className={`inline-block px-2 py-0.5 text-xs font-medium w-fit ${t.ticketStatus.color}`}>
                                                {t.ticketStatus.label}
                                            </span>
                                            {t.ticketSubStatus && (
                                                <span className={`inline-block px-2 py-0.5 text-xs font-medium w-fit ${t.ticketSubStatus.color}`}>
                                                    {t.ticketSubStatus.label}
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-5 py-3">
                                        <div className="flex flex-wrap gap-1">
                                            {t.pendingTeam.map(role => (
                                                <span key={role} className={`text-xs px-2 py-0.5 font-medium ${TEAM_BADGE[role] ?? "bg-muted text-muted-foreground"}`}>
                                                    {TEAM_LABEL[role] ?? role}
                                                </span>
                                            ))}
                                            {t.pendingTeam.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                                        </div>
                                    </td>
                                    <td className="px-5 py-3 text-muted-foreground">{t.primaryOwner?.name ?? "—"}</td>
                                    <td className="px-5 py-3 text-muted-foreground text-xs">{timeAgo(t.updatedAt)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
