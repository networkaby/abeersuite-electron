import { prisma } from "@/shared/lib/prisma/prismaClient";
import { auth } from "@/auth";
import { badgeColor } from "@/shared/lib/format/entityColor";
import Link from "next/link";
import { Wrench, Inbox, Package, Truck, Zap } from "lucide-react";
import { timeAgo } from "@/shared/lib/format/timeAgo";
import { getRepairPipeline } from "@/modules/repairing/lib/repairPipeline";
import { selectPrimaryPhone } from "@/shared/lib/prisma/fragments";
import { WORKFLOW_STATUS } from "@/shared/lib/constants/workflow";
import { PRIORITY_META } from "@/utils/constants";

// TODO(rbac): repairing is temporarily open to all authenticated staff and shows a
// single shared overview. The old role/permission-keyed dashboards (Admin / Technician
// / Front Desk / Despatch) and per-branch scope were removed pending the RBAC re-wire
// on the Position model. Re-introduce role/scope-aware views then.

export default async function RepairingDashboardPage({
    searchParams,
}: {
    searchParams: Promise<{ status?: string; view?: string; centre?: string }>;
}) {
    const session = await auth();
    const name = session?.user?.name ?? "there";

    const { status: statusFilter, view, centre } = await searchParams;

    const pipeline = await getRepairPipeline(prisma);
    const pipelineId = pipeline?.id ?? "P1";
    const base = { pipelineId };

    // The Active-Tickets filter: a specific status chip wins; otherwise the "In hand"
    // / "At Service Centre" stat cards filter by the shipping-slip group (in vs out).
    const activeStatusWhere = statusFilter
        ? { status: statusFilter }
        : view === "at-service"
            ? { status: { in: WORKFLOW_STATUS.atServiceCentre } }
            : view === "in-hand"
                ? { status: { notIn: WORKFLOW_STATUS.atServiceCentre } }
                : {};

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
            where: { ...base, ticketStatus: { isTerminal: false }, ...activeStatusWhere },
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

    // Service-centre chips (only in the "At Service Centre" view): the centre lives
    // in the ticket's shipping-slip context (JSON, not queryable), so group the
    // fetched at-service tickets in JS. Each chip narrows the grid to one centre.
    const atServiceView = view === "at-service";
    const centreCounts = new Map<string, number>();
    if (atServiceView) {
        for (const t of activeTickets) {
            const loc = ticketLocation(t.status, t.context);
            if (loc.atCentre) centreCounts.set(loc.label, (centreCounts.get(loc.label) ?? 0) + 1);
        }
    }
    const centreList = Array.from(centreCounts.entries()).sort((a, b) =>
        a[0] === "Unknown centre" ? 1 : b[0] === "Unknown centre" ? -1 : b[1] - a[1]
    );
    // A chosen centre narrows the grid in JS (same JSON-context reason as above).
    const filteredTickets = atServiceView && centre
        ? activeTickets.filter((t) => ticketLocation(t.status, t.context).label === centre)
        : activeTickets;
    // Most urgent first — a stuck urgent ticket outranks a fresh one.
    const shownTickets = [...filteredTickets].sort(
        (a, b) => urgencyScore(b.priority, b.createdAt) - urgencyScore(a.priority, a.createdAt)
    );

    const anyFilter = Boolean(statusFilter || view);
    const stats = [
        { label: "Open", value: open, icon: Wrench, tone: "text-primary", href: "/office/repairing" as string | null, hint: anyFilter ? "show all →" : null as string | null, active: !anyFilter },
        { label: "In hand", value: inHand, icon: Package, tone: "text-foreground", href: view === "in-hand" ? "/office/repairing" : "/office/repairing?view=in-hand", hint: "at the shop", active: view === "in-hand" },
        { label: "At Service Centre", value: atServiceCentre, icon: Truck, tone: "text-foreground", href: view === "at-service" ? "/office/repairing" : "/office/repairing?view=at-service", hint: "out at centres", active: view === "at-service" },
        { label: "Total", value: total, icon: Inbox, tone: "text-foreground", href: null, hint: null, active: false },
    ];

    return (
        <div className="space-y-6 p-4">
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
                    const cls = `flex items-center gap-4 rounded-lg border bg-card p-5 shadow ${
                        s.active ? "border-primary ring-1 ring-primary" : "border-border"
                    }`;
                    return s.href ? (
                        <Link key={s.label} href={s.href} className={`${cls} transition-colors hover:border-primary/50 hover:bg-muted/40`}>
                            {inner}
                        </Link>
                    ) : (
                        <div key={s.label} className={cls}>{inner}</div>
                    );
                })}
            </div>

            {/* Status funnel — each chip filters the Active Tickets below; click the
                active one again (or "All") to clear. */}
            {statusCounts.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {statusCounts.map((s) => {
                        const active = statusFilter === s.id;
                        return (
                            <Link
                                key={s.id}
                                href={active ? "/office/repairing" : `/office/repairing?status=${s.id}`}
                                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${s.color} ${
                                    active ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/50"
                                }`}
                            >
                                {s.label} · {s.count}
                            </Link>
                        );
                    })}
                </div>
            )}

            {/* Service-centre chips — shown only in the "At Service Centre" view.
                Each narrows the grid to one centre; click the active one to clear. */}
            {atServiceView && centreList.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">Service centres</span>
                    {centreList.map(([name, count]) => {
                        const active = centre === name;
                        return (
                            <Link
                                key={name}
                                href={active ? "/office/repairing?view=at-service" : `/office/repairing?view=at-service&centre=${encodeURIComponent(name)}`}
                                className={`inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium text-foreground transition-colors ${
                                    active ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-border hover:border-primary/50"
                                }`}
                            >
                                <Truck size={12} className="text-muted-foreground" />
                                {name} · {count}
                            </Link>
                        );
                    })}
                </div>
            )}

            {/* Active tickets */}
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <Wrench size={16} className="text-muted-foreground" />
                    <h2 className="font-semibold text-foreground">Active Tickets</h2>
                    {anyFilter && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            · filtered by
                            <span className="font-medium text-foreground">
                                {statusFilter
                                    ? statusCounts.find((s) => s.id === statusFilter)?.label ?? statusFilter
                                    : view === "in-hand"
                                        ? "In hand"
                                        : centre
                                            ? `At Service Centre · ${centre}`
                                            : "At Service Centre"}
                            </span>
                            <Link href="/office/repairing" className="text-primary hover:underline">clear</Link>
                        </span>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">{shownTickets.length} shown</span>
                </div>
                {shownTickets.length === 0 ? (
                    <div className="rounded-lg border border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground shadow">
                        {anyFilter ? "No active tickets in this view." : "No active tickets."}
                    </div>
                ) : (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {shownTickets.map((t) => {
                            const device = t.repair?.device ?? null;
                            const party = device?.account?.person ?? device?.account?.company ?? null;
                            const loc = ticketLocation(t.status, t.context);
                            const LocIcon = loc.atCentre ? Truck : Package;
                            const score = urgencyScore(t.priority, t.createdAt);
                            // One urgency tier drives the whole card: chip colour,
                            // left accent border, and background tint.
                            const tier = score >= 10
                                ? { chip: "bg-red-600 text-white", card: "border-l-4 border-l-red-600 bg-red-50/50 dark:bg-red-950/20" }
                                : score >= 5
                                    ? { chip: "bg-amber-500 text-white", card: "border-l-4 border-l-amber-500 bg-amber-50/50 dark:bg-amber-950/20" }
                                    : { chip: "bg-muted text-muted-foreground", card: "border-l-4 border-l-border bg-card" };
                            return (
                                <Link
                                    key={t.id}
                                    href={`/office/repairing/tickets/${t.id}`}
                                    className={`flex flex-col gap-2 rounded-lg border border-border p-4 shadow transition-colors hover:border-primary/50 hover:bg-muted/40 ${tier.card}`}
                                >
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
                                        {(t.priority === "HIGH" || t.priority === "URGENT") && (
                                            <span className={`text-xs px-2 py-0.5 font-medium ${PRIORITY_META[t.priority]?.color ?? ""}`}>
                                                {PRIORITY_META[t.priority]?.label ?? t.priority}
                                            </span>
                                        )}
                                        <span className="ml-auto flex items-center gap-1.5">
                                            <span
                                                title={`Urgency ${score} = ${PRIORITY_META[t.priority]?.label ?? t.priority} × ${ageDays(t.createdAt)}d old`}
                                                className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${tier.chip}`}
                                            >
                                                <Zap size={9} /> {score}
                                            </span>
                                            <span className="text-xs text-muted-foreground">{timeAgo(t.updatedAt)}</span>
                                        </span>
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-foreground truncate">
                                            {party?.name ?? "—"}
                                        </p>
                                        <p className="text-xs text-muted-foreground truncate">
                                            {device?.brand} {device?.model}{device?.type ? ` (${device.type})` : ""}
                                        </p>
                                        {device?.problem && (
                                            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{device.problem}</p>
                                        )}
                                    </div>
                                    {loc.atCentre && (
                                        <div className="mt-auto flex items-center gap-1 border-t border-border pt-2 text-xs font-medium text-foreground">
                                            <LocIcon size={12} className="text-muted-foreground" />
                                            <span className="truncate">At {loc.label}</span>
                                        </div>
                                    )}
                                </Link>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

// Where the device physically is — "In hand · at the shop" while we hold it, else
// the latest shipping-slip party (the service centre it was sent to). Mirrors the
// device-location page's grouping so the dashboard cards agree with it.
type SlipParty = { partyName?: string | null };
function ticketLocation(status: string, context: unknown): { label: string; atCentre: boolean } {
    if (!WORKFLOW_STATUS.atServiceCentre.includes(status)) return { label: "In hand · at the shop", atCentre: false };
    const ctx = (context && typeof context === "object" && !Array.isArray(context) ? context : {}) as {
        shippingSlips?: SlipParty[]; shippingSlip?: SlipParty;
    };
    const slips = Array.isArray(ctx.shippingSlips) ? ctx.shippingSlips : ctx.shippingSlip ? [ctx.shippingSlip] : [];
    const slip = slips.length ? slips[slips.length - 1] : null;
    return { label: slip?.partyName ?? "Unknown centre", atCentre: true };
}

// Urgency = priority weight × ticket age in days (e.g. 5-day-old Urgent = 5×3 = 15).
// Weights: Normal/Low = 1, High = 2, Urgent = 3. Age counts a fresh ticket as 1 day
// so priority still separates today's tickets. Drives the grid sort + the ⚡ chip.
const PRIORITY_WEIGHT: Record<string, number> = { LOW: 1, MEDIUM: 1, HIGH: 2, URGENT: 3 };
function ageDays(createdAt: Date): number {
    return Math.max(1, Math.floor((Date.now() - createdAt.getTime()) / 86_400_000));
}
function urgencyScore(priority: string, createdAt: Date): number {
    return (PRIORITY_WEIGHT[priority] ?? 1) * ageDays(createdAt);
}
