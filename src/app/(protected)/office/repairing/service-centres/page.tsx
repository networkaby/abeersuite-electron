import { prisma } from "@/shared/lib/prisma/prismaClient";
import Link from "next/link";
import { Truck, Package, ArrowLeft } from "lucide-react";
import { timeAgo } from "@/shared/lib/format/timeAgo";
import { getRepairPipeline } from "@/modules/repairing/lib/repairPipeline";
import { WORKFLOW_STATUS } from "@/shared/lib/constants/workflow";

// Where every open device physically is — the ones still IN HAND at the shop and
// the ones OUT at a service centre, grouped by the latest shipping-slip party.
// Reached from the Repairs dashboard "In hand" / "At Service Centre" cards.
export default async function ServiceCentresPage() {
    const pipeline = await getRepairPipeline(prisma);
    const pipelineId = pipeline?.id ?? "P1";

    const tickets = await prisma.ticket.findMany({
        where: { pipelineId, ticketStatus: { isTerminal: false } },
        orderBy: { updatedAt: "desc" },
        include: {
            repair: {
                include: {
                    device: {
                        include: {
                            account: {
                                include: {
                                    person: { select: { name: true } },
                                    company: { select: { name: true } },
                                },
                            },
                        },
                    },
                },
            },
            ticketStatus: { select: { label: true } },
        },
    });

    type Item = { id: number; customer: string; device: string; problem: string; ref: string | null; note: string | null; at: string | null };
    type Slip = { partyName?: string; ref?: string | null; date?: string; createdAt?: string };

    const inHand: Item[] = [];
    const byCentre = new Map<string, Item[]>();

    for (const t of tickets) {
        const dev = t.repair?.device;
        const acct = dev?.account;
        const base: Omit<Item, "ref" | "note" | "at"> = {
            id: t.id,
            customer: acct?.person?.name ?? acct?.company?.name ?? "—",
            device: `${dev?.brand ?? ""} ${dev?.model ?? ""}`.trim() || "—",
            problem: dev?.problem ?? "",
        };

        if (WORKFLOW_STATUS.atServiceCentre.includes(t.status)) {
            const ctx = (t.context && typeof t.context === "object" && !Array.isArray(t.context) ? t.context : {}) as {
                shippingSlips?: Slip[]; shippingSlip?: Slip;
            };
            const slips = Array.isArray(ctx.shippingSlips) ? ctx.shippingSlips : ctx.shippingSlip ? [ctx.shippingSlip] : [];
            const slip = slips.length ? slips[slips.length - 1] : null;
            const centre = slip?.partyName ?? "Unknown centre";
            const list = byCentre.get(centre) ?? [];
            list.push({ ...base, ref: slip?.ref ?? null, note: null, at: slip?.date ?? slip?.createdAt ?? null });
            byCentre.set(centre, list);
        } else {
            inHand.push({ ...base, ref: null, note: t.ticketStatus.label, at: t.updatedAt.toISOString() });
        }
    }

    // Within a centre, longest-pending device first (oldest send date on top).
    for (const list of byCentre.values()) {
        list.sort((a, b) => (a.at ? new Date(a.at).getTime() : Infinity) - (b.at ? new Date(b.at).getTime() : Infinity));
    }
    // Busiest centre first; the catch-all "Unknown centre" always sinks to the end.
    const centres = Array.from(byCentre.entries()).sort((a, b) =>
        a[0] === "Unknown centre" ? 1 : b[0] === "Unknown centre" ? -1 : b[1].length - a[1].length
    );
    const outCount = tickets.length - inHand.length;

    return (
        <div className="space-y-6">
            <div>
                <Link href="/office/repairing" className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    <ArrowLeft size={12} /> Repairs
                </Link>
                <h1 className="text-2xl font-bold">Device Locations</h1>
                <p className="text-sm text-muted-foreground">
                    {inHand.length} in hand · {outCount} out across {centres.length} centre{centres.length === 1 ? "" : "s"}
                </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {/* In hand — devices still at the shop */}
                <LocationCard
                    title="In hand"
                    subtitle="at the shop"
                    icon={<Package size={15} className="text-muted-foreground" />}
                    items={inHand}
                    emptyText="No devices in hand."
                />

                {/* One card per service centre — shows how long each device has been pending */}
                {centres.map(([centre, items]) => (
                    <LocationCard
                        key={centre}
                        title={centre}
                        icon={<Truck size={15} className="text-muted-foreground" />}
                        items={items}
                        showPending
                    />
                ))}
            </div>
        </div>
    );
}

// How long a device has been pending at the centre, coloured by age: neutral
// under 3 days, amber 3–6, red from a week — so a stuck device stands out.
function pendingLabel(iso: string | null): { text: string; cls: string } | null {
    if (!iso) return null;
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    const text = days <= 0 ? "Pending today" : `Pending ${days}d`;
    const cls = days >= 7
        ? "bg-red-600 text-white"
        : days >= 3
        ? "bg-amber-500 text-white"
        : "bg-muted text-foreground";
    return { text, cls };
}

function LocationCard({
    title, subtitle, icon, items, emptyText, showPending = false,
}: {
    title: string;
    subtitle?: string;
    icon: React.ReactNode;
    items: { id: number; customer: string; device: string; problem: string; ref: string | null; note: string | null; at: string | null }[];
    emptyText?: string;
    showPending?: boolean;
}) {
    return (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow">
            <div className="flex items-center gap-2 border-b border-border bg-muted px-4 py-3">
                {icon}
                <h2 className="truncate font-semibold text-foreground">{title}</h2>
                {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
                <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">{items.length}</span>
            </div>
            {items.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">{emptyText ?? "None."}</p>
            ) : (
                <ul className="divide-y divide-border">
                    {items.map((it) => (
                        <li key={it.id} className="px-4 py-3 text-sm">
                            <div className="flex items-center justify-between gap-2">
                                <Link href={`/office/repairing/tickets/${it.id}`} className="font-semibold text-primary hover:underline">
                                    #{it.id}
                                </Link>
                                {showPending ? (
                                    (() => {
                                        const p = pendingLabel(it.at);
                                        return p
                                            ? <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${p.cls}`}>{p.text}</span>
                                            : <span className="text-xs text-muted-foreground">Pending —</span>;
                                    })()
                                ) : (
                                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                                        {it.note && <span>{it.note}</span>}
                                        {it.at && <span>{timeAgo(it.at)}</span>}
                                    </span>
                                )}
                            </div>
                            <p className="mt-0.5 font-medium text-foreground">
                                {it.device} <span className="text-xs font-normal text-muted-foreground">· {it.customer}</span>
                            </p>
                            {it.problem && <p className="text-xs text-muted-foreground">{it.problem}</p>}
                            {it.ref && <p className="text-xs text-muted-foreground">Ref: {it.ref}</p>}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
