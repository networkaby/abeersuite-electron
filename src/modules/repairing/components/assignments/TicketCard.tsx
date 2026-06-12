"use client";

import { useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { badgeColor } from "@/shared/lib/format/entityColor";
import { useRouter } from "next/navigation";
import { Phone, Package, CheckCircle, AlertCircle, UserCheck, Users } from "lucide-react";
import { timeAgo } from "@/shared/lib/format/timeAgo";
import { Button } from "@/components/ui/button";
import PassRejectModal from "./PassRejectModal";

export interface TicketCardData {
    id: number;
    escalated: boolean;
    updatedAt: Date | string;
    device: { brand: string; model: string; customer: { name: string; phone?: string | null } | null; company: { name: string; phone?: string | null } | null };
    primaryOwner: { id: number; name: string } | null;
    serviceCenter: { name: string } | null;
    ticketStatus: { label: string; color: string; actionLabel: string | null };
    ticketWorker: { id: string; label: string; color: string; actionLabel: string | null } | null;
    /** Work the current worker belongs to (null when no worker). */
    workerWorkId?: string | null;
    /** The Work's display label + colour, for the card badge. */
    workerWork?: { label: string; color: string } | null;
    activeParticipants?: { user: { id: number; name: string } }[];
}

interface Props {
    ticket: TicketCardData;
    type: "primary" | "secondary" | "unassigned" | "call" | "despatch" | "status";
    currentUserId: number;
    isPrimaryOwner: boolean;
    isUnassigned: boolean;
}

const TYPE_ICON = {
    primary: <CheckCircle size={16} className="text-green-400" />,
    secondary: <Users size={16} className="text-purple-400" />,
    unassigned: <UserCheck size={16} className="text-blue-400" />,
    call: <Phone size={16} className="text-red-400" />,
    despatch: <Package size={16} className="text-orange-400" />,
    status: <CheckCircle size={16} className="text-green-400" />,
};

const TYPE_HOVER = {
    primary: "hover:bg-green-50/30",
    secondary: "hover:bg-purple-50/30",
    unassigned: "hover:bg-blue-50/30",
    call: "hover:bg-red-50/30",
    despatch: "hover:bg-orange-50/30",
    status: "hover:bg-green-50/30",
};

export default function TicketCard({ ticket, type, currentUserId, isPrimaryOwner, isUnassigned }: Props) {
    const router = useRouter();
    const [claiming, setClaiming] = useState(false);
    const [modal, setModal] = useState<"pass" | "reject" | null>(null);

    const handleClaim = async () => {
        setClaiming(true);
        try {
            await axios.post(`/api/tickets/${ticket.id}/assign`, { action: "claim" });
            toast.success(`Ticket #${ticket.id} claimed`);
            router.refresh();
        } catch (err: unknown) {
            const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
            toast.error(msg ?? "Failed to claim");
        } finally {
            setClaiming(false);
        }
    };

    return (
        <>
            <div className={`flex items-start gap-4 px-6 py-4 transition-colors ${TYPE_HOVER[type]}`}>
                <div className="shrink-0 mt-0.5">{TYPE_ICON[type]}</div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/office/repairing/tickets/${ticket.id}`} className="text-sm font-semibold text-primary hover:underline">
                            Ticket #{ticket.id}
                        </Link>
                        {ticket.ticketWorker ? (
                            <span className={`text-xs px-2 py-0.5 font-medium ${badgeColor(ticket.ticketWorker.color).className}`} style={badgeColor(ticket.ticketWorker.color).style}>
                                {ticket.ticketWorker.label}
                            </span>
                        ) : (
                            <span className={`text-xs px-2 py-0.5 font-medium ${ticket.ticketStatus.color}`}>
                                {ticket.ticketStatus.label}
                            </span>
                        )}
                        {ticket.workerWork && (
                            <span className={`text-xs px-2 py-0.5 font-medium ${badgeColor(ticket.workerWork.color).className}`} style={badgeColor(ticket.workerWork.color).style}>
                                {ticket.workerWork.label}
                            </span>
                        )}
                        <span className="text-xs text-muted-foreground">{timeAgo(ticket.updatedAt)}</span>
                        {ticket.escalated && (
                            <span className="text-xs px-1.5 py-0.5 bg-destructive/10 text-destructive font-medium">Escalated</span>
                        )}
                    </div>
                    <p className="mt-1 text-sm font-medium text-foreground">
                        {(ticket.device.customer ?? ticket.device.company)?.name}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">· {ticket.device.brand} {ticket.device.model}</span>
                        {(ticket.device.customer ?? ticket.device.company)?.phone && (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">· {(ticket.device.customer ?? ticket.device.company)?.phone}</span>
                        )}
                    </p>
                    {ticket.primaryOwner && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            Owner: {ticket.primaryOwner.name}
                            {ticket.primaryOwner.id === currentUserId && <span className="ml-1 text-primary">(you)</span>}
                        </p>
                    )}
                    {ticket.activeParticipants && ticket.activeParticipants.length > 0 && (
                        <p className="text-xs text-purple-500 mt-0.5">
                            Also: {ticket.activeParticipants.map(p => p.user.name).join(", ")}
                        </p>
                    )}
                    {ticket.serviceCenter && (
                        <p className="mt-0.5 text-xs text-muted-foreground">Service Centre: {ticket.serviceCenter.name}</p>
                    )}
                    {(ticket.ticketWorker?.actionLabel || ticket.ticketStatus.actionLabel) && (
                        <p className="mt-1 text-xs font-medium text-primary">
                            → {ticket.ticketWorker?.actionLabel || ticket.ticketStatus.actionLabel}
                        </p>
                    )}
                </div>
                <div className="shrink-0 flex gap-2 items-center">
                    {isUnassigned && (
                        <Button
                            onClick={handleClaim}
                            disabled={claiming}
                            size="sm"
                        >
                            {claiming ? "…" : "Claim"}
                        </Button>
                    )}
                    {isPrimaryOwner && (
                        <>
                            <Button
                                onClick={() => setModal("pass")}
                                size="sm"
                                variant="outline"
                            >
                                Pass
                            </Button>
                            <Button
                                onClick={() => setModal("reject")}
                                size="sm"
                                variant="destructive"
                            >
                                Reject
                            </Button>
                        </>
                    )}
                    <Button asChild size="sm" variant="secondary">
                        <Link href={`/office/repairing/tickets/${ticket.id}`}>Open</Link>
                    </Button>
                </div>
            </div>

            {modal && (
                <PassRejectModal
                    ticketId={ticket.id}
                    action={modal}
                    onClose={() => setModal(null)}
                    onDone={() => { setModal(null); router.refresh(); }}
                />
            )}
        </>
    );
}

export function TicketSection({
    title, tickets, type, color, bgColor, icon, currentUserId,
}: {
    title: string;
    tickets: TicketCardData[];
    type: Props["type"];
    color: string;
    bgColor: string;
    icon: React.ReactNode;
    currentUserId: number;
}) {
    if (tickets.length === 0) return null;
    const themedHeader = color === "text-blue-700" && bgColor === "bg-blue-50";
    return (
        <div className="mb-6 overflow-hidden rounded-lg border border-border bg-card shadow">
            <div className={`flex items-center gap-2 border-b border-border px-6 py-4 ${themedHeader ? "bg-primary/8" : bgColor}`}>
                {icon}
                <h2 className={`font-semibold ${themedHeader ? "text-primary" : color}`}>{title}</h2>
                <span className={`ml-auto px-2 py-0.5 text-xs font-bold border border-current/20 ${themedHeader ? "bg-primary/12 text-primary" : `${bgColor} ${color}`}`}>
                    {tickets.length} pending
                </span>
            </div>
            <div className="divide-y">
                {tickets.map((ticket) => (
                    <TicketCard
                        key={ticket.id}
                        ticket={ticket}
                        type={type}
                        currentUserId={currentUserId}
                        isPrimaryOwner={ticket.primaryOwner?.id === currentUserId}
                        isUnassigned={!ticket.primaryOwner}
                    />
                ))}
            </div>
        </div>
    );
}

export function AlertCircleIcon() {
    return <AlertCircle size={16} className="text-muted-foreground" />;
}
