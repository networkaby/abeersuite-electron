"use client";

import { Badge } from "@/components/ui/badge";
import { MessageSquare, CalendarClock } from "lucide-react";
import UserAvatar from "@/shared/components/UserAvatar";
import { PRIORITY_META } from "@/utils/constants";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { formatDate } from "@/shared/lib/format";
import { useNow } from "@/shared/hooks";
import type { LeadDto, LeadPriority } from "../lib/types";

/** Left-edge accent per priority — quick visual scan down a column. */
const PRIORITY_ACCENT: Record<LeadPriority, string> = {
    LOW: "border-l-gray-300",
    MEDIUM: "border-l-blue-400",
    HIGH: "border-l-orange-400",
    URGENT: "border-l-red-500",
};

export default function LeadCard({
    lead,
    draggable,
    onDragStart,
    onClick,
}: {
    lead: LeadDto;
    draggable: boolean;
    onDragStart?: (e: React.DragEvent) => void;
    onClick: () => void;
}) {
    const priority = PRIORITY_META[lead.priority] ?? PRIORITY_META.MEDIUM;
    const accent = PRIORITY_ACCENT[lead.priority] ?? PRIORITY_ACCENT.MEDIUM;

    const holders = lead.assignedPosition?.holders.map((h) => h.user) ?? [];
    const holder = holders[0] ?? null;
    const holderLabel =
        holders.length === 0 ? "Vacant" : holders.length === 1 ? holder!.name : `${holder!.name} +${holders.length - 1}`;

    const subtitle = [lead.contactName, lead.companyName].filter(Boolean).join(" · ");
    // "now" read in an effect (useNow) — calling Date.now() during render trips react-hooks/purity.
    const now = useNow();
    const overdue =
        lead.nextFollowUpAt && !lead.closedAt && new Date(lead.nextFollowUpAt).getTime() < now;

    return (
        <button
            type="button"
            draggable={draggable}
            onDragStart={onDragStart}
            onClick={onClick}
            className={`w-full cursor-pointer rounded-lg border border-l-4 bg-card p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-ring ${accent} ${
                draggable ? "active:cursor-grabbing" : ""
            }`}
        >
            <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium leading-snug">{lead.title}</span>
                <Badge className={`shrink-0 ${priority.color}`}>{priority.label}</Badge>
            </div>

            {subtitle && <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>}

            {lead.valuePaise != null && (
                <p className="mt-1.5 text-sm font-semibold tabular-nums text-foreground">
                    {formatRupeesFromPaise(lead.valuePaise)}
                </p>
            )}

            <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <div className="flex min-w-0 items-center gap-2">
                    {lead.assignedPosition ? (
                        <span className="flex min-w-0 items-center gap-1.5">
                            {holder && (
                                <UserAvatar name={holder.name} avatarUrl={holder.avatarUrl} role={holder.role} sizePx={20} />
                            )}
                            <span className="flex min-w-0 flex-col leading-tight">
                                <span className="max-w-[110px] truncate font-medium text-foreground/80">
                                    {lead.assignedPosition.title}
                                </span>
                                <span className={`max-w-[110px] truncate text-[10px] ${holders.length === 0 ? "italic" : ""}`}>
                                    {holderLabel}
                                </span>
                            </span>
                        </span>
                    ) : (
                        <span className="italic">Unassigned</span>
                    )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                    {lead._count.activities > 0 && (
                        <span className="flex items-center gap-1">
                            <MessageSquare className="size-3" />
                            {lead._count.activities}
                        </span>
                    )}
                    {lead.nextFollowUpAt && (
                        <span className={`flex items-center gap-1 ${overdue ? "text-red-600" : ""}`}>
                            <CalendarClock className="size-3" />
                            {formatDate(lead.nextFollowUpAt)}
                        </span>
                    )}
                </div>
            </div>
        </button>
    );
}
