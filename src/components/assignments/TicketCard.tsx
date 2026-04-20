"use client";

import { useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Phone, Package, CheckCircle, AlertCircle, UserCheck, Users } from "lucide-react";
import { timeAgo } from "@/lib/time-ago";
import PassRejectModal from "./PassRejectModal";

export interface TicketCardData {
    id: number;
    escalated: boolean;
    updatedAt: Date | string;
    device: { brand: string; model: string; customer: { name: string; phone: string } };
    primaryOwner: { id: number; name: string } | null;
    serviceCenter: { name: string } | null;
    ticketStatus: { label: string; color: string; actionLabel: string | null };
    ticketSubStatus: { id: string; label: string; color: string; actionLabel: string | null; notifyRoles?: string[] } | null;
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
                        <Link href={`/tickets/${ticket.id}`} className="font-semibold text-blue-600 hover:underline text-sm">
                            Ticket #{ticket.id}
                        </Link>
                        {ticket.ticketSubStatus ? (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ticket.ticketSubStatus.color}`}>
                                {ticket.ticketSubStatus.label}
                            </span>
                        ) : (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ticket.ticketStatus.color}`}>
                                {ticket.ticketStatus.label}
                            </span>
                        )}
                        <span className="text-xs text-gray-400">{timeAgo(ticket.updatedAt)}</span>
                        {ticket.escalated && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium">Escalated</span>
                        )}
                    </div>
                    <p className="text-sm font-medium text-gray-800 mt-1">
                        {ticket.device.customer.name}
                        <span className="text-gray-400 font-normal text-xs ml-2">· {ticket.device.brand} {ticket.device.model}</span>
                        {ticket.device.customer.phone && (
                            <span className="text-gray-400 font-normal text-xs ml-2">· {ticket.device.customer.phone}</span>
                        )}
                    </p>
                    {ticket.primaryOwner && (
                        <p className="text-xs text-gray-500 mt-0.5">
                            Owner: {ticket.primaryOwner.name}
                            {ticket.primaryOwner.id === currentUserId && <span className="ml-1 text-blue-500">(you)</span>}
                        </p>
                    )}
                    {ticket.activeParticipants && ticket.activeParticipants.length > 0 && (
                        <p className="text-xs text-purple-500 mt-0.5">
                            Also: {ticket.activeParticipants.map(p => p.user.name).join(", ")}
                        </p>
                    )}
                    {ticket.serviceCenter && (
                        <p className="text-xs text-gray-500 mt-0.5">Service Centre: {ticket.serviceCenter.name}</p>
                    )}
                    {(ticket.ticketSubStatus?.actionLabel || ticket.ticketStatus.actionLabel) && (
                        <p className="text-xs text-blue-600 mt-1 font-medium">
                            → {ticket.ticketSubStatus?.actionLabel || ticket.ticketStatus.actionLabel}
                        </p>
                    )}
                </div>
                <div className="shrink-0 flex gap-2 items-center">
                    {isUnassigned && (
                        <button
                            onClick={handleClaim}
                            disabled={claiming}
                            className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                        >
                            {claiming ? "…" : "Claim"}
                        </button>
                    )}
                    {isPrimaryOwner && (
                        <>
                            <button
                                onClick={() => setModal("pass")}
                                className="text-xs border border-gray-300 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-50"
                            >
                                Pass
                            </button>
                            <button
                                onClick={() => setModal("reject")}
                                className="text-xs border border-red-200 text-red-500 px-3 py-1.5 rounded-lg hover:bg-red-50"
                            >
                                Reject
                            </button>
                        </>
                    )}
                    <Link href={`/tickets/${ticket.id}`} className="text-xs bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-200">
                        Open
                    </Link>
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
    return (
        <div className="bg-white rounded-xl shadow overflow-hidden mb-6">
            <div className={`px-6 py-4 border-b ${bgColor} flex items-center gap-2`}>
                {icon}
                <h2 className={`font-semibold ${color}`}>{title}</h2>
                <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${bgColor} ${color}`}>
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
    return <AlertCircle size={16} className="text-gray-400" />;
}
