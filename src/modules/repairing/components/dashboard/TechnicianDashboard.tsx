"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Wrench, ChevronRight, ArrowRight } from "lucide-react";
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
    device: { brand: string; model: string; customer: { name: string } | null; company: { name: string } | null };
    primaryOwner: { id: number; name: string } | null;
    ticketStatus: { id: string; label: string; color: string };
    ticketSubStatus: { label: string; color: string } | null;
}

interface UnassignedRow {
    id: number;
    createdAt: Date;
    device: { brand: string; model: string; customer: { name: string } | null; company: { name: string } | null };
    ticketStatus: { label: string; color: string; actionLabel: string | null };
}

interface Props {
    name: string;
    userId: number;
    pipeline: PipelineStage[];
    allActiveTickets: TicketRow[];
    unassigned: UnassignedRow[];
    roles: { id: string; label: string; color: string }[];
    contextLabel?: string | null;
}

export default function TechnicianDashboard({ name, userId, pipeline, allActiveTickets, unassigned, roles, contextLabel }: Props) {
    const router = useRouter();
    const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
    const [selectedTeam, setSelectedTeam] = useState<string | null>("R2");
    const [claiming, setClaiming] = useState<number | null>(null);

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

    async function handleClaim(ticketId: number) {
        setClaiming(ticketId);
        try {
            await fetch(`/api/tickets/${ticketId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ primaryOwnerId: userId }),
            });
            router.refresh();
        } finally {
            setClaiming(null);
        }
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold mb-1">My Workbench</h1>
                <p className="text-muted-foreground text-sm">
                    Welcome back, {name}{contextLabel ? ` · ${contextLabel}` : ""}
                </p>
            </div>

            {/* Pipeline strip */}
            <div className="border-2 border-border shadow bg-card p-4">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Ticket Pipeline</h2>
                <div className="flex gap-2 overflow-x-auto pb-1">
                    {pipeline.map((stage, i) => (
                        <div key={stage.id} className="flex items-center gap-2 shrink-0">
                            <button
                                onClick={() => setSelectedStageId(prev => prev === stage.id ? null : stage.id)}
                                className={`flex flex-col items-center px-4 py-3 border-2 transition-all min-w-[90px]
                                    ${stage._count.tickets === 0 ? "opacity-40" : ""}
                                    ${selectedStageId === stage.id
                                        ? "border-primary bg-primary/10"
                                        : "border-border hover:bg-muted"}`}
                            >
                                <span className={`text-2xl font-bold ${stage._count.tickets > 0 ? "text-foreground" : "text-muted-foreground"}`}>
                                    {stage._count.tickets}
                                </span>
                                <span className="text-xs text-muted-foreground mt-0.5 text-center leading-tight">{stage.label}</span>
                            </button>
                            {i < pipeline.length - 1 && (
                                <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Team tabs + ticket list */}
            <div className="border-2 border-border shadow overflow-hidden">
                <div className="px-6 py-4 border-b-2 border-border bg-muted flex items-center gap-4 flex-wrap">
                    <div className="flex gap-1">
                        {TEAM_TABS.map(tab => (
                            <button
                                key={String(tab.key)}
                                onClick={() => setSelectedTeam(tab.key)}
                                className={`text-xs px-3 py-1.5 border font-medium transition-colors
                                    ${selectedTeam === tab.key
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "border-border bg-card text-muted-foreground hover:bg-muted"}`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                    <span className="text-xs text-muted-foreground">
                        {filtered.length}{(selectedStageId || selectedTeam) ? ` of ${allActiveTickets.length}` : ""} tickets
                    </span>
                    {selectedStageId && (
                        <button
                            onClick={() => setSelectedStageId(null)}
                            className="ml-auto text-xs text-muted-foreground hover:text-foreground"
                        >
                            Clear stage filter
                        </button>
                    )}
                </div>
                {filtered.length === 0 ? (
                    <p className="px-6 py-8 text-sm text-muted-foreground text-center">No tickets match this filter.</p>
                ) : (
                    <div className="divide-y divide-border">
                        {filtered.map(t => (
                            <div key={t.id} className={`flex items-center gap-4 px-6 py-3.5 hover:bg-muted/40 ${t.escalated ? "bg-secondary/20" : ""}`}>
                                <Link href={`/tickets/${t.id}`} className="text-primary font-semibold text-sm w-10 shrink-0">#{t.id}</Link>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-foreground truncate">
                                        {(t.device.customer ?? t.device.company)?.name} — {t.device.brand} {t.device.model}
                                    </p>
                                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                        <span className={`text-xs px-2 py-0.5 font-medium ${t.ticketStatus.color}`}>
                                            {t.ticketStatus.label}
                                        </span>
                                        {t.ticketSubStatus && (
                                            <span className={`text-xs px-2 py-0.5 font-medium ${t.ticketSubStatus.color}`}>
                                                {t.ticketSubStatus.label}
                                            </span>
                                        )}
                                        {t.pendingTeam.map(role => (
                                            <span key={role} className={`text-xs px-2 py-0.5 font-medium ${TEAM_BADGE[role] ?? "bg-muted text-muted-foreground"}`}>
                                                {TEAM_LABEL[role] ?? role}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                                <span className="text-xs text-muted-foreground shrink-0">{t.primaryOwner?.name ?? "Unassigned"}</span>
                                <span className="text-xs text-muted-foreground shrink-0">{timeAgo(t.updatedAt)}</span>
                                <Link href={`/tickets/${t.id}`} className="text-muted-foreground hover:text-primary">
                                    <ArrowRight size={16} />
                                </Link>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Action queue — unassigned tickets needing a technician */}
            {unassigned.length > 0 && (
                <div className="border-2 border-border shadow overflow-hidden">
                    <div className="px-6 py-4 border-b-2 border-border bg-primary/10 flex items-center gap-2">
                        <Wrench size={16} className="text-primary" />
                        <div>
                            <h2 className="font-semibold text-primary">Action Required — Needs Attention</h2>
                            <p className="text-xs text-primary/80 mt-0.5">Unassigned tickets in technician-action statuses</p>
                        </div>
                        <span className="ml-auto border border-primary/30 bg-primary/10 text-primary text-xs font-bold px-2 py-0.5">
                            {unassigned.length} tickets
                        </span>
                    </div>
                    <div className="divide-y divide-border">
                        {unassigned.map(t => (
                            <div key={t.id} className="flex items-center gap-4 px-6 py-3.5 hover:bg-primary/5">
                                <Link href={`/tickets/${t.id}`} className="text-primary font-semibold text-sm w-10 shrink-0">#{t.id}</Link>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-foreground truncate">
                                        {(t.device.customer ?? t.device.company)?.name} — {t.device.brand} {t.device.model}
                                    </p>
                                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                        <span className={`text-xs px-2 py-0.5 font-medium ${t.ticketStatus.color}`}>
                                            {t.ticketStatus.label}
                                        </span>
                                        {t.ticketStatus.actionLabel && (
                                            <span className="text-xs text-primary font-medium">
                                                → {t.ticketStatus.actionLabel}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <span className="text-xs text-muted-foreground shrink-0">{timeAgo(t.createdAt)}</span>
                                <button
                                    onClick={() => handleClaim(t.id)}
                                    disabled={claiming === t.id}
                                    className="shrink-0 border-2 border-primary bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                                >
                                    {claiming === t.id ? "Claiming…" : "Claim"}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
