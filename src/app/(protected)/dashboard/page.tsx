import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import Link from "next/link";
import { Phone, Package, AlertCircle, Wrench, Clock, CheckCircle, ArrowRight } from "lucide-react";

function timeAgo(date: Date): string {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

function StatCard({
    label, value, color = "text-gray-800", icon,
}: {
    label: string; value: number | string; color?: string; icon?: React.ReactNode;
}) {
    return (
        <div className="bg-white rounded-xl shadow p-5 flex items-center gap-4">
            {icon && <div className="text-gray-400">{icon}</div>}
            <div>
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
                <p className={`text-3xl font-bold mt-0.5 ${color}`}>{value}</p>
            </div>
        </div>
    );
}

// ── Admin Dashboard ────────────────────────────────────────────────────────────
async function AdminDashboard({ name }: { name: string }) {
    const [total, open, escalated, ready, actionItems] = await Promise.all([
        prisma.ticket.count(),
        prisma.ticket.count({ where: { ticketStatus: { isTerminal: false } } }),
        prisma.ticket.count({ where: { escalated: true } }),
        prisma.ticket.count({ where: { status: "S6" } }),
        prisma.ticket.count({ where: { subStatusId: { not: null } } }),
    ]);

    const recentTickets = await prisma.ticket.findMany({
        take: 8,
        orderBy: { updatedAt: "desc" },
        include: {
            device: { include: { customer: true } },
            technician: { select: { name: true } },
            ticketStatus: { select: { label: true, color: true } },
            ticketSubStatus: { select: { label: true, color: true } },
        },
    });

    return (
        <div>
            <h1 className="text-2xl font-bold mb-1">Dashboard</h1>
            <p className="text-gray-400 text-sm mb-6">Welcome back, {name}</p>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <StatCard label="Total Tickets" value={total} icon={<Package size={22} />} />
                <StatCard label="Open" value={open} color="text-blue-600" icon={<Clock size={22} />} />
                <StatCard label="Escalated" value={escalated} color="text-orange-600" icon={<AlertCircle size={22} />} />
                <StatCard label="Ready for Pickup" value={ready} color="text-green-600" icon={<CheckCircle size={22} />} />
            </div>

            {actionItems > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-5 py-3 mb-6 flex items-center gap-3">
                    <AlertCircle size={16} className="text-yellow-600 shrink-0" />
                    <span className="text-sm text-yellow-800">
                        <strong>{actionItems}</strong> ticket{actionItems !== 1 ? "s" : ""} currently have an active sub-status pending team action.
                    </span>
                    <Link href="/tickets" className="ml-auto text-xs text-yellow-700 underline whitespace-nowrap">View all</Link>
                </div>
            )}

            <div className="bg-white rounded-xl shadow overflow-hidden">
                <div className="px-6 py-4 border-b flex items-center justify-between">
                    <h2 className="font-semibold text-gray-700">Recent Activity</h2>
                    <Link href="/tickets" className="text-xs text-blue-600 hover:underline">View all →</Link>
                </div>
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                        <tr>
                            <th className="px-5 py-3 text-left">#</th>
                            <th className="px-5 py-3 text-left">Customer</th>
                            <th className="px-5 py-3 text-left">Device</th>
                            <th className="px-5 py-3 text-left">Status</th>
                            <th className="px-5 py-3 text-left">Technician</th>
                            <th className="px-5 py-3 text-left">Updated</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {recentTickets.map((t) => (
                            <tr key={t.id} className="hover:bg-gray-50">
                                <td className="px-5 py-3">
                                    <Link href={`/tickets/${t.id}`} className="text-blue-600 font-medium hover:underline">#{t.id}</Link>
                                </td>
                                <td className="px-5 py-3 font-medium">{t.device.customer.name}</td>
                                <td className="px-5 py-3 text-gray-500">{t.device.brand} {t.device.model}</td>
                                <td className="px-5 py-3">
                                    <div className="flex flex-col gap-0.5">
                                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium w-fit ${t.ticketStatus.color}`}>
                                            {t.ticketStatus.label}
                                        </span>
                                        {t.ticketSubStatus && (
                                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium w-fit ${t.ticketSubStatus.color}`}>
                                                {t.ticketSubStatus.label}
                                            </span>
                                        )}
                                    </div>
                                </td>
                                <td className="px-5 py-3 text-gray-500">{t.technician?.name ?? "—"}</td>
                                <td className="px-5 py-3 text-gray-400 text-xs">{timeAgo(t.updatedAt)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ── Technician Dashboard ───────────────────────────────────────────────────────
async function TechnicianDashboard({ name, userId }: { name: string; userId: number }) {
    const [myActive, myWaiting, myEscalated] = await Promise.all([
        prisma.ticket.count({
            where: { technicianId: userId, ticketStatus: { isTerminal: false } },
        }),
        prisma.ticket.count({
            where: {
                technicianId: userId,
                subStatusId: { not: null },
                ticketStatus: { isTerminal: false },
            },
        }),
        prisma.ticket.count({
            where: { technicianId: userId, escalated: true },
        }),
    ]);

    const myTickets = await prisma.ticket.findMany({
        where: { technicianId: userId, ticketStatus: { isTerminal: false } },
        orderBy: { updatedAt: "asc" },
        include: {
            device: { include: { customer: true } },
            ticketStatus: { select: { label: true, color: true } },
            ticketSubStatus: { select: { label: true, color: true, notifyRoles: true } },
        },
    });

    const unassigned = await prisma.ticket.findMany({
        where: { technicianId: null, ticketStatus: { isTerminal: false } },
        orderBy: { createdAt: "asc" },
        take: 5,
        include: {
            device: { include: { customer: true } },
            ticketStatus: { select: { label: true, color: true } },
        },
    });

    return (
        <div>
            <h1 className="text-2xl font-bold mb-1">My Workbench</h1>
            <p className="text-gray-400 text-sm mb-6">Welcome back, {name}</p>

            <div className="grid grid-cols-3 gap-4 mb-8">
                <StatCard label="My Active Tickets" value={myActive} color="text-blue-600" icon={<Wrench size={22} />} />
                <StatCard label="Awaiting Response" value={myWaiting} color="text-yellow-600" icon={<Clock size={22} />} />
                <StatCard label="Escalated" value={myEscalated} color="text-orange-600" icon={<AlertCircle size={22} />} />
            </div>

            {/* My tickets */}
            <div className="bg-white rounded-xl shadow overflow-hidden mb-6">
                <div className="px-6 py-4 border-b">
                    <h2 className="font-semibold text-gray-700">My Tickets</h2>
                </div>
                {myTickets.length === 0 ? (
                    <p className="px-6 py-8 text-sm text-gray-400 text-center">No active tickets assigned to you.</p>
                ) : (
                    <div className="divide-y">
                        {myTickets.map((t) => {
                            const waitingFrontDesk = t.ticketSubStatus?.notifyRoles.includes("R3");
                            const waitingDespatch = t.ticketSubStatus?.notifyRoles.includes("R4");
                            return (
                                <div key={t.id} className={`flex items-center gap-4 px-6 py-3.5 hover:bg-gray-50 ${waitingFrontDesk || waitingDespatch ? "bg-yellow-50/50" : ""}`}>
                                    <Link href={`/tickets/${t.id}`} className="text-blue-600 font-semibold text-sm w-10 shrink-0">#{t.id}</Link>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-gray-800 truncate">
                                            {t.device.customer.name} — {t.device.brand} {t.device.model}
                                        </p>
                                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.ticketStatus.color}`}>
                                                {t.ticketStatus.label}
                                            </span>
                                            {t.ticketSubStatus && (
                                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.ticketSubStatus.color}`}>
                                                    {t.ticketSubStatus.label}
                                                </span>
                                            )}
                                            {waitingFrontDesk && (
                                                <span className="text-xs text-yellow-700 bg-yellow-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                                                    <Phone size={10} /> Waiting: Front Desk
                                                </span>
                                            )}
                                            {waitingDespatch && (
                                                <span className="text-xs text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                                                    <Package size={10} /> Waiting: Despatch
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <span className="text-xs text-gray-400 shrink-0">{timeAgo(t.updatedAt)}</span>
                                    <Link href={`/tickets/${t.id}`} className="text-gray-400 hover:text-blue-600">
                                        <ArrowRight size={16} />
                                    </Link>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Unassigned tickets */}
            {unassigned.length > 0 && (
                <div className="bg-white rounded-xl shadow overflow-hidden">
                    <div className="px-6 py-4 border-b">
                        <h2 className="font-semibold text-gray-700">Unassigned Tickets</h2>
                        <p className="text-xs text-gray-400 mt-0.5">Open tickets with no technician assigned</p>
                    </div>
                    <div className="divide-y">
                        {unassigned.map((t) => (
                            <div key={t.id} className="flex items-center gap-4 px-6 py-3.5 hover:bg-gray-50">
                                <Link href={`/tickets/${t.id}`} className="text-blue-600 font-semibold text-sm w-10 shrink-0">#{t.id}</Link>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-gray-800 truncate">
                                        {t.device.customer.name} — {t.device.brand} {t.device.model}
                                    </p>
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.ticketStatus.color}`}>
                                        {t.ticketStatus.label}
                                    </span>
                                </div>
                                <span className="text-xs text-gray-400">{timeAgo(t.createdAt)}</span>
                                <Link href={`/tickets/${t.id}`} className="text-gray-400 hover:text-blue-600"><ArrowRight size={16} /></Link>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Front Desk Dashboard ───────────────────────────────────────────────────────
async function FrontDeskDashboard({ name }: { name: string }) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [actionCount, newToday, readyCount] = await Promise.all([
        prisma.ticket.count({
            where: { subStatusId: { not: null }, ticketSubStatus: { notifyRoles: { has: "R3" } } },
        }),
        prisma.ticket.count({ where: { createdAt: { gte: today } } }),
        prisma.ticket.count({ where: { status: "S6" } }),
    ]);

    const actionQueue = await prisma.ticket.findMany({
        where: { subStatusId: { not: null }, ticketSubStatus: { notifyRoles: { has: "R3" } } },
        orderBy: { updatedAt: "asc" },
        include: {
            device: { include: { customer: true } },
            ticketStatus: { select: { label: true, color: true } },
            ticketSubStatus: { select: { id: true, label: true, color: true } },
            technician: { select: { name: true } },
        },
    });

    const readyTickets = await prisma.ticket.findMany({
        where: { status: "S6" },
        orderBy: { updatedAt: "asc" },
        take: 10,
        include: {
            device: { include: { customer: true } },
            ticketStatus: { select: { label: true, color: true } },
            ticketSubStatus: { select: { label: true, color: true } },
        },
    });

    const ACTION_LABELS: Record<string, string> = {
        SS1:  "Call customer — needs to provide information",
        SS2:  "Call customer — needs to bring item",
        SS5:  "Call customer — quote ready for approval",
        SS11: "Inform customer — parts delayed",
        SS12: "Inform customer — parts issue, decision needed",
        SS15: "Notify customer — device is ready to collect",
        SS17: "Call customer — partial fix, decision needed",
        SS32: "Call customer — beyond economical repair",
    };

    return (
        <div>
            <h1 className="text-2xl font-bold mb-1">Front Desk</h1>
            <p className="text-gray-400 text-sm mb-6">Welcome back, {name}</p>

            <div className="grid grid-cols-3 gap-4 mb-8">
                <StatCard label="Action Required" value={actionCount} color={actionCount > 0 ? "text-red-600" : "text-gray-800"} icon={<Phone size={22} />} />
                <StatCard label="New Today" value={newToday} color="text-blue-600" icon={<Package size={22} />} />
                <StatCard label="Ready for Collection" value={readyCount} color="text-green-600" icon={<CheckCircle size={22} />} />
            </div>

            {/* Action Queue */}
            <div className="bg-white rounded-xl shadow overflow-hidden mb-6">
                <div className="px-6 py-4 border-b bg-red-50 flex items-center gap-2">
                    <Phone size={16} className="text-red-500" />
                    <h2 className="font-semibold text-red-700">Action Required — Call Queue</h2>
                    {actionCount > 0 && (
                        <span className="ml-auto bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">
                            {actionCount} pending
                        </span>
                    )}
                </div>
                {actionQueue.length === 0 ? (
                    <div className="px-6 py-10 text-center">
                        <CheckCircle size={32} className="text-green-400 mx-auto mb-2" />
                        <p className="text-sm text-gray-400">All clear — no pending actions.</p>
                    </div>
                ) : (
                    <div className="divide-y">
                        {actionQueue.map((t) => (
                            <div key={t.id} className="flex items-start gap-4 px-6 py-4 hover:bg-red-50/30">
                                <div className="shrink-0 mt-0.5">
                                    <Phone size={16} className="text-red-400" />
                                </div>
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
                                        {t.device.customer.name}
                                        <span className="text-gray-400 font-normal"> · {t.device.customer.phone}</span>
                                    </p>
                                    <p className="text-xs text-gray-500 mt-0.5">
                                        {t.device.brand} {t.device.model}
                                        {t.technician && <span className="ml-2 text-gray-400">· Tech: {t.technician.name}</span>}
                                    </p>
                                    {ACTION_LABELS[t.ticketSubStatus!.id] && (
                                        <p className="text-xs text-red-600 mt-1 font-medium">
                                            → {ACTION_LABELS[t.ticketSubStatus!.id]}
                                        </p>
                                    )}
                                </div>
                                <Link href={`/tickets/${t.id}`} className="shrink-0 text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700">
                                    Open
                                </Link>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Ready for collection */}
            {readyTickets.length > 0 && (
                <div className="bg-white rounded-xl shadow overflow-hidden">
                    <div className="px-6 py-4 border-b bg-green-50 flex items-center gap-2">
                        <CheckCircle size={16} className="text-green-600" />
                        <h2 className="font-semibold text-green-700">Ready for Collection</h2>
                    </div>
                    <div className="divide-y">
                        {readyTickets.map((t) => (
                            <div key={t.id} className="flex items-center gap-4 px-6 py-3.5 hover:bg-gray-50">
                                <Link href={`/tickets/${t.id}`} className="text-blue-600 font-semibold text-sm w-10 shrink-0">#{t.id}</Link>
                                <div className="flex-1">
                                    <p className="text-sm font-medium">{t.device.customer.name}
                                        <span className="text-gray-400 font-normal text-xs ml-2">{t.device.customer.phone}</span>
                                    </p>
                                    <p className="text-xs text-gray-500">{t.device.brand} {t.device.model}</p>
                                </div>
                                <span className="text-xs text-gray-400">{timeAgo(t.updatedAt)}</span>
                                <Link href={`/tickets/${t.id}`} className="text-gray-400 hover:text-blue-600"><ArrowRight size={16} /></Link>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Despatch Dashboard ─────────────────────────────────────────────────────────
async function DespatchDashboard({ name }: { name: string }) {
    const [pendingCount, inTransitCount] = await Promise.all([
        prisma.ticket.count({
            where: { subStatusId: { not: null }, ticketSubStatus: { notifyRoles: { has: "R4" } } },
        }),
        prisma.ticket.count({ where: { escalated: true, status: "S4" } }),
    ]);

    const pendingQueue = await prisma.ticket.findMany({
        where: { subStatusId: { not: null }, ticketSubStatus: { notifyRoles: { has: "R4" } } },
        orderBy: { updatedAt: "asc" },
        include: {
            device: { include: { customer: true } },
            ticketStatus: { select: { label: true, color: true } },
            ticketSubStatus: { select: { id: true, label: true, color: true } },
            serviceCenter: { select: { name: true } },
            technician: { select: { name: true } },
        },
    });

    const DESPATCH_ACTIONS: Record<string, string> = {
        SS22: "Pack device and arrange courier to service centre",
        SS27: "Await incoming delivery from service centre",
    };

    return (
        <div>
            <h1 className="text-2xl font-bold mb-1">Despatch</h1>
            <p className="text-gray-400 text-sm mb-6">Welcome back, {name}</p>

            <div className="grid grid-cols-2 gap-4 mb-8">
                <StatCard label="Pending Action" value={pendingCount} color={pendingCount > 0 ? "text-orange-600" : "text-gray-800"} icon={<Package size={22} />} />
                <StatCard label="Escalated (In Repair)" value={inTransitCount} color="text-blue-600" icon={<AlertCircle size={22} />} />
            </div>

            <div className="bg-white rounded-xl shadow overflow-hidden">
                <div className="px-6 py-4 border-b bg-orange-50 flex items-center gap-2">
                    <Package size={16} className="text-orange-500" />
                    <h2 className="font-semibold text-orange-700">Despatch Queue</h2>
                    {pendingCount > 0 && (
                        <span className="ml-auto bg-orange-100 text-orange-700 text-xs font-bold px-2 py-0.5 rounded-full">
                            {pendingCount} pending
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
                                        <span className="text-gray-400 font-normal text-xs ml-2">· {t.device.customer.name}</span>
                                    </p>
                                    {t.serviceCenter && (
                                        <p className="text-xs text-gray-500 mt-0.5">Service Centre: {t.serviceCenter.name}</p>
                                    )}
                                    {t.technician && (
                                        <p className="text-xs text-gray-400">Technician: {t.technician.name}</p>
                                    )}
                                    {DESPATCH_ACTIONS[t.ticketSubStatus!.id] && (
                                        <p className="text-xs text-orange-600 mt-1 font-medium">
                                            → {DESPATCH_ACTIONS[t.ticketSubStatus!.id]}
                                        </p>
                                    )}
                                </div>
                                <Link href={`/tickets/${t.id}`} className="shrink-0 text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700">
                                    Open
                                </Link>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Router ─────────────────────────────────────────────────────────────────────
export default async function DashboardPage() {
    const session = await auth();
    const role = (session?.user as { role?: string })?.role ?? "";
    const name = session?.user?.name ?? "there";
    const userId = Number((session?.user as { id?: string })?.id ?? "0");

    if (role === "R2") return <TechnicianDashboard name={name} userId={userId} />;
    if (role === "R3") return <FrontDeskDashboard name={name} />;
    if (role === "R4") return <DespatchDashboard name={name} />;
    return <AdminDashboard name={name} />;
}
