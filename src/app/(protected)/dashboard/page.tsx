import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import Link from "next/link";
import { Phone, Package, AlertCircle, CheckCircle } from "lucide-react";
import { timeAgo } from "@/lib/time-ago";
import TechnicianDashboard from "@/components/dashboard/TechnicianDashboard";
import AdminDashboard from "@/components/dashboard/AdminDashboard";

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
                device: { include: { customer: true, company: true } },
                primaryOwner: { select: { id: true, name: true } },
                ticketStatus: { select: { id: true, label: true, color: true, notifyRoles: true } },
                ticketSubStatus: { select: { label: true, color: true, notifyRoles: true } },
            },
        }),
        prisma.role.findMany({ orderBy: { id: "asc" } }),
    ]);

    const allActiveTickets = rawTickets.map(t => ({
        ...t,
        device: { ...t.device, customer: t.device.customer, company: t.device.company },
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
                device: { include: { customer: true, company: true } },
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
                device: { include: { customer: true, company: true } },
                ticketStatus: { select: { label: true, color: true, actionLabel: true } },
            },
        }),
        prisma.role.findMany({ orderBy: { id: "asc" } }),
    ]);

    const allActiveTickets = rawTickets.map(t => ({
        ...t,
        pendingTeam: (t.ticketSubStatus?.notifyRoles.length ?? 0) > 0
            ? t.ticketSubStatus!.notifyRoles
            : t.ticketStatus.notifyRoles,
    }));

    return (
        <TechnicianDashboard
            name={name}
            userId={userId}
            pipeline={pipeline}
            allActiveTickets={allActiveTickets}
            unassigned={unassigned}
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
                device: { include: { customer: true, company: true } },
                ticketStatus: { select: { label: true, color: true } },
                ticketSubStatus: { select: { id: true, label: true, color: true, actionLabel: true } },
                primaryOwner: { select: { name: true } },
            },
        }),
        prisma.ticket.findMany({
            where: { ...ticketWhere(context), ticketStatus: { notifyRoles: { has: "R3" } } },
            orderBy: { updatedAt: "asc" },
            include: {
                device: { include: { customer: true, company: true } },
                ticketStatus: { select: { label: true, color: true, actionLabel: true } },
                ticketSubStatus: { select: { label: true, color: true } },
            },
        }),
    ]);

    return (
        <div>
            <h1 className="text-2xl font-bold mb-1">Front Desk</h1>
            <p className="text-gray-400 text-sm mb-6">
                Welcome back, {name}
                {context.pipelineLabel ? ` · ${context.pipelineLabel}` : ""}
            </p>

            <div className="grid grid-cols-3 gap-4 mb-8">
                <div className="bg-white rounded-xl shadow p-5 flex items-center gap-4">
                    <div className="text-gray-400"><Phone size={22} /></div>
                    <div>
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Action Required</p>
                        <p className={`text-3xl font-bold mt-0.5 ${actionCount > 0 ? "text-red-600" : "text-gray-800"}`}>{actionCount}</p>
                    </div>
                </div>
                <div className="bg-white rounded-xl shadow p-5 flex items-center gap-4">
                    <div className="text-gray-400"><Package size={22} /></div>
                    <div>
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">New Today</p>
                        <p className="text-3xl font-bold mt-0.5 text-blue-600">{newToday}</p>
                    </div>
                </div>
            </div>

            {statusQueue.length > 0 && (
                <div className="bg-white rounded-xl shadow overflow-hidden mb-6">
                    <div className="px-6 py-4 border-b bg-green-50 flex items-center gap-2">
                        <CheckCircle size={16} className="text-green-600" />
                        <h2 className="font-semibold text-green-700">Status Actions</h2>
                        <span className="ml-auto bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">
                            {statusQueue.length} pending
                        </span>
                    </div>
                    <div className="divide-y">
                        {statusQueue.map((t) => (
                            <div key={t.id} className="flex items-start gap-4 px-6 py-4 hover:bg-green-50/30">
                                <div className="shrink-0 mt-0.5"><CheckCircle size={16} className="text-green-400" /></div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <Link href={`/tickets/${t.id}`} className="font-semibold text-blue-600 hover:underline text-sm">
                                            Ticket #{t.id}
                                        </Link>
                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.ticketStatus.color}`}>
                                            {t.ticketStatus.label}
                                        </span>
                                        <span className="text-xs text-gray-400">{timeAgo(t.updatedAt)}</span>
                                    </div>
                                    <p className="text-sm font-medium text-gray-800 mt-1">
                                        {(t.device.customer ?? t.device.company)?.name}
                                        <span className="text-gray-400 font-normal text-xs ml-2">· {t.device.brand} {t.device.model}</span>
                                    </p>
                                    {t.ticketStatus.actionLabel && (
                                        <p className="text-xs text-green-700 mt-1 font-medium">→ {t.ticketStatus.actionLabel}</p>
                                    )}
                                </div>
                                <Link href={`/tickets/${t.id}`} className="shrink-0 text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700">Open</Link>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="bg-white rounded-xl shadow overflow-hidden mb-6">
                <div className="px-6 py-4 border-b bg-red-50 flex items-center gap-2">
                    <Phone size={16} className="text-red-500" />
                    <h2 className="font-semibold text-red-700">Call Queue</h2>
                    {subActionCount > 0 && (
                        <span className="ml-auto bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">
                            {subActionCount} pending
                        </span>
                    )}
                </div>
                {actionQueue.length === 0 ? (
                    <div className="px-6 py-10 text-center">
                        <CheckCircle size={32} className="text-green-400 mx-auto mb-2" />
                        <p className="text-sm text-gray-400">All clear — no pending calls.</p>
                    </div>
                ) : (
                    <div className="divide-y">
                        {actionQueue.map((t) => (
                            <div key={t.id} className="flex items-start gap-4 px-6 py-4 hover:bg-red-50/30">
                                <div className="shrink-0 mt-0.5"><Phone size={16} className="text-red-400" /></div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <Link href={`/tickets/${t.id}`} className="font-semibold text-blue-600 hover:underline text-sm">
                                            Ticket #{t.id}
                                        </Link>
                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.ticketSubStatus!.color}`}>
                                            {t.ticketSubStatus!.label}
                                        </span>
                                        <span className="text-xs text-gray-400">{timeAgo(t.updatedAt)}</span>
                                    </div>
                                    <p className="text-sm font-medium text-gray-800 mt-1">
                                        {(t.device.customer ?? t.device.company)?.name}
                                        <span className="text-gray-400 font-normal"> · {(t.device.customer ?? t.device.company)?.phone}</span>
                                    </p>
                                    <p className="text-xs text-gray-500 mt-0.5">
                                        {t.device.brand} {t.device.model}
                                        {t.primaryOwner && <span className="ml-2 text-gray-400">· Tech: {t.primaryOwner.name}</span>}
                                    </p>
                                    {t.ticketSubStatus!.actionLabel && (
                                        <p className="text-xs text-red-600 mt-1 font-medium">→ {t.ticketSubStatus!.actionLabel}</p>
                                    )}
                                </div>
                                <Link href={`/tickets/${t.id}`} className="shrink-0 text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700">Open</Link>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {statusQueue.length === 0 && actionQueue.length === 0 && (
                <div className="px-6 py-10 text-center bg-white rounded-xl shadow">
                    <CheckCircle size={32} className="text-green-400 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">All clear — no pending actions.</p>
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
                device: { include: { customer: true, company: true } },
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
                device: { include: { customer: true, company: true } },
                ticketStatus: { select: { label: true, color: true, actionLabel: true } },
                serviceCenter: { select: { name: true } },
            },
        }),
    ]);

    return (
        <div>
            <h1 className="text-2xl font-bold mb-1">Despatch</h1>
            <p className="text-gray-400 text-sm mb-6">
                Welcome back, {name}
                {context.pipelineLabel ? ` · ${context.pipelineLabel}` : ""}
            </p>

            <div className="grid grid-cols-3 gap-4 mb-8">
                <div className="bg-white rounded-xl shadow p-5 flex items-center gap-4">
                    <div className="text-gray-400"><Package size={22} /></div>
                    <div>
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Pending Action</p>
                        <p className={`text-3xl font-bold mt-0.5 ${pendingCount > 0 ? "text-orange-600" : "text-gray-800"}`}>{pendingCount}</p>
                    </div>
                </div>
                <div className="bg-white rounded-xl shadow p-5 flex items-center gap-4">
                    <div className="text-gray-400"><AlertCircle size={22} /></div>
                    <div>
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Escalated (In Repair)</p>
                        <p className="text-3xl font-bold mt-0.5 text-blue-600">{inTransitCount}</p>
                    </div>
                </div>
            </div>

            {statusQueue.length > 0 && (
                <div className="bg-white rounded-xl shadow overflow-hidden mb-6">
                    <div className="px-6 py-4 border-b bg-orange-50 flex items-center gap-2">
                        <Package size={16} className="text-orange-500" />
                        <h2 className="font-semibold text-orange-700">Status Actions</h2>
                        <span className="ml-auto bg-orange-100 text-orange-700 text-xs font-bold px-2 py-0.5 rounded-full">
                            {statusQueue.length} pending
                        </span>
                    </div>
                    <div className="divide-y">
                        {statusQueue.map((t) => (
                            <div key={t.id} className="flex items-start gap-4 px-6 py-4 hover:bg-orange-50/30">
                                <Package size={16} className="text-orange-400 mt-0.5 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <Link href={`/tickets/${t.id}`} className="font-semibold text-blue-600 hover:underline text-sm">
                                            Ticket #{t.id}
                                        </Link>
                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.ticketStatus.color}`}>
                                            {t.ticketStatus.label}
                                        </span>
                                        <span className="text-xs text-gray-400">{timeAgo(t.updatedAt)}</span>
                                    </div>
                                    <p className="text-sm font-medium text-gray-800 mt-1">
                                        {t.device.brand} {t.device.model}
                                        <span className="text-gray-400 font-normal text-xs ml-2">· {(t.device.customer ?? t.device.company)?.name}</span>
                                    </p>
                                    {t.serviceCenter && (
                                        <p className="text-xs text-gray-500 mt-0.5">Service Centre: {t.serviceCenter.name}</p>
                                    )}
                                    {t.ticketStatus.actionLabel && (
                                        <p className="text-xs text-orange-600 mt-1 font-medium">→ {t.ticketStatus.actionLabel}</p>
                                    )}
                                </div>
                                <Link href={`/tickets/${t.id}`} className="shrink-0 text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700">Open</Link>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="bg-white rounded-xl shadow overflow-hidden">
                <div className="px-6 py-4 border-b bg-orange-50 flex items-center gap-2">
                    <Package size={16} className="text-orange-500" />
                    <h2 className="font-semibold text-orange-700">Despatch Queue</h2>
                    {subPendingCount > 0 && (
                        <span className="ml-auto bg-orange-100 text-orange-700 text-xs font-bold px-2 py-0.5 rounded-full">
                            {subPendingCount} pending
                        </span>
                    )}
                </div>
                {pendingQueue.length === 0 ? (
                    <div className="px-6 py-10 text-center">
                        <CheckCircle size={32} className="text-green-400 mx-auto mb-2" />
                        <p className="text-sm text-gray-400">No pending despatch tasks.</p>
                    </div>
                ) : (
                    <div className="divide-y">
                        {pendingQueue.map((t) => (
                            <div key={t.id} className="flex items-start gap-4 px-6 py-4 hover:bg-orange-50/30">
                                <Package size={16} className="text-orange-400 mt-0.5 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <Link href={`/tickets/${t.id}`} className="font-semibold text-blue-600 hover:underline text-sm">
                                            Ticket #{t.id}
                                        </Link>
                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.ticketSubStatus!.color}`}>
                                            {t.ticketSubStatus!.label}
                                        </span>
                                        <span className="text-xs text-gray-400">{timeAgo(t.updatedAt)}</span>
                                    </div>
                                    <p className="text-sm font-medium text-gray-800 mt-1">
                                        {t.device.brand} {t.device.model}
                                        <span className="text-gray-400 font-normal text-xs ml-2">· {(t.device.customer ?? t.device.company)?.name}</span>
                                    </p>
                                    {t.serviceCenter && (
                                        <p className="text-xs text-gray-500 mt-0.5">Service Centre: {t.serviceCenter.name}</p>
                                    )}
                                    {t.primaryOwner && (
                                        <p className="text-xs text-gray-400">Technician: {t.primaryOwner.name}</p>
                                    )}
                                    {t.ticketSubStatus!.actionLabel && (
                                        <p className="text-xs text-orange-600 mt-1 font-medium">→ {t.ticketSubStatus!.actionLabel}</p>
                                    )}
                                </div>
                                <Link href={`/tickets/${t.id}`} className="shrink-0 text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700">Open</Link>
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
        ticketsHref: selectedPipeline ? `/tickets?pipeline=${selectedPipeline.id}` : "/tickets",
    };

    if (permissions.includes("admin:bypass")) return <AdminDashboardServer name={name} context={context} />;
    if (permissions.includes("warranty:convert")) return <TechnicianDashboardServer name={name} userId={userId} context={context} />;
    if (permissions.includes("tickets:create")) return <FrontDeskDashboard name={name} context={context} />;
    if (permissions.includes("tickets:substatus:set")) return <DespatchDashboard name={name} context={context} />;

    return <AdminDashboardServer name={name} context={context} />;
}
