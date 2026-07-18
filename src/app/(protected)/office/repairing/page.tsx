import { prisma } from "@/shared/lib/prisma/prismaClient";
import { auth } from "@/auth";
import { badgeColor } from "@/shared/lib/format/entityColor";
import Link from "next/link";
import { Wrench, Inbox, Package, Truck } from "lucide-react";
import { timeAgo } from "@/shared/lib/format/timeAgo";
import { getRepairPipeline } from "@/modules/repairing/lib/repairPipeline";
import { selectPrimaryPhone } from "@/shared/lib/prisma/fragments";
import { WORKFLOW_STATUS } from "@/shared/lib/constants/workflow";

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

    const [statuses, total, open, atServiceCentre, activeTickets] = await Promise.all([
        prisma.ticketStatus.findMany({
            where: { isTerminal: false, OR: [{ pipelineId }, { pipelineId: null }] },
            orderBy: { order: "asc" },
            select: { id: true, label: true, color: true },
        }),
        prisma.ticket.count({ where: base }),
        prisma.ticket.count({ where: { ...base, ticketStatus: { isTerminal: false } } }),
        // "At service centre" = device currently out, by the new shipping-slip
        // concept: the ticket sits at a "sent to service" status (workflow
        // constant), not the retired repair.escalated flag which nothing sets.
        prisma.ticket.count({ where: { ...base, status: { in: WORKFLOW_STATUS.atServiceCentre }, ticketStatus: { isTerminal: false } } }),
        prisma.ticket.findMany({
            where: { ...base, ticketStatus: { isTerminal: false } },
            orderBy: { updatedAt: "desc" },
            take: 50,
            include: {
                repair: {
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
                    },
                },
                ticketStatus: { select: { label: true, color: true } },
                ticketWorker: { select: { label: true, color: true } },
            },
        }),
    ]);

    const statusCounts = await Promise.all(
        statuses.map(async (s) => ({
            ...s,
            count: await prisma.ticket.count({ where: { ...base, status: s.id } }),
        }))
    );

    // "In hand" = open devices we still physically hold (open minus the ones
    // currently out at a service centre). The per-centre breakdown lives on its
    // own page (click the At Service Centre card) to keep this dashboard compact.
    const inHand = Math.max(open - atServiceCentre, 0);

    const stats = [
        { label: "Open", value: open, icon: Wrench, tone: "text-primary", href: null as string | null, hint: null as string | null },
        { label: "In hand", value: inHand, icon: Package, tone: "text-foreground", href: "/office/repairing/service-centres", hint: "at the shop →" },
        { label: "At Service Centre", value: atServiceCentre, icon: Truck, tone: "text-foreground", href: "/office/repairing/service-centres", hint: "view by centre →" },
        { label: "Total", value: total, icon: Inbox, tone: "text-foreground", href: null, hint: null },
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
                {stats.map((s) => {
                    const inner = (
                        <>
                            <s.icon size={22} className="text-muted-foreground" />
                            <div>
                                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{s.label}</p>
                                <p className={`text-3xl font-bold mt-0.5 ${s.tone}`}>{s.value}</p>
                                {s.hint && <p className="text-xs text-muted-foreground">{s.hint}</p>}
                            </div>
                        </>
                    );
                    const cls = "flex items-center gap-4 rounded-lg border border-border bg-card p-5 shadow";
                    return s.href ? (
                        <Link key={s.label} href={s.href} className={`${cls} transition-colors hover:border-primary/50 hover:bg-muted/40`}>
                            {inner}
                        </Link>
                    ) : (
                        <div key={s.label} className={cls}>{inner}</div>
                    );
                })}
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
                            const device = t.repair?.device ?? null;
                            const party = device?.account?.person ?? device?.account?.company ?? null;
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
                                            {t.ticketWorker && (
                                                <span className={`text-xs px-2 py-0.5 font-medium ${badgeColor(t.ticketWorker.color).className}`} style={badgeColor(t.ticketWorker.color).style}>
                                                    {t.ticketWorker.label}
                                                </span>
                                            )}
                                            <span className="text-xs text-muted-foreground">{timeAgo(t.updatedAt)}</span>
                                        </div>
                                        <p className="text-sm font-medium text-foreground mt-1">
                                            {party?.name ?? "—"}
                                            <span className="text-muted-foreground font-normal text-xs ml-2">
                                                · {device?.brand} {device?.model}{device?.type ? ` (${device.type})` : ""}
                                            </span>
                                        </p>
                                        {device?.problem && (
                                            <p className="mt-0.5 truncate text-xs text-muted-foreground">{device.problem}</p>
                                        )}
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
