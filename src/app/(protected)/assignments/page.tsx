import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import Link from "next/link";
import { Phone, Package, CheckCircle, AlertCircle, UserCheck, Wrench } from "lucide-react";
import { timeAgo } from "@/lib/time-ago";

interface TicketDevice {
    brand: string;
    model: string;
    customer: {
        name: string;
        phone: string;
    };
}

interface TicketStatus {
    label: string;
    color: string;
    actionLabel: string | null;
    notifyRoles: string[];
}

interface TicketSubStatus {
    id: string;
    label: string;
    color: string;
    actionLabel: string | null;
    notifyRoles: string[];
}

interface Ticket {
    id: number;
    device: TicketDevice;
    technician: { id: number; name: string } | null;
    ticketStatus: TicketStatus;
    ticketSubStatus: TicketSubStatus | null;
    serviceCenter: { name: string } | null;
    updatedAt: Date | string;
    escalated: boolean;
}

// ── Fetch assignments based on user role and scope ────────────────────────────────
async function fetchAssignmentsForRole(role: string, userId: number, scope: "me" | "team" | "org") {
    // Get all active tickets first
    const allTickets = await prisma.ticket.findMany({
        where: { ticketStatus: { isTerminal: false } },
        orderBy: { updatedAt: "asc" },
        include: {
            device: { include: { customer: true } },
            technician: { select: { id: true, name: true } },
            serviceCenter: { select: { name: true } },
            ticketStatus: { select: { label: true, color: true, actionLabel: true, notifyRoles: true } },
            ticketSubStatus: { select: { id: true, label: true, color: true, actionLabel: true, notifyRoles: true } },
        },
    });

    // Filter tickets based on scope
    let filteredTickets = allTickets;

    if (scope === "me") {
        // Only tickets assigned to current user
        filteredTickets = allTickets.filter(t => t.technician?.id === userId);
    } else if (scope === "team") {
        // Tickets relevant to this role (notifyRoles) or assigned to this role
        filteredTickets = allTickets.filter(t =>
            t.ticketStatus.notifyRoles.includes(role) ||
            t.ticketSubStatus?.notifyRoles.includes(role) ||
            (t.technician && t.ticketStatus.notifyRoles.includes(role))
        );
    }
    // "org" scope shows all tickets (no additional filtering)

    // Categorize tickets based on scope
    let statusActions, callQueue, despatchQueue, unassignedTickets;

    if (scope === "me") {
        // For "me" scope, show all categories for user's assigned tickets
        statusActions = filteredTickets.filter(t =>
            !t.ticketSubStatus || t.ticketSubStatus.notifyRoles.length === 0
        );

        callQueue = filteredTickets.filter(t =>
            t.ticketSubStatus?.notifyRoles.includes("R3")
        );

        despatchQueue = filteredTickets.filter(t =>
            t.ticketSubStatus?.notifyRoles.includes("R4")
        );

        unassignedTickets = []; // No unassigned tickets in "me" view
    } else if (scope === "org") {
        // For "org" scope, show all categories for all tickets
        statusActions = filteredTickets.filter(t =>
            !t.ticketSubStatus || t.ticketSubStatus.notifyRoles.length === 0
        );

        callQueue = filteredTickets.filter(t =>
            t.ticketSubStatus?.notifyRoles.includes("R3")
        );

        despatchQueue = filteredTickets.filter(t =>
            t.ticketSubStatus?.notifyRoles.includes("R4")
        );

        unassignedTickets = filteredTickets.filter(t => !t.technician);
    } else {
        // For "team" scope, use role-based filtering (same as dashboard)
        statusActions = filteredTickets.filter(t =>
            t.ticketStatus.notifyRoles.includes(role) &&
            (!t.ticketSubStatus || t.ticketSubStatus.notifyRoles.length === 0)
        );

        callQueue = filteredTickets.filter(t =>
            t.ticketSubStatus?.notifyRoles.includes("R3")
        );

        despatchQueue = filteredTickets.filter(t =>
            t.ticketSubStatus?.notifyRoles.includes("R4")
        );

        unassignedTickets = filteredTickets.filter(t =>
            !t.technician &&
            t.ticketStatus.notifyRoles.includes(role)
        );
    }

    return { statusActions, callQueue, despatchQueue, unassignedTickets };
}

// ── Ticket Card Component ────────────────────────────────────────────────────────
function TicketCard({ ticket, type }: { ticket: Ticket; type: string }) {
    const getIcon = () => {
        switch (type) {
            case "status": return <CheckCircle size={16} className="text-green-400" />;
            case "call": return <Phone size={16} className="text-red-400" />;
            case "despatch": return <Package size={16} className="text-orange-400" />;
            case "unassigned": return <UserCheck size={16} className="text-blue-400" />;
            default: return <AlertCircle size={16} className="text-gray-400" />;
        }
    };

    const getBgColor = () => {
        switch (type) {
            case "status": return "hover:bg-green-50/30";
            case "call": return "hover:bg-red-50/30";
            case "despatch": return "hover:bg-orange-50/30";
            case "unassigned": return "hover:bg-blue-50/30";
            default: return "hover:bg-gray-50/30";
        }
    };

    return (
        <div className={`flex items-start gap-4 px-6 py-4 transition-colors ${getBgColor()}`}>
            <div className="shrink-0 mt-0.5">{getIcon()}</div>
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
                {ticket.technician && (
                    <p className="text-xs text-gray-500 mt-0.5">Technician: {ticket.technician.name}</p>
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
            <Link href={`/tickets/${ticket.id}`} className="shrink-0 text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700">
                Process
            </Link>
        </div>
    );
}

// ── Ticket Section Component ────────────────────────────────────────────────────
function TicketSection({ title, tickets, type, color, bgColor }: {
    title: string;
    tickets: Ticket[];
    type: string;
    color: string;
    bgColor: string;
}) {
    if (tickets.length === 0) return null;

    return (
        <div className="bg-white rounded-xl shadow overflow-hidden mb-6">
            <div className={`px-6 py-4 border-b ${bgColor} flex items-center gap-2`}>
                {type === "status" && <CheckCircle size={16} className="text-green-600" />}
                {type === "call" && <Phone size={16} className="text-red-500" />}
                {type === "despatch" && <Package size={16} className="text-orange-500" />}
                {type === "unassigned" && <UserCheck size={16} className="text-blue-500" />}
                <h2 className={`font-semibold ${color}`}>{title}</h2>
                <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${bgColor} ${color}`}>
                    {tickets.length} pending
                </span>
            </div>
            <div className="divide-y">
                {tickets.map((ticket) => (
                    <TicketCard key={ticket.id} ticket={ticket} type={type} />
                ))}
            </div>
        </div>
    );
}

// ── Main Page Component ───────────────────────────────────────────────────────────
export default async function AssignmentsPage({
    searchParams,
}: {
    searchParams: Promise<{ scope?: "me" | "team" | "org" }>;
}) {
    const session = await auth();
    const resolvedSearchParams = await searchParams;
    const role = (session?.user as { role?: string })?.role ?? "";
    const userId = Number((session?.user as { id?: string })?.id ?? "0");
    const scope = resolvedSearchParams.scope ?? "team"; // Default to team view

    const { statusActions, callQueue, despatchQueue, unassignedTickets } = await fetchAssignmentsForRole(role, userId, scope);

    const stats = {
        total: statusActions.length + callQueue.length + despatchQueue.length + unassignedTickets.length,
        statusActions: statusActions.length,
        callQueue: callQueue.length,
        despatchQueue: despatchQueue.length,
        unassigned: unassignedTickets.length
    };

    const getScopeLabel = () => {
        switch (scope) {
            case "me": return "Assigned to Me";
            case "team": return "My Team";
            case "org": return "All Organization";
            default: return "My Team";
        }
    };

    return (
        <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <Wrench size={24} className="text-blue-600" />
                    <div>
                        <h1 className="text-3xl font-bold">Work Inbox</h1>
                        <p className="text-gray-400 text-sm">Process tickets that need your attention</p>
                    </div>
                </div>
            </div>

            {/* Scope Filter Tabs */}
            <div className="bg-white rounded-xl shadow p-1 mb-6">
                <div className="flex gap-1">
                    {[
                        { id: "me", label: "Assigned to Me", description: "Tickets assigned directly to you" },
                        { id: "team", label: "My Team", description: "Tickets for your role level" },
                        { id: "org", label: "All Organization", description: "All tickets in the system" },
                    ].map((tab) => (
                        <Link
                            key={tab.id}
                            href={`?scope=${tab.id}`}
                            className={`flex-1 px-4 py-3 rounded-md text-sm font-medium transition-colors flex flex-col items-center justify-center gap-1 ${scope === tab.id
                                    ? "bg-blue-600 text-white"
                                    : "text-gray-600 hover:bg-gray-100"
                                }`}
                        >
                            <span className="font-medium">{tab.label}</span>
                            <span className={`text-xs ${scope === tab.id ? "text-blue-100" : "text-gray-400"
                                }`}>
                                {tab.description}
                            </span>
                        </Link>
                    ))}
                </div>
            </div>

            {/* Current Scope Indicator */}
            <div className="mb-6">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                    <span>Showing:</span>
                    <span className="font-medium text-gray-800">{getScopeLabel()}</span>
                    <span>•</span>
                    <span>{stats.total} ticket{stats.total !== 1 ? "s" : ""}</span>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-5 gap-4 mb-6">
                <div className="bg-white rounded-xl shadow p-4 flex items-center gap-3">
                    <div className="text-gray-400"><AlertCircle size={20} /></div>
                    <div>
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Total</p>
                        <p className="text-2xl font-bold text-gray-800">{stats.total}</p>
                    </div>
                </div>
                <div className="bg-white rounded-xl shadow p-4 flex items-center gap-3">
                    <div className="text-green-500"><CheckCircle size={20} /></div>
                    <div>
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Status</p>
                        <p className="text-2xl font-bold text-green-600">{stats.statusActions}</p>
                    </div>
                </div>
                <div className="bg-white rounded-xl shadow p-4 flex items-center gap-3">
                    <div className="text-red-500"><Phone size={20} /></div>
                    <div>
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Calls</p>
                        <p className="text-2xl font-bold text-red-600">{stats.callQueue}</p>
                    </div>
                </div>
                <div className="bg-white rounded-xl shadow p-4 flex items-center gap-3">
                    <div className="text-orange-500"><Package size={20} /></div>
                    <div>
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Despatch</p>
                        <p className="text-2xl font-bold text-orange-600">{stats.despatchQueue}</p>
                    </div>
                </div>
                <div className="bg-white rounded-xl shadow p-4 flex items-center gap-3">
                    <div className="text-blue-500"><UserCheck size={20} /></div>
                    <div>
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Unassigned</p>
                        <p className="text-2xl font-bold text-blue-600">{stats.unassigned}</p>
                    </div>
                </div>
            </div>

            {/* All Tickets Section */}
            <div>
                {scope === "me" && (
                    <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <div className="flex items-center gap-2 text-blue-800">
                            <UserCheck size={16} className="text-blue-600" />
                            <span className="text-sm font-medium">Your assigned tickets</span>
                        </div>
                        <p className="text-xs text-blue-600 mt-1">Only tickets assigned directly to you are shown</p>
                    </div>
                )}

                {scope === "team" && (
                    <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4">
                        <div className="flex items-center gap-2 text-green-800">
                            <CheckCircle size={16} className="text-green-600" />
                            <span className="text-sm font-medium">Team tickets ({role})</span>
                        </div>
                        <p className="text-xs text-green-600 mt-1">Tickets that need attention from your role level</p>
                    </div>
                )}

                {scope === "org" && (
                    <div className="mb-6 bg-gray-50 border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center gap-2 text-gray-800">
                            <AlertCircle size={16} className="text-gray-600" />
                            <span className="text-sm font-medium">Organization view</span>
                        </div>
                        <p className="text-xs text-gray-600 mt-1">All active tickets in the system</p>
                    </div>
                )}

                <TicketSection
                    title="Status Actions"
                    tickets={statusActions}
                    type="status"
                    color="text-green-700"
                    bgColor="bg-green-50"
                />
                <TicketSection
                    title="Call Queue"
                    tickets={callQueue}
                    type="call"
                    color="text-red-700"
                    bgColor="bg-red-50"
                />
                <TicketSection
                    title="Despatch Queue"
                    tickets={despatchQueue}
                    type="despatch"
                    color="text-orange-700"
                    bgColor="bg-orange-50"
                />
                <TicketSection
                    title="Unassigned Tickets"
                    tickets={unassignedTickets}
                    type="unassigned"
                    color="text-blue-700"
                    bgColor="bg-blue-50"
                />
                {stats.total === 0 && (
                    <div className="bg-white rounded-xl shadow p-16 text-center">
                        <CheckCircle size={48} className="text-green-400 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-800 mb-2">All caught up!</h3>
                        <p className="text-sm text-gray-400">No tickets need your attention right now.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
