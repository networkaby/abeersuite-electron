import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
    Wrench, Phone, Package, CheckCircle, AlertCircle,
    UserCheck, Users, User, ShieldAlert, ClipboardCheck,
} from "lucide-react";
import { TicketSection, type TicketCardData } from "@/components/assignments/TicketCard";

const GROUP_OPTIONS = [
    { value: "customer_comm", label: "Customer Communication" },
    { value: "approval", label: "Quote & Approval" },
    { value: "parts", label: "Parts" },
    { value: "qc", label: "Quality Check" },
    { value: "escalated", label: "Escalated" },
    { value: "ready", label: "Ready for Collection" },
    { value: "no_fix", label: "No Fix" },
] as const;

const GROUP_CARD_META = {
    customer_comm: { icon: <Phone size={20} />, textColor: "text-blue-600" },
    approval: { icon: <CheckCircle size={20} />, textColor: "text-yellow-600" },
    parts: { icon: <Package size={20} />, textColor: "text-orange-600" },
    qc: { icon: <ClipboardCheck size={20} />, textColor: "text-teal-600" },
    escalated: { icon: <ShieldAlert size={20} />, textColor: "text-red-600" },
    ready: { icon: <CheckCircle size={20} />, textColor: "text-green-600" },
    no_fix: { icon: <AlertCircle size={20} />, textColor: "text-gray-600" },
} satisfies Record<(typeof GROUP_OPTIONS)[number]["value"], { icon: React.ReactNode; textColor: string }>;

// ── Shared include ────────────────────────────────────────────────────────────
const TICKET_INCLUDE = {
    device: {
        include: {
            account: {
                include: {
                    customer: { select: { name: true, phone: true } },
                    company: { select: { name: true, phone: true } },
                },
            },
        },
    },
    primaryOwner: { select: { id: true, name: true } },
    serviceCenter: { select: { name: true } },
    ticketStatus: { select: { label: true, color: true, actionLabel: true, notifyRoles: true } },
    ticketSubStatus: { select: { id: true, label: true, color: true, group: true, actionLabel: true, notifyRoles: true } },
    participants: {
        where: { removedAt: null },
        select: { userId: true, user: { select: { id: true, name: true } } },
    },
} as const;

type RawTicket = Awaited<ReturnType<typeof prisma.ticket.findMany<{ include: typeof TICKET_INCLUDE }>>>[0];

function toCard(t: RawTicket): TicketCardData {
    return {
        id: t.id,
        escalated: t.escalated,
        updatedAt: t.updatedAt,
        device: {
            brand: t.device.brand,
            model: t.device.model,
            customer: t.device.account?.customer
                ? { name: t.device.account.customer.name, phone: t.device.account.customer.phone }
                : null,
            company: t.device.account?.company
                ? { name: t.device.account.company.name, phone: t.device.account.company.phone }
                : null,
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

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({
    label, value, icon, textColor,
}: { label: string; value: number; icon: React.ReactNode; textColor: string }) {
    return (
        <div className="bg-white rounded-xl shadow p-4 flex items-center gap-3">
            <div className={textColor}>{icon}</div>
            <div>
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
                <p className={`text-2xl font-bold ${textColor}`}>{value}</p>
            </div>
        </div>
    );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default async function AssignmentsPage({
    searchParams,
}: {
    searchParams: Promise<{ scope?: string }>;
}) {
    const session = await auth();
    const { scope: rawScope } = await searchParams;

    const sessionUser = session?.user as {
        id?: string;
        role?: string;
        roles?: string[];
        permissions?: string[];
    } | undefined;

    const userId = Number(sessionUser?.id ?? "0");
    const userRoles = sessionUser?.roles ?? (sessionUser?.role ? [sessionUser.role] : []);
    const permissions: string[] = sessionUser?.permissions ?? [];

    const canViewTeam = permissions.includes("assignments:view-team") || permissions.includes("admin:bypass");
    const canViewOrg = permissions.includes("assignments:view-org") || permissions.includes("admin:bypass");

    const scope: "me" | "team" | "org" =
        rawScope === "team" && canViewTeam ? "team" :
            rawScope === "org" && canViewOrg ? "org" : "me";

    if (rawScope === "team" && !canViewTeam) redirect("/assignments?scope=me");
    if (rawScope === "org" && !canViewOrg) redirect("/assignments?scope=me");

    // ── Fetch ─────────────────────────────────────────────────────────────────
    const raw = await (scope === "me"
        ? prisma.ticket.findMany({
            where: {
                ticketStatus: { isTerminal: false },
                OR: [
                    { primaryOwnerId: userId },
                    { participants: { some: { userId, removedAt: null } } },
                ],
            },
            orderBy: { updatedAt: "asc" },
            include: TICKET_INCLUDE,
        })
        : prisma.ticket.findMany({
            where: { ticketStatus: { isTerminal: false } },
            orderBy: { updatedAt: "asc" },
            include: TICKET_INCLUDE,
        })
    );

    const cards = raw.map(toCard);

    // ── Categorise ─────────────────────────────────────────────────────────────
    let myOwned: TicketCardData[] = [];
    let mySecond: TicketCardData[] = [];
    let callQueue: TicketCardData[] = [];
    let despQueue: TicketCardData[] = [];
    let unassigned: TicketCardData[] = [];
    let general: TicketCardData[] = [];

    if (scope === "me") {
        myOwned = cards.filter(t => t.primaryOwner?.id === userId);
        mySecond = cards.filter(t => t.primaryOwner?.id !== userId);
    } else if (scope === "team") {
        // Dynamic: Show any ticket where at least one of MY roles is in notifyRoles
        const myTeamTickets = cards.filter((_, idx) => {
            const t = raw[idx];
            return t.ticketSubStatus?.notifyRoles?.some(r => userRoles.includes(r)) ||
                t.ticketStatus?.notifyRoles?.some(r => userRoles.includes(r));
        });

        callQueue = myTeamTickets.filter(t => t.ticketSubStatus?.notifyRoles?.includes("R3"));
        despQueue = myTeamTickets.filter(t => t.ticketSubStatus?.notifyRoles?.includes("R4") && !callQueue.includes(t));
        unassigned = myTeamTickets.filter(t => !t.primaryOwner && !callQueue.includes(t) && !despQueue.includes(t));
        general = myTeamTickets.filter(t => !callQueue.includes(t) && !despQueue.includes(t) && !unassigned.includes(t));
    } else {
        unassigned = cards.filter(t => !t.primaryOwner);
        callQueue = cards.filter(t => t.ticketSubStatus?.notifyRoles?.includes("R3") && !unassigned.includes(t));
        despQueue = cards.filter(t => t.ticketSubStatus?.notifyRoles?.includes("R4") && !unassigned.includes(t) && !callQueue.includes(t));
        general = cards.filter(t => !unassigned.includes(t) && !callQueue.includes(t) && !despQueue.includes(t));
    }

    const total = cards.length;
    const groupedSubStatusCounts = Object.fromEntries(
        GROUP_OPTIONS.map(({ value }) => [
            value,
            raw.filter((ticket) => ticket.ticketSubStatus?.group === value).length,
        ]),
    ) as Record<(typeof GROUP_OPTIONS)[number]["value"], number>;

    // ── Tabs ───────────────────────────────────────────────────────────────────
    const TABS = [
        { id: "me", label: "Assigned to Me", desc: "Your primary & secondary assignments" },
        ...(canViewTeam ? [{ id: "team", label: "My Team", desc: "All tickets for your role" }] : []),
        ...(canViewOrg ? [{ id: "org", label: "All Organisation", desc: "Every active ticket" }] : []),
    ] as const;

    return (
        <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <Wrench size={24} className="text-primary" />
                    <div>
                        <h1 className="text-3xl font-bold">Work Inbox</h1>
                        <p className="text-sm text-muted-foreground">Process tickets that need your attention</p>
                    </div>
                </div>
            </div>

            {/* Scope tabs */}
            <div className="mb-6 rounded-xl bg-card p-1 shadow">
                <div className="flex gap-1">
                    {TABS.map(tab => (
                        <Link
                            key={tab.id}
                            href={`?scope=${tab.id}`}
                            className={`flex-1 px-4 py-3 rounded-md text-sm font-medium transition-colors flex flex-col items-center justify-center gap-1 ${scope === tab.id
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-muted"
                                }`}
                        >
                            <span className="font-medium">{tab.label}</span>
                            <span className={`text-xs ${scope === tab.id ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                                {tab.desc}
                            </span>
                        </Link>
                    ))}
                </div>
            </div>

            {/* Scope banner */}
            {scope === "me" && (
                <div className="mb-6 rounded-lg border border-primary/20 bg-primary/8 p-4">
                    <div className="flex items-center gap-2 text-foreground">
                        <UserCheck size={16} className="text-primary" />
                        <span className="text-sm font-medium">Your named assignments</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Tickets where you are the primary owner or a named secondary participant.
                    </p>
                </div>
            )}
            {scope === "team" && (
                <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-green-800">
                        <Users size={16} className="text-green-600" />
                        <span className="text-sm font-medium">Team view — {userRoles.join(", ")}</span>
                    </div>
                    <p className="text-xs text-green-600 mt-1">
                        All active tickets routed to your role, whether assigned to someone or not.
                    </p>
                </div>
            )}
            {scope === "org" && (
                <div className="mb-6 bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-gray-800">
                        <AlertCircle size={16} className="text-gray-600" />
                        <span className="text-sm font-medium">Organisation view</span>
                    </div>
                    <p className="text-xs text-gray-600 mt-1">All active tickets across every role.</p>
                </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-4 mb-6">
                <StatCard label="Total" value={total} icon={<AlertCircle size={20} />} textColor="text-gray-600" />
                {GROUP_OPTIONS.map(({ value, label }) => (
                    <StatCard
                        key={value}
                        label={label}
                        value={groupedSubStatusCounts[value]}
                        icon={GROUP_CARD_META[value].icon}
                        textColor={GROUP_CARD_META[value].textColor}
                    />
                ))}
            </div>

            {/* Sections */}
            {scope === "me" && (
                <>
                    <TicketSection
                        title="Primary Owner"
                        tickets={myOwned}
                        type="primary"
                        color="text-blue-700"
                        bgColor="bg-blue-50"
                        icon={<User size={16} className="text-blue-500" />}
                        currentUserId={userId}
                    />
                    <TicketSection
                        title="Secondary Participant"
                        tickets={mySecond}
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
                        title="Unassigned"
                        tickets={unassigned}
                        type="unassigned"
                        color="text-amber-700"
                        bgColor="bg-amber-50"
                        icon={<UserCheck size={16} className="text-amber-500" />}
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
                        tickets={despQueue}
                        type="despatch"
                        color="text-orange-700"
                        bgColor="bg-orange-50"
                        icon={<Package size={16} className="text-orange-500" />}
                        currentUserId={userId}
                    />
                    <TicketSection
                        title="Active Tickets"
                        tickets={general}
                        type="status"
                        color="text-gray-700"
                        bgColor="bg-gray-50"
                        icon={<CheckCircle size={16} className="text-gray-500" />}
                        currentUserId={userId}
                    />
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
                        tickets={despQueue}
                        type="despatch"
                        color="text-orange-700"
                        bgColor="bg-orange-50"
                        icon={<Package size={16} className="text-orange-500" />}
                        currentUserId={userId}
                    />
                    <TicketSection
                        title="All Active Tickets"
                        tickets={general}
                        type="status"
                        color="text-gray-700"
                        bgColor="bg-gray-50"
                        icon={<AlertCircle size={16} className="text-gray-500" />}
                        currentUserId={userId}
                    />
                </>
            )}

            {total === 0 && (
                <div className="rounded-xl bg-card p-16 text-center shadow">
                    <CheckCircle size={48} className="text-green-400 mx-auto mb-4" />
                    <h3 className="mb-2 text-lg font-medium text-foreground">All caught up!</h3>
                    <p className="text-sm text-muted-foreground">No tickets need your attention right now.</p>
                </div>
            )}
        </div>
    );
}
