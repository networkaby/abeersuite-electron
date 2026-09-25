"use client";

import { Badge } from "@/components/ui/badge";
import { MessageSquare } from "lucide-react";
import UserAvatar from "@/shared/components/UserAvatar";
import { PRIORITY_META } from "@/shared/lib/constants/badges";
import { INQUIRY_LABEL, OUTCOME_LABEL, helpCustomerName, helpTitle, type HelpDto, type HelpPriority } from "../lib/types";

/** Left-edge accent per priority — quick visual scan down a column. */
const PRIORITY_ACCENT: Record<HelpPriority, string> = {
    LOW: "border-l-gray-300",
    MEDIUM: "border-l-blue-400",
    HIGH: "border-l-orange-400",
    URGENT: "border-l-red-500",
};

export default function HelpCard({
    ticket,
    draggable,
    onDragStart,
    onClick,
}: {
    ticket: HelpDto;
    draggable: boolean;
    onDragStart?: (e: React.DragEvent) => void;
    onClick: () => void;
}) {
    const priority = PRIORITY_META[ticket.priority] ?? PRIORITY_META.MEDIUM;
    const accent = PRIORITY_ACCENT[ticket.priority] ?? PRIORITY_ACCENT.MEDIUM;

    const holders = ticket.assignedPosition?.holders.map((h) => h.user) ?? [];
    const holder = holders[0] ?? null;
    const holderLabel =
        holders.length === 0 ? "Vacant" : holders.length === 1 ? holder!.name : `${holder!.name} +${holders.length - 1}`;

    // Quick counter tickets have no subject — fall back to the customer name as the
    // headline, with the notes as the sub-line.
    const name = helpCustomerName(ticket);
    const title = helpTitle(ticket);
    const subtitle = ticket.subject?.trim()
        ? [name, ticket.phone].filter(Boolean).join(" · ")
        : [ticket.notes?.trim(), ticket.phone].filter(Boolean).join(" · ") || (ticket.phone ?? "");

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
                <span className="text-sm font-medium leading-snug">{title}</span>
                <Badge className={`shrink-0 ${priority.color}`}>{priority.label}</Badge>
            </div>

            {subtitle && <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>}

            <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {ticket.inquiryType && (
                    <Badge variant="secondary" className="text-[10px]">{INQUIRY_LABEL[ticket.inquiryType]}</Badge>
                )}
                {ticket.outcome && (
                    <Badge variant="outline" className="text-[10px]">{OUTCOME_LABEL[ticket.outcome]}</Badge>
                )}
            </div>

            <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <div className="flex min-w-0 items-center gap-2">
                    {ticket.assignedPosition ? (
                        <span className="flex min-w-0 items-center gap-1.5">
                            {holder && (
                                <UserAvatar name={holder.name} avatarUrl={holder.avatarUrl} role={holder.role} sizePx={20} />
                            )}
                            <span className="flex min-w-0 flex-col leading-tight">
                                <span className="max-w-[110px] truncate font-medium text-foreground/80">
                                    {ticket.assignedPosition.title}
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
                {ticket._count.logs > 0 && (
                    <span className="flex shrink-0 items-center gap-1">
                        <MessageSquare className="size-3" />
                        {ticket._count.logs}
                    </span>
                )}
            </div>
        </button>
    );
}
