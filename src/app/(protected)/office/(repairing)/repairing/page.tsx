import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import Link from "next/link";
import { Phone, Package, AlertCircle, CheckCircle } from "lucide-react";
import { timeAgo } from "@/lib/time-ago";
import TechnicianDashboard from "@/modules/repairing/components/dashboard/TechnicianDashboard";
import AdminDashboard from "@/modules/repairing/components/dashboard/AdminDashboard";

type DashboardPageProps = {
    searchParams: Promise<{ pipeline?: string }>;
};

type DashboardContext = {
    pipelineId?: string;
    pipelineLabel?: string | null;
    ticketsHref: string;
};

function ticketWhere(context: DashboardContext) {
    return context.pipelineId ? { pipelineId: context.pipelineId } : {};
}

async function fetchPipeline(context: DashboardContext) {
    const statuses = await prisma.ticketStatus.findMany({
        where: {
            isTerminal: false,
            ...(context.pipelineId ? { OR: [{ pipelineId: context.pipelineId }, { pipelineId: null }] } : {}),
        },
        orderBy: { order: "asc" },
        select: { id: true, label: true, color: true },
    });

    const counts = await Promise.all(
        statuses.map(async (status) => ({
            id: status.id,
            count: await prisma.ticket.count({
                where: {
                    ...ticketWhere(context),
                    status: status.id,
                },
            }),
        }))
    );

    const countMap = new Map(counts.map((item) => [item.id, item.count]));

    return statuses.map((status) => ({
        ...status,
        _count: { tickets: countMap.get(status.id) ?? 0 },
    }));
}

async function AdminDashboardServer({ name, context }: { name: string; context: DashboardContext }) {
    const [total, open, escalated, ready, actionItems, pipeline, rawTickets, roles] = await Promise.all([
        prisma.ticket.count({ where: ticketWhere(context) }),
        prisma.ticket.count({ where: { ...ticketWhere(context), ticketStatus: { isTerminal: false } } }),
        prisma.ticket.count({ where: { ...ticketWhere(context), escalated: true } }),
        prisma.ticket.count({ where: { ...ticketWhere(context), status: "S6" } }),
        prisma.ticket.count({ where: { ...ticketWhere(context), subStatusId: { not: null } } }),
        fetchPipeline(context),
        prisma.ticket.findMany({
            where: { ...ticketWhere(context), ticketStatus: { isTerminal: false } },
            orderBy: { updatedAt: "desc" },
            take: 100,
            include: {
                device: { include: { account: { include: { customer: { select: { name: true, phone: true } }, company: { select: { name: true, phone: true } } } } } },
                primaryOwner: { select: { id: true, name: true } },
                ticketStatus: { select: { id: true, label: true, color: true, notifyRoles: true } },
                ticketSubStatus: { select: { label: true, color: true, notifyRoles: true } },
            },
        }),
        prisma.role.findMany({ orderBy: { id: "asc" } }),
    ]);

    const allActiveTickets = rawTickets.map(t => ({
        ...t,
        device: {
            ...t.device,
            customer: t.device.account?.customer ?? null,
            company: t.device.account?.company ?? null,
        },
        pendingTeam: (t.ticketSubStatus?.notifyRoles.length ?? 0) > 0
            ? t.ticketSubStatus!.notifyRoles
            : t.ticketStatus.notifyRoles,
    }));

    return (
        <AdminDashboard
            name={name}
            pipeline={pipeline}
            allActiveTickets={allActiveTickets}
            counts={{ total, open, escalated, ready, actionItems }}
            roles={roles}
            contextLabel={context.pipelineLabel}
            ticketsHref={context.ticketsHref}
        />
    );
}

async function TechnicianDashboardServer({ name, userId, context }: { name: string; userId: number; context: DashboardContext }) {
    const [pipeline, rawTickets, unassigned, roles] = await Promise.all([
        fetchPipeline(context),
        prisma.ticket.findMany({
            where: { ...ticketWhere(context), ticketStatus: { isTerminal: false } },
            orderBy: { updatedAt: "desc" },
            include: {
                device: { include: { account: { include: { customer: { select: { name: true, phone: true } }, company: { select: { name: true, phone: true } } } } } },
                primaryOwner: { select: { id: true, name: true } },
                ticketStatus: { select: { id: true, label: true, color: true, notifyRoles: true } },
                ticketSubStatus: { select: { label: true, color: true, notifyRoles: true } },
            },
        }),
        prisma.ticket.findMany({
            where: {
                ...ticketWhere(context),
                primaryOwnerId: null,
                ticketStatus: { isTerminal: false, notifyRoles: { has: "R2" } },
            },
            orderBy: { createdAt: "asc" },
            take: 10,
            include: {
                device: { include: { account: { include: { customer: { select: { name: true, phone: true } }, company: { select: { name: true, phone: true } } } } } },
                ticketStatus: { select: { label: true, color: true, actionLabel: true } },
            },
        }),
        prisma.role.findMany({ orderBy: { id: "asc" } }),
    ]);

    const normaliseDevice = <T extends { device: { account?: { customer?: { name: string; phone?: string | null } | null; company?: { name: string; phone?: string | null } | null } | null } }>(t: T) => ({
        ...t,
        device: { ...t.device, customer: t.device.account?.customer ?? null, company: t.device.account?.company ?? null },
    });

    const allActiveTickets = rawTickets.map(t => ({
        ...normaliseDevice(t),
        pendingTeam: (t.ticketSubStatus?.notifyRoles.length ?? 0) > 0
            ? t.ticketSubStatus!.notifyRoles
            : t.ticketStatus.notifyRoles,
    }));

    const normalisedUnassigned = unassigned.map(normaliseDevice);

    return (
        <TechnicianDashboard
            name={name}
            userId={userId}
            pipeline={pipeline}
            allActiveTickets={allActiveTickets}
            unassigned={normalisedUnassigned}
            roles={roles}
            contextLabel={context.pipelineLabel}
        />
    );
}

async function FrontDeskDashboard({ name, context }: { name: string; context: DashboardContext }) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [subActionCount, statusActionCount, newToday] = await Promise.all([
        prisma.ticket.count({
            where: { ...ticketWhere(context), subStatusId: { not: null }, ticketSubStatus: { notifyRoles: { has: "R3" } } },
        }),
        prisma.ticket.count({
            where: { ...ticketWhere(context), ticketStatus: { notifyRoles: { has: "R3" } } },
        }),
        prisma.ticket.count({ where: { ...ticketWhere(context), createdAt: { gte: today } } }),
    ]);
    const actionCount = subActionCount + statusActionCount;

    const [actionQueue, statusQueue] = await Promise.all([
        prisma.ticket.findMany({
            where: { ...ticketWhere(context), subStatusId: { not: null }, ticketSubStatus: { notifyRoles: { has: "R3" } } },
            orderBy: { updatedAt: "asc" },
            include: {
                device: { include: { account: { include: { customer: { select: { name: true, phone: true } }, company: { select: { name: true, phone: true } } } } } },
                ticketStatus: { select: { label: true, color: true } },
                ticketSubStatus: { select: { id: true, label: true, color: true, actionLabel: true } },
                primaryOwner: { select: { name: true } },
            },
        }),
        prisma.ticket.findMany({
            where: { ...ticketWhere(context), ticketStatus: { notifyRoles: { has: "R3" } } },
            orderBy: { updatedAt: "asc" },
            include: {
                device: { include: { account: { include: { customer: { select: { name: true, phone: true } }, company: { select: { name: true, phone: true } } } } } },
                ticketStatus: { select: { label: true, color: true, actionLabel: true } },
                ticketSubStatus: { select: { label: true, color: true } },
            },
        }),
    ]);

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold mb-1">Front Desk</h1>
                <p className="text-muted-foreground text-sm">
                    Welcome back, {name}{context.pipelineLabel ? ` · ${context.pipelineLabel}` : ""}
                </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-4 rounded-lg border border-border bg-card p-5 shadow">
                    <Phone size={22} className="text-muted-foreground" />
                    <div>
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Action Required</p>
                        <p className={`text-3xl font-bold mt-0.5 ${actionCount > 0 ? "text-destructive" : "text-foreground"}`}>{actionCount}</p>
                    </div>
                </div>
                <div className="flex items-center gap-4 rounded-lg border border-border bg-card p-5 shadow">
                    <Package size={22} className="text-muted-foreground" />
                    <div>
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">New Today</p>
                        <p className="text-3xl font-bold mt-0.5 text-primary">{newToday}</p>
                    </div>
                </div>
            </div>

            {statusQueue.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-border shadow">
                    <div className="flex items-center gap-2 border-b border-border bg-muted px-6 py-4">
                        <CheckCircle size={16} className="text-primary" />
                        <h2 className="font-semibold text-foreground">Status Actions</h2>
                        <span className="ml-auto border border-border bg-primary/10 text-primary text-xs font-bold px-2 py-0.5">
                            {statusQueue.length} pending
                        </span>
                    </div>
                    <div className="divide-y divide-border">
                        {statusQueue.map((t) => (
                            <div key={t.id} className="flex items-start gap-4 px-6 py-4 hover:bg-muted/40">
                                <CheckCircle size={16} className="text-primary mt-0.5 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <Link href={`/office/repairing/tickets/${t.id}`} className="font-semibold text-primary hover:underline text-sm">
                                            Ticket #{t.id}
                                        </Link>
                                        <span className={`text-xs px-2 py-0.5 font-medium ${t.ticketStatus.color}`}>
                                            {t.ticketStatus.label}
                                        </span>
                                        <span className="text-xs text-muted-foreground">{timeAgo(t.updatedAt)}</span>
                                    </div>
                                    <p className="text-sm font-medium text-foreground mt-1">
                                        {(t.device.account?.customer ?? t.device.account?.company)?.name}
                                        <span className="text-muted-foreground font-normal text-xs ml-2">· {t.device.brand} {t.device.model}</span>
                                    </p>
                                    {t.ticketStatus.actionLabel && (
                                        <p className="text-xs text-primary mt-1 font-medium">→ {t.ticketStatus.actionLabel}</p>
                                    )}
                                </div>
                                <Link href={`/office/repairing/tickets/${t.id}`} className="shrink-0 rounded-md border border-primary bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90">Open</Link>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="overflow-hidden rounded-lg border border-border shadow">
                <div className="flex items-center gap-2 border-b border-border bg-muted px-6 py-4">
                    <Phone size={16} className="text-muted-foreground" />
                    <h2 className="font-semibold text-foreground">Call Queue</h2>
                    {subActionCount > 0 && (
                        <span className="ml-auto border border-border bg-destructive/10 text-destructive text-xs font-bold px-2 py-0.5">
                            {subActionCount} pending
                        </span>
                    )}
                </div>
                {actionQueue.length === 0 ? (
                    <div className="px-6 py-10 text-center">
                        <CheckCircle size={32} className="text-primary mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">All clear — no pending calls.</p>
                    </div>
                ) : (
                    <div className="divide-y divide-border">
                        {actionQueue.map((t) => (
                            <div key={t.id} className="flex items-start gap-4 px-6 py-4 hover:bg-muted/40">
                                <Phone size={16} className="text-muted-foreground mt-0.5 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <Link href={`/office/repairing/tickets/${t.id}`} className="font-semibold text-primary hover:underline text-sm">
                                            Ticket #{t.id}
                                        </Link>
                                        <span className={`text-xs px-2 py-0.5 font-medium ${t.ticketSubStatus!.color}`}>
                                            {t.ticketSubStatus!.label}
                                        </span>
                                        <span className="text-xs text-muted-foreground">{timeAgo(t.updatedAt)}</span>
                                    </div>
                                    <p className="text-sm font-medium text-foreground mt-1">
                                        {(t.device.account?.customer ?? t.device.account?.company)?.name}
                                        <span className="text-muted-foreground font-normal"> · {(t.device.account?.customer ?? t.device.account?.company)?.phone}</span>
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        {t.device.brand} {t.device.model}
                                        {t.primaryOwner && <span className="ml-2">· Tech: {t.primaryOwner.name}</span>}
                                    </p>
                                    {t.ticketSubStatus!.actionLabel && (
                                        <p className="text-xs text-destructive mt-1 font-medium">→ {t.ticketSubStatus!.actionLabel}</p>
                                    )}
                                </div>
                                <Link href={`/office/repairing/tickets/${t.id}`} className="shrink-0 rounded-md border border-primary bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90">Open</Link>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {statusQueue.length === 0 && actionQueue.length === 0 && (
                <div className="rounded-lg border border-border bg-card px-6 py-10 text-center shadow">
                    <CheckCircle size={32} className="text-primary mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">All clear — no pending actions.</p>
                </div>
            )}
        </div>
    );
}

async function DespatchDashboard({ name, context }: { name: string; context: DashboardContext }) {
    const [subPendingCount, statusPendingCount, inTransitCount] = await Promise.all([
        prisma.ticket.count({
            where: { ...ticketWhere(context), subStatusId: { not: null }, ticketSubStatus: { notifyRoles: { has: "R4" } } },
        }),
        prisma.ticket.count({
            where: { ...ticketWhere(context), ticketStatus: { notifyRoles: { has: "R4" } } },
        }),
        prisma.ticket.count({ where: { ...ticketWhere(context), escalated: true, status: "S4" } }),
    ]);
    const pendingCount = subPendingCount + statusPendingCount;

    const [pendingQueue, statusQueue] = await Promise.all([
        prisma.ticket.findMany({
            where: { ...ticketWhere(context), subStatusId: { not: null }, ticketSubStatus: { notifyRoles: { has: "R4" } } },
            orderBy: { updatedAt: "asc" },
            include: {
                device: { include: { account: { include: { customer: { select: { name: true, phone: true } }, company: { select: { name: true, phone: true } } } } } },
                ticketStatus: { select: { label: true, color: true } },
                ticketSubStatus: { select: { id: true, label: true, color: true, actionLabel: true } },
                serviceCenter: { select: { name: true } },
                primaryOwner: { select: { name: true } },
            },
        }),
        prisma.ticket.findMany({
            where: { ...ticketWhere(context), ticketStatus: { notifyRoles: { has: "R4" } } },
            orderBy: { updatedAt: "asc" },
            include: {
                device: { include: { account: { include: { customer: { select: { name: true, phone: true } }, company: { select: { name: true, phone: true } } } } } },
                ticketStatus: { select: { label: true, color: true, actionLabel: true } },
                serviceCenter: { select: { name: true } },
            },
        }),
    ]);

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold mb-1">Despatch</h1>
                <p className="text-muted-foreground text-sm">
                    Welcome back, {name}{context.pipelineLabel ? ` · ${context.pipelineLabel}` : ""}
                </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-4 rounded-lg border border-border bg-card p-5 shadow">
                    <Package size={22} className="text-muted-foreground" />
                    <div>
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Pending Action</p>
                        <p className={`text-3xl font-bold mt-0.5 ${pendingCount > 0 ? "text-primary" : "text-foreground"}`}>{pendingCount}</p>
                    </div>
                </div>
                <div className="flex items-center gap-4 rounded-lg border border-border bg-card p-5 shadow">
                    <AlertCircle size={22} className="text-muted-foreground" />
                    <div>
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Escalated (In Repair)</p>
                        <p className="text-3xl font-bold mt-0.5 text-primary">{inTransitCount}</p>
                    </div>
                </div>
            </div>

            {statusQueue.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-border shadow">
                    <div className="flex items-center gap-2 border-b border-border bg-muted px-6 py-4">
                        <Package size={16} className="text-muted-foreground" />
                        <h2 className="font-semibold text-foreground">Status Actions</h2>
                        <span className="ml-auto border border-border bg-primary/10 text-primary text-xs font-bold px-2 py-0.5">
                            {statusQueue.length} pending
                        </span>
                    </div>
                    <div className="divide-y divide-border">
                        {statusQueue.map((t) => (
                            <div key={t.id} className="flex items-start gap-4 px-6 py-4 hover:bg-muted/40">
                                <Package size={16} className="text-muted-foreground mt-0.5 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <Link href={`/office/repairing/tickets/${t.id}`} className="font-semibold text-primary hover:underline text-sm">
                                            Ticket #{t.id}
                                        </Link>
                                        <span className={`text-xs px-2 py-0.5 font-medium ${t.ticketStatus.color}`}>
                                            {t.ticketStatus.label}
                                        </span>
                                        <span className="text-xs text-muted-foreground">{timeAgo(t.updatedAt)}</span>
                                    </div>
                                    <p className="text-sm font-medium text-foreground mt-1">
                                        {t.device.brand} {t.device.model}
                                        <span className="text-muted-foreground font-normal text-xs ml-2">· {(t.device.account?.customer ?? t.device.account?.company)?.name}</span>
                                    </p>
                                    {t.serviceCenter && (
                                        <p className="text-xs text-muted-foreground mt-0.5">Service Centre: {t.serviceCenter.name}</p>
                                    )}
                                    {t.ticketStatus.actionLabel && (
                                        <p className="text-xs text-primary mt-1 font-medium">→ {t.ticketStatus.actionLabel}</p>
                                    )}
                                </div>
                                <Link href={`/office/repairing/tickets/${t.id}`} className="shrink-0 rounded-md border border-primary bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90">Open</Link>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="overflow-hidden rounded-lg border border-border shadow">
                <div className="flex items-center gap-2 border-b border-border bg-muted px-6 py-4">
                    <Package size={16} className="text-muted-foreground" />
                    <h2 className="font-semibold text-foreground">Despatch Queue</h2>
                    {subPendingCount > 0 && (
                        <span className="ml-auto border border-border bg-primary/10 text-primary text-xs font-bold px-2 py-0.5">
                            {subPendingCount} pending
                        </span>
                    )}
                </div>
                {pendingQueue.length === 0 ? (
                    <div className="px-6 py-10 text-center">
                        <CheckCircle size={32} className="text-primary mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">No pending despatch tasks.</p>
                    </div>
                ) : (
                    <div className="divide-y divide-border">
                        {pendingQueue.map((t) => (
                            <div key={t.id} className="flex items-start gap-4 px-6 py-4 hover:bg-muted/40">
                                <Package size={16} className="text-muted-foreground mt-0.5 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <Link href={`/office/repairing/tickets/${t.id}`} className="font-semibold text-primary hover:underline text-sm">
                                            Ticket #{t.id}
                                        </Link>
                                        <span className={`text-xs px-2 py-0.5 font-medium ${t.ticketSubStatus!.color}`}>
                                            {t.ticketSubStatus!.label}
                                        </span>
                                        <span className="text-xs text-muted-foreground">{timeAgo(t.updatedAt)}</span>
                                    </div>
                                    <p className="text-sm font-medium text-foreground mt-1">
                                        {t.device.brand} {t.device.model}
                                        <span className="text-muted-foreground font-normal text-xs ml-2">· {(t.device.account?.customer ?? t.device.account?.company)?.name}</span>
                                    </p>
                                    {t.serviceCenter && (
                                        <p className="text-xs text-muted-foreground mt-0.5">Service Centre: {t.serviceCenter.name}</p>
                                    )}
                                    {t.primaryOwner && (
                                        <p className="text-xs text-muted-foreground">Technician: {t.primaryOwner.name}</p>
                                    )}
                                    {t.ticketSubStatus!.actionLabel && (
                                        <p className="text-xs text-primary mt-1 font-medium">→ {t.ticketSubStatus!.actionLabel}</p>
                                    )}
                                </div>
                                <Link href={`/office/repairing/tickets/${t.id}`} className="shrink-0 rounded-md border border-primary bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90">Open</Link>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] })?.permissions ?? [];
    const name = session?.user?.name ?? "there";
    const userId = Number((session?.user as { id?: string })?.id ?? "0");
    const { pipeline } = await searchParams;

    const selectedPipeline = pipeline
        ? await prisma.pipeline.findFirst({
            where: { id: pipeline, isActive: true },
            select: { id: true, label: true },
        })
        : null;

    const context: DashboardContext = {
        pipelineId: selectedPipeline?.id,
        pipelineLabel: selectedPipeline?.label ?? null,
        ticketsHref: selectedPipeline ? `/office/repairing/tickets?pipeline=${selectedPipeline.id}` : "/office/repairing/tickets",
    };

    if (permissions.includes("admin:bypass")) return <AdminDashboardServer name={name} context={context} />;
    if (permissions.includes("warranty:convert")) return <TechnicianDashboardServer name={name} userId={userId} context={context} />;
    if (permissions.includes("tickets:create")) return <FrontDeskDashboard name={name} context={context} />;
    if (permissions.includes("tickets:substatus:set")) return <DespatchDashboard name={name} context={context} />;

    return <AdminDashboardServer name={name} context={context} />;
}
