import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Wrench, AlertCircle, CheckCircle, Phone, Package, UserCheck, Users } from "lucide-react";
import { TicketSection, type TicketCardData } from "@/components/assignments/TicketCard";

const TICKET_INCLUDE = {
    device: { include: { customer: true } },
    primaryOwner: { select: { id: true, name: true } },
    serviceCenter: { select: { name: true } },
    ticketStatus: { select: { label: true, color: true, actionLabel: true, notifyRoles: true } },
    ticketSubStatus: { select: { id: true, label: true, color: true, actionLabel: true, notifyRoles: true } },
    participants: {
        where: { removedAt: null },
        select: { userId: true, user: { select: { id: true, name: true } } },
    },
} as const;

type RawTicket = Awaited<ReturnType<typeof fetchTickets>>[0];

async function fetchTickets(scope: "me" | "team" | "org", userId: number, managerId: number | null) {
    if (scope === "me") {
        return prisma.ticket.findMany({
            where: {
                ticketStatus: { isTerminal: false },
                OR: [
                    { primaryOwnerId: userId },
                    { participants: { some: { userId, removedAt: null } } },
                ],
            },
            orderBy: { updatedAt: "asc" },
            include: TICKET_INCLUDE,
        });
    }

    if (scope === "team") {
        if (!managerId) return [];
        return prisma.ticket.findMany({
            where: {
                ticketStatus: { isTerminal: false },
                primaryOwner: { managerId: userId },
            },
            orderBy: { updatedAt: "asc" },
            include: TICKET_INCLUDE,
        });
    }

    // org — admin only, guarded at render time
    return prisma.ticket.findMany({
        where: { ticketStatus: { isTerminal: false } },
        orderBy: { updatedAt: "asc" },
        include: TICKET_INCLUDE,
    });
}

function toCardData(t: RawTicket): TicketCardData {
    return {
        id: t.id,
        escalated: t.escalated,
        updatedAt: t.updatedAt,
        device: {
            brand: t.device.brand,
            model: t.device.model,
            customer: { name: t.device.customer.name, phone: t.device.customer.phone },
        },
        primaryOwner: t.primaryOwner,
        serviceCenter: t.serviceCenter,
        ticketStatus: {
            label: t.ticketStatus.label,
            color: t.ticketStatus.color,
            actionLabel: t.ticketStatus.actionLabel,
        },
        ticketSubStatus: t.ticketSubStatus ? {
            id: t.ticketSubStatus.id,
            label: t.ticketSubStatus.label,
            color: t.ticketSubStatus.color,
            actionLabel: t.ticketSubStatus.actionLabel,
            notifyRoles: t.ticketSubStatus.notifyRoles,
        } : null,
        activeParticipants: t.participants,
    };
}

export default async function AssignmentsPage({
    searchParams,
}: {
    searchParams: Promise<{ scope?: string }>;
}) {
    const session = await auth();
    const resolvedParams = await searchParams;

    const sessionUser = session?.user as {
        id?: string;
        role?: string;
        roles?: string[];
        permissions?: string[];
    } | undefined;

    const userId = Number(sessionUser?.id ?? "0");
    const roles: string[] = sessionUser?.roles ?? (sessionUser?.role ? [sessionUser.role] : []);
    const isAdmin = sessionUser?.permissions?.includes("admin:bypass") ?? false;

    const rawScope = resolvedParams.scope;
    const scope: "me" | "team" | "org" =
        rawScope === "me" || rawScope === "team" || rawScope === "org" ? rawScope : "me";

    // Org scope restricted to admins
    if (scope === "org" && !isAdmin) redirect("/assignments?scope=me");

    // Get caller's managerId for team scope
    const callerUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { managerId: true, name: true },
    });
    const managerId = callerUser?.managerId ?? null;

    const tickets = await fetchTickets(scope, userId, managerId);
    const cards = tickets.map(toCardData);

    // ── Categorise ─────────────────────────────────────────────────────────────
    let primaryTickets: TicketCardData[] = [];
    let secondaryTickets: TicketCardData[] = [];
    let callQueue: TicketCardData[] = [];
    let despatchQueue: TicketCardData[] = [];
    let unassigned: TicketCardData[] = [];
    let teamTickets: TicketCardData[] = [];

    if (scope === "me") {
        primaryTickets = cards.filter(t => t.primaryOwner?.id === userId);
        secondaryTickets = cards.filter(t =>
            t.primaryOwner?.id !== userId &&
            t.activeParticipants?.some(p => p.user.id === userId)
        );
    } else if (scope === "team") {
        // Team view: show by sub-status category
        callQueue = cards.filter(t => t.ticketSubStatus?.notifyRoles?.includes("R3") ||
            roles.some(r => t.ticketSubStatus?.notifyRoles?.includes(r)));
        despatchQueue = cards.filter(t =>
            !callQueue.includes(t) &&
            (t.ticketSubStatus?.notifyRoles?.includes("R4") || roles.some(r => t.ticketSubStatus?.notifyRoles?.includes(r)))
        );
        teamTickets = cards.filter(t => !callQueue.includes(t) && !despatchQueue.includes(t));
    } else {
        // Org view
        callQueue = cards.filter(t => t.ticketSubStatus?.notifyRoles?.includes("R3"));
        despatchQueue = cards.filter(t => t.ticketSubStatus?.notifyRoles?.includes("R4") && !callQueue.includes(t));
        unassigned = cards.filter(t => !t.primaryOwner);
        primaryTickets = cards.filter(t => t.primaryOwner && !callQueue.includes(t) && !despatchQueue.includes(t) && !unassigned.includes(t));
    }

    const total = primaryTickets.length + secondaryTickets.length + callQueue.length +
        despatchQueue.length + unassigned.length + teamTickets.length;

    const SCOPE_TABS = [
        { id: "me", label: "Assigned to Me", description: "Primary + secondary assignments" },
        { id: "team", label: "My Team", description: "Tickets for your direct reports" },
        ...(isAdmin ? [{ id: "org", label: "All Organisation", description: "Every active ticket" }] : []),
    ] as const;

    return (
        <div>
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
                <Wrench size={24} className="text-blue-600" />
                <div>
                    <h1 className="text-3xl font-bold">Assignments</h1>
                    <p className="text-gray-400 text-sm">Your tickets and team workload</p>
                </div>
            </div>

            {/* Scope Tabs */}
            <div className="bg-white rounded-xl shadow p-1 mb-6">
                <div className="flex gap-1">
                    {SCOPE_TABS.map(tab => (
                        <Link
                            key={tab.id}
                            href={`?scope=${tab.id}`}
                            className={`flex-1 px-4 py-3 rounded-md text-sm font-medium transition-colors flex flex-col items-center justify-center gap-1 ${
                                scope === tab.id ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"
                            }`}
                        >
                            <span className="font-medium">{tab.label}</span>
                            <span className={`text-xs ${scope === tab.id ? "text-blue-100" : "text-gray-400"}`}>
                                {tab.description}
                            </span>
                        </Link>
                    ))}
                </div>
            </div>

            {/* Summary */}
            <div className="mb-4 text-sm text-gray-500">
                Showing <span className="font-semibold text-gray-800">{total}</span> ticket{total !== 1 ? "s" : ""}
            </div>

            {/* Sections */}
            {scope === "me" && (
                <>
                    <TicketSection
                        title="My Tickets (Primary Owner)"
                        tickets={primaryTickets}
                        type="primary"
                        color="text-green-700"
                        bgColor="bg-green-50"
                        icon={<CheckCircle size={16} className="text-green-600" />}
                        currentUserId={userId}
                    />
                    <TicketSection
                        title="Helping With (Secondary)"
                        tickets={secondaryTickets}
                        type="secondary"
                        color="text-purple-700"
                        bgColor="bg-purple-50"
                        icon={<Users size={16} className="text-purple-500" />}
                        currentUserId={userId}
                    />
                </>
            )}

            {scope === "team" && (
                <>
                    <TicketSection
                        title="Call Queue"
                        tickets={callQueue}
                        type="call"
                        color="text-red-700"
                        bgColor="bg-red-50"
                        icon={<Phone size={16} className="text-red-500" />}
                        currentUserId={userId}
                    />
                    <TicketSection
                        title="Despatch Queue"
                        tickets={despatchQueue}
                        type="despatch"
                        color="text-orange-700"
                        bgColor="bg-orange-50"
                        icon={<Package size={16} className="text-orange-500" />}
                        currentUserId={userId}
                    />
                    <TicketSection
                        title="Team Tickets"
                        tickets={teamTickets}
                        type="status"
                        color="text-gray-700"
                        bgColor="bg-gray-50"
                        icon={<AlertCircle size={16} className="text-gray-500" />}
                        currentUserId={userId}
                    />
                    {scope === "team" && !managerId && tickets.length === 0 && (
                        <div className="bg-white rounded-xl shadow p-12 text-center text-gray-400">
                            <Users size={40} className="mx-auto mb-3 text-gray-300" />
                            <p className="font-medium">No direct reports</p>
                            <p className="text-sm mt-1">You have no team members assigned to you.</p>
                        </div>
                    )}
                </>
            )}

            {scope === "org" && (
                <>
                    <TicketSection
                        title="Unassigned"
                        tickets={unassigned}
                        type="unassigned"
                        color="text-blue-700"
                        bgColor="bg-blue-50"
                        icon={<UserCheck size={16} className="text-blue-500" />}
                        currentUserId={userId}
                    />
                    <TicketSection
                        title="Call Queue"
                        tickets={callQueue}
                        type="call"
                        color="text-red-700"
                        bgColor="bg-red-50"
                        icon={<Phone size={16} className="text-red-500" />}
                        currentUserId={userId}
                    />
                    <TicketSection
                        title="Despatch Queue"
                        tickets={despatchQueue}
                        type="despatch"
                        color="text-orange-700"
                        bgColor="bg-orange-50"
                        icon={<Package size={16} className="text-orange-500" />}
                        currentUserId={userId}
                    />
                    <TicketSection
                        title="All Active Tickets"
                        tickets={primaryTickets}
                        type="status"
                        color="text-gray-700"
                        bgColor="bg-gray-50"
                        icon={<AlertCircle size={16} className="text-gray-500" />}
                        currentUserId={userId}
                    />
                </>
            )}

            {total === 0 && (
                <div className="bg-white rounded-xl shadow p-16 text-center">
                    <CheckCircle size={48} className="text-green-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-800 mb-2">All caught up!</h3>
                    <p className="text-sm text-gray-400">No tickets need your attention right now.</p>
                </div>
            )}
        </div>
    );
}
