import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { Prisma } from "@/generated/prisma/client";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { selectPrimaryPhone } from "@/shared/lib/prisma/fragments";
import {
    Wrench, Phone, Package, CheckCircle, AlertCircle,
    UserCheck, Users, User, ShieldAlert, ClipboardCheck,
} from "lucide-react";
import { TicketSection, type TicketCardData } from "@/modules/repairing/components/assignments/TicketCard";

// Per-Work card chrome, keyed by Work id (the former sub-status group slugs).
const WORK_CARD_META: Record<string, { icon: React.ReactNode; textColor: string }> = {
    customer_comm: { icon: <Phone size={20} />, textColor: "text-blue-600" },
    approval: { icon: <CheckCircle size={20} />, textColor: "text-yellow-600" },
    parts: { icon: <Package size={20} />, textColor: "text-orange-600" },
    qc: { icon: <ClipboardCheck size={20} />, textColor: "text-teal-600" },
    escalated: { icon: <ShieldAlert size={20} />, textColor: "text-red-600" },
    ready: { icon: <CheckCircle size={20} />, textColor: "text-green-600" },
    no_fix: { icon: <AlertCircle size={20} />, textColor: "text-muted-foreground" },
};

// ── Shared include ────────────────────────────────────────────────────────────
const TICKET_INCLUDE = {
    device: {
        include: {
            account: {
                include: {
                    person: {
                        select: {
                            name: true,
                            phones: selectPrimaryPhone,
                        },
                    },
                    company: {
                        select: {
                            name: true,
                            phones: selectPrimaryPhone,
                        },
                    },
                },
            },
        },
    },
    primaryOwner: { select: { id: true, name: true } },
    serviceCenter: { select: { name: true } },
    ticketStatus: { select: { label: true, color: true, actionLabel: true } },
    ticketSubStatus: { select: { id: true, label: true, color: true, workId: true, actionLabel: true } },
    participants: {
        where: { removedAt: null },
        select: { userId: true, user: { select: { id: true, name: true } } },
    },
} satisfies Prisma.TicketInclude;

type RawTicket = Awaited<ReturnType<typeof prisma.ticket.findMany<{ include: typeof TICKET_INCLUDE }>>>[0];

function toCard(t: RawTicket): TicketCardData {
    return {
        id: t.id,
        escalated: t.escalated,
        updatedAt: t.updatedAt,
        device: {
            brand: t.device.brand,
            model: t.device.model,
            customer: t.device.account?.person
                ? {
                      name: t.device.account.person.name,
                      phone: t.device.account.person.phones[0]?.phone ?? null,
                  }
                : null,
            company: t.device.account?.company
                ? {
                      name: t.device.account.company.name,
                      phone: t.device.account.company.phones[0]?.phone ?? null,
                  }
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
        } : null,
        subStatusWorkId: t.ticketSubStatus?.workId ?? null,
        activeParticipants: t.participants,
    };
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({
    label, value, icon, textColor,
}: { label: string; value: number; icon: React.ReactNode; textColor: string }) {
    return (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 shadow">
            <div className={textColor}>{icon}</div>
            <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
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
        permissions?: string[];
    } | undefined;

    const userId = Number(sessionUser?.id ?? "0");
    const permissions: string[] = sessionUser?.permissions ?? [];
    const isAdminUser = permissions.includes(PERMISSIONS.ADMIN_BYPASS);

    const canViewTeam = permissions.includes(PERMISSIONS.ASSIGNMENTS_VIEW_TEAM) || isAdminUser;
    const canViewOrg = permissions.includes(PERMISSIONS.ASSIGNMENTS_VIEW_ORG_LEGACY) || isAdminUser;

    const scope: "me" | "team" | "org" =
        rawScope === "team" && canViewTeam ? "team" :
            rawScope === "org" && canViewOrg ? "org" : "me";

    if (rawScope === "team" && !canViewTeam) redirect("/office/core/assignments?scope=me");
    if (rawScope === "org" && !canViewOrg) redirect("/office/core/assignments?scope=me");

    // ── Fetch ─────────────────────────────────────────────────────────────────
    const [raw, works] = await Promise.all([
        scope === "me"
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
            }),
        prisma.work.findMany({ orderBy: { order: "asc" } }),
    ]);

    const cards = raw.map(toCard);

    // Works the user can act on (team view shows only these; org shows all).
    const visibleWorks = scope === "team"
        ? works.filter((w) => !w.permissionId || permissions.includes(w.permissionId) || isAdminUser)
        : works;
    const visibleWorkIds = new Set(visibleWorks.map((w) => w.id));

    // ── Categorise (team / org) ─────────────────────────────────────────────────
    // team is scoped to tickets in works you can act on (plus untriaged ones with
    // no sub-status); org sees everything.
    const inScope = scope === "team"
        ? cards.filter((t) => t.subStatusWorkId == null || visibleWorkIds.has(t.subStatusWorkId))
        : cards;

    const unassigned = inScope.filter((t) => !t.primaryOwner);
    const ownedInScope = inScope.filter((t) => t.primaryOwner);
    const noWork = ownedInScope.filter((t) => !t.subStatusWorkId);
    const byWork = (workId: string) => ownedInScope.filter((t) => t.subStatusWorkId === workId);

    // ── me scope ────────────────────────────────────────────────────────────────
    const myOwned = scope === "me" ? cards.filter((t) => t.primaryOwner?.id === userId) : [];
    const mySecond = scope === "me" ? cards.filter((t) => t.primaryOwner?.id !== userId) : [];

    const total = cards.length;
    const workCounts = Object.fromEntries(
        works.map((w) => [w.id, cards.filter((t) => t.subStatusWorkId === w.id).length]),
    );

    // ── Tabs ───────────────────────────────────────────────────────────────────
    const TABS = [
        { id: "me", label: "Assigned to Me", desc: "Your primary & secondary assignments" },
        ...(canViewTeam ? [{ id: "team", label: "My Works", desc: "Tickets in works you can do" }] : []),
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
            <div className="mb-6 rounded-lg border border-border bg-card p-1 shadow">
                <div className="flex gap-1">
                    {TABS.map(tab => (
                        <Link
                            key={tab.id}
                            href={`?scope=${tab.id}`}
                            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors flex flex-col items-center justify-center gap-1 ${scope === tab.id
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
                <div className="mb-6 rounded-lg border border-border bg-secondary/30 p-4">
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
                <div className="mb-6 rounded-lg border border-border bg-card p-4">
                    <div className="flex items-center gap-2 text-foreground">
                        <Users size={16} className="text-primary" />
                        <span className="text-sm font-medium">
                            Your works — {visibleWorks.map((w) => w.label).join(", ") || "none"}
                        </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                        Active tickets grouped by the work you have permission to do.
                    </p>
                </div>
            )}
            {scope === "org" && (
                <div className="mb-6 rounded-lg border border-border bg-muted p-4">
                    <div className="flex items-center gap-2 text-foreground">
                        <AlertCircle size={16} className="text-primary" />
                        <span className="text-sm font-medium">Organisation view</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">All active tickets across every work.</p>
                </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-4 mb-6">
                <StatCard label="Total" value={total} icon={<AlertCircle size={20} />} textColor="text-muted-foreground" />
                {works.map((w) => {
                    const meta = WORK_CARD_META[w.id];
                    if (!meta) return null;
                    return (
                        <StatCard
                            key={w.id}
                            label={w.label}
                            value={workCounts[w.id] ?? 0}
                            icon={meta.icon}
                            textColor={meta.textColor}
                        />
                    );
                })}
            </div>

            {/* Sections — me scope */}
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

            {/* Sections — team / org scopes: Unassigned, then one section per Work */}
            {(scope === "team" || scope === "org") && (
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
                    {visibleWorks.map((w) => {
                        const meta = WORK_CARD_META[w.id];
                        return (
                            <TicketSection
                                key={w.id}
                                title={w.label}
                                tickets={byWork(w.id)}
                                type="status"
                                color={meta?.textColor ?? "text-foreground"}
                                bgColor="bg-muted"
                                icon={meta?.icon ?? <CheckCircle size={16} className="text-muted-foreground" />}
                                currentUserId={userId}
                            />
                        );
                    })}
                    <TicketSection
                        title="No sub-status yet"
                        tickets={noWork}
                        type="status"
                        color="text-foreground"
                        bgColor="bg-muted"
                        icon={<AlertCircle size={16} className="text-muted-foreground" />}
                        currentUserId={userId}
                    />
                </>
            )}

            {total === 0 && (
                <div className="rounded-lg border border-border bg-card p-16 text-center shadow">
                    <CheckCircle size={48} className="text-green-400 mx-auto mb-4" />
                    <h3 className="mb-2 text-lg font-medium text-foreground">All caught up!</h3>
                    <p className="text-sm text-muted-foreground">No tickets need your attention right now.</p>
                </div>
            )}
        </div>
    );
}
