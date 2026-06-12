import { prisma } from "@/shared/lib/prisma/prismaClient";
import { auth } from "@/auth";
import { badgeColor } from "@/shared/lib/format/entityColor";
import Link from "next/link";
import { Wrench, AlertCircle, UserX, Inbox } from "lucide-react";
import { timeAgo } from "@/shared/lib/format/timeAgo";
import { getRepairPipeline } from "@/modules/repairing/lib/repairPipeline";
import { selectPrimaryPhone } from "@/shared/lib/prisma/fragments";

// TODO(rbac): repairing is temporarily open to all authenticated staff and shows a
// single shared overview. The old role/permission-keyed dashboards (Admin / Technician
// / Front Desk / Despatch) and per-branch scope were removed pending the RBAC re-wire
// on the Position model. Re-introduce role/scope-aware views then.

export default async function RepairingDashboardPage() {
    const session = await auth();
    const name = session?.user?.name ?? "there";

    const pipeline = await getRepairPipeline(prisma);
    const pipelineId = pipeline?.id ?? "P1";
    const base = { pipelineId };

    const [statuses, total, open, unassigned, escalated, activeTickets] = await Promise.all([
        prisma.ticketStatus.findMany({
            where: { isTerminal: false, OR: [{ pipelineId }, { pipelineId: null }] },
            orderBy: { order: "asc" },
            select: { id: true, label: true, color: true },
        }),
        prisma.ticket.count({ where: base }),
        prisma.ticket.count({ where: { ...base, ticketStatus: { isTerminal: false } } }),
        prisma.ticket.count({ where: { ...base, primaryOwnerId: null, ticketStatus: { isTerminal: false } } }),
        prisma.ticket.count({ where: { ...base, escalated: true, ticketStatus: { isTerminal: false } } }),
        prisma.ticket.findMany({
            where: { ...base, ticketStatus: { isTerminal: false } },
            orderBy: { updatedAt: "desc" },
            take: 50,
            include: {
                device: {
                    include: {
                        account: {
                            include: {
                                person: { select: { name: true, phones: selectPrimaryPhone } },
                                company: { select: { name: true, phones: selectPrimaryPhone } },
                            },
                        },
                    },
                },
                primaryOwner: { select: { name: true } },
                ticketStatus: { select: { label: true, color: true } },
                ticketSubStatus: { select: { label: true, color: true } },
            },
        }),
    ]);

    const statusCounts = await Promise.all(
        statuses.map(async (s) => ({
            ...s,
            count: await prisma.ticket.count({ where: { ...base, status: s.id } }),
        }))
    );

    const stats = [
        { label: "Open", value: open, icon: Wrench, tone: "text-primary" },
        { label: "Unassigned", value: unassigned, icon: UserX, tone: unassigned > 0 ? "text-destructive" : "text-foreground" },
        { label: "At Service Centre", value: escalated, icon: AlertCircle, tone: "text-foreground" },
        { label: "Total", value: total, icon: Inbox, tone: "text-foreground" },
    ];

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold mb-1">Repairs</h1>
                    <p className="text-muted-foreground text-sm">Welcome back, {name}</p>
                </div>
                <Link
                    href="/office/repairing/tickets"
                    className="rounded-md border border-primary bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
                >
                    All Tickets
                </Link>
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {stats.map((s) => (
                    <div key={s.label} className="flex items-center gap-4 rounded-lg border border-border bg-card p-5 shadow">
                        <s.icon size={22} className="text-muted-foreground" />
                        <div>
                            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{s.label}</p>
                            <p className={`text-3xl font-bold mt-0.5 ${s.tone}`}>{s.value}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Status funnel */}
            {statusCounts.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {statusCounts.map((s) => (
                        <span key={s.id} className={`rounded-md border border-border px-3 py-1.5 text-xs font-medium ${s.color}`}>
                            {s.label} · {s.count}
                        </span>
                    ))}
                </div>
            )}

            {/* Active tickets */}
            <div className="overflow-hidden rounded-lg border border-border shadow">
                <div className="flex items-center gap-2 border-b border-border bg-muted px-6 py-4">
                    <Wrench size={16} className="text-muted-foreground" />
                    <h2 className="font-semibold text-foreground">Active Tickets</h2>
                    <span className="ml-auto text-xs text-muted-foreground">{activeTickets.length} shown</span>
                </div>
                {activeTickets.length === 0 ? (
                    <div className="px-6 py-10 text-center text-sm text-muted-foreground">No active tickets.</div>
                ) : (
                    <div className="divide-y divide-border">
                        {activeTickets.map((t) => {
                            const party = t.device.account?.person ?? t.device.account?.company ?? null;
                            return (
                                <Link
                                    key={t.id}
                                    href={`/office/repairing/tickets/${t.id}`}
                                    className="flex items-start gap-4 px-6 py-4 hover:bg-muted/40"
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-semibold text-primary text-sm">Ticket #{t.id}</span>
                                            <span className={`text-xs px-2 py-0.5 font-medium ${t.ticketStatus.color}`}>
                                                {t.ticketStatus.label}
                                            </span>
                                            {t.ticketSubStatus && (
                                                <span className={`text-xs px-2 py-0.5 font-medium ${badgeColor(t.ticketSubStatus.color).className}`} style={badgeColor(t.ticketSubStatus.color).style}>
                                                    {t.ticketSubStatus.label}
                                                </span>
                                            )}
                                            <span className="text-xs text-muted-foreground">{timeAgo(t.updatedAt)}</span>
                                        </div>
                                        <p className="text-sm font-medium text-foreground mt-1">
                                            {party?.name ?? "—"}
                                            <span className="text-muted-foreground font-normal text-xs ml-2">
                                                · {t.device.brand} {t.device.model}
                                            </span>
                                        </p>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            {t.primaryOwner ? `Tech: ${t.primaryOwner.name}` : "Unassigned"}
                                        </p>
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
