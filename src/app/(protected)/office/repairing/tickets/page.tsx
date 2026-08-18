"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Eye, Loader2, Search, X } from "lucide-react";
import { badgeColor } from "@/shared/lib/format/entityColor";
import Link from "next/link";
import { formatDate } from "@/shared/lib/format/formatDate";
import { REPAIR_PIPELINE_NAME } from "@/modules/repairing/lib/repairPipeline";
import { useMarkSurfaceSeen } from "@/shared/hooks/useNavCounts";
import { NAV_SURFACE } from "@/shared/lib/nav/navSurfaces";
import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";
import { useTicketsDelta, type TicketRow } from "@/modules/repairing/hooks/useTicketsDelta";
import WarrantyBadge from "@/modules/repairing/components/WarrantyBadge";
import { PRIORITY_META } from "@/utils/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

interface Ticket extends TicketRow {
    id: number;
    status: string;
    priority: string;
    escalated: boolean;
    isWarranty: boolean;
    warrantyStatus: string;
    createdAt: string;
    ticketStatus: { label: string; color: string };
    ticketWorker?: { label: string; color: string } | null;
    device: {
        type: string;
        brand: string;
        model: string;
        problem: string;
        account: { name: string; phone?: string | null } | null;
    };
    // Legacy escalation set a ServiceCenter master; the new shipping-slip flow
    // stores the centre as a Sundry-Creditor party name on context. Either can
    // be the "sent to" centre, so the filter reads both (slip wins).
    serviceCenter?: { name: string } | null;
    context?: { shippingSlip?: { partyName?: string | null } | null } | null;
}
type StatusOption = { id: string; label: string };
type PriorityOption = { id: string; label: string };

/** No pipeline named this can ever exist — a harmless placeholder that returns
 *  zero rows until the real repair-pipeline id has resolved, instead of the
 *  hook briefly fetching every pipeline's tickets on first mount. */
const PENDING_PIPELINE = "__pending__";

/** The centre a device was sent to — new shipping-slip party first, else the legacy ServiceCenter. */
const serviceCenterName = (t: Ticket) => t.context?.shippingSlip?.partyName ?? t.serviceCenter?.name ?? null;

export default function TicketsPage() {
    // Opening the board IS "looking at it" — clears this module's `new` sidebar badge.
    useMarkSurfaceSeen(NAV_SURFACE.repair);

    const [statusOptions, setStatusOptions] = useState<StatusOption[]>([]);
    const [priorityOptions, setPriorityOptions] = useState<PriorityOption[]>([]);
    const [repairPipelineId, setRepairPipelineId] = useState<string | null>(null);

    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("");
    const [priorityFilter, setPriorityFilter] = useState("");
    const [serviceCenterFilter, setServiceCenterFilter] = useState("");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [warrantyFilter, setWarrantyFilter] = useState("");

    useEffect(() => {
        axios.get("/api/priorities").then((r) => setPriorityOptions(r.data));
        axios.get("/api/pipelines").then((r) => {
            const repair = r.data.find((p: { name: string }) => p.name === REPAIR_PIPELINE_NAME);
            setRepairPipelineId(repair?.id ?? null);
        });
    }, []);

    useEffect(() => {
        if (!repairPipelineId) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setStatusOptions([]);
            return;
        }
        axios.get(`/api/ticket-statuses?pipelineId=${repairPipelineId}`).then((r) =>
            setStatusOptions(r.data.map((s: { id: string; label: string }) => ({ id: s.id, label: s.label })))
        );
    }, [repairPipelineId]);

    // Filters live server-side (see useTicketsDelta) except service centre, which
    // is a JSON/relation hybrid — filtered here over whatever's loaded so far.
    const { rows, loading, loadingMore, hasMore, error, stale, loadMore, reload } = useTicketsDelta<Ticket>({
        pipelineId: repairPipelineId ?? PENDING_PIPELINE,
        status:     statusFilter || undefined,
        priority:   priorityFilter || undefined,
        warranty:   warrantyFilter || undefined,
        from:       dateFrom || undefined,
        to:         dateTo || undefined,
        search,
    });

    const filtered = useMemo(
        () => (serviceCenterFilter ? rows.filter((t) => serviceCenterName(t) === serviceCenterFilter) : rows),
        [rows, serviceCenterFilter],
    );

    const clearFilters = () => {
        setSearch(""); setStatusFilter(""); setPriorityFilter("");
        setServiceCenterFilter("");
        setDateFrom(""); setDateTo(""); setWarrantyFilter("");
    };

    const hasFilters = Boolean(
        search || statusFilter || priorityFilter ||
        serviceCenterFilter || dateFrom || dateTo || warrantyFilter
    );

    // A chosen filter lights up so the user can see at a glance what is applied.
    const activeCls = (v: string) => (v ? "border-primary/60 text-foreground font-medium" : "");

    // Service-centre options come from the tickets loaded so far (either flow),
    // not a master list — a centre only used on older, not-yet-loaded tickets
    // won't appear until those load in.
    const serviceCenterOptions = Array.from(new Set(rows.map(serviceCenterName).filter(Boolean))) as string[];

    const sentinelRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        const node = sentinelRef.current;
        if (!node || !hasMore) return;
        const io = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting)) loadMore();
        }, { rootMargin: "200px" });
        io.observe(node);
        return () => io.disconnect();
    }, [hasMore, loadMore, rows.length]);

    return (
        <div className="flex h-full flex-col overflow-hidden">
            <PathBreadcrumb
                root={{ href: "/office/repairing", label: "Repairs" }}
                labels={{ tickets: "Tickets" }}
                escapeBack
            />
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
                {/* Search & Filters */}
                <div className="mb-4 space-y-3 rounded-lg border border-border bg-card p-4 shadow">
                    {/* Search */}
                    <div className="relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search by customer name, phone, device, ticket #..."
                            className="py-2 pl-9 pr-4"
                        />
                    </div>

                    {/* Filter Row — an active filter (value chosen) lights up with a
                    primary border + solid text so it stands out from empty ones. */}
                    <div className="flex flex-wrap gap-2 *:flex-1 *:min-w-40 *:max-w-65">
                        <Select value={statusFilter || "all"} onValueChange={(value) => setStatusFilter(value === "all" ? "" : value)}>
                            <SelectTrigger className={`w-full ${activeCls(statusFilter)}`}><SelectValue placeholder="All Status" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Status</SelectItem>
                                {statusOptions.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Select value={priorityFilter || "all"} onValueChange={(value) => setPriorityFilter(value === "all" ? "" : value)}>
                            <SelectTrigger className={`w-full ${activeCls(priorityFilter)}`}><SelectValue placeholder="All Priority" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Priority</SelectItem>
                                {priorityOptions.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Select value={serviceCenterFilter || "all"} onValueChange={(value) => setServiceCenterFilter(value === "all" ? "" : value)}>
                            <SelectTrigger className={`w-full ${activeCls(serviceCenterFilter)}`}><SelectValue placeholder="All Service Centers" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Service Centers</SelectItem>
                                {serviceCenterOptions.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Select value={warrantyFilter || "all"} onValueChange={(value) => setWarrantyFilter(value === "all" ? "" : value)}>
                            <SelectTrigger className={`w-full ${activeCls(warrantyFilter)}`}><SelectValue placeholder="All Warranty" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Warranty</SelectItem>
                                <SelectItem value="warranty">Warranty only</SelectItem>
                                <SelectItem value="non_warranty">Non-warranty only</SelectItem>
                            </SelectContent>
                        </Select>
                        <TallyDateInput value={dateFrom} onValueChange={setDateFrom} placeholder="From date" className={activeCls(dateFrom)} />
                        <TallyDateInput value={dateTo} onValueChange={setDateTo} monthMode="end" placeholder="To date" className={activeCls(dateTo)} />
                    </div>

                    {/* Results count + clear */}
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>
                            <span className="font-medium text-foreground">{filtered.length}</span> ticket{filtered.length === 1 ? "" : "s"} loaded
                            {stale && <span className="ml-2 text-amber-600">(showing saved copy — offline)</span>}
                        </span>
                        <div className="flex items-center gap-3">
                            {hasFilters && (
                                <Button onClick={clearFilters} variant="ghost" size="xs" className="h-auto p-0 text-destructive hover:opacity-80">
                                    <X size={14} /> Clear filters
                                </Button>
                            )}
                            <Button onClick={reload} variant="ghost" size="xs" className="h-auto p-0">
                                Reload
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Table */}
                <div className="flex-1 overflow-y-auto">
                    {loading && rows.length === 0 ? (
                        <p className="text-muted-foreground">Loading...</p>
                    ) : error ? (
                        <div className="rounded-lg border border-destructive/40 p-12 text-center text-destructive shadow">
                            {error}
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="rounded-lg border border-border p-12 text-center text-muted-foreground shadow">
                            {hasFilters ? "No tickets match your filters." : "No tickets yet. Create your first one!"}
                        </div>
                    ) : (
                        <div className="rounded-lg border border-border shadow">
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 z-10 rounded-t-lg border-b border-border bg-muted text-xs text-muted-foreground uppercase">
                                    <tr>
                                        <th className="px-6 py-3 text-left">#</th>
                                        <th className="px-6 py-3 text-left">Customer</th>
                                        <th className="px-6 py-3 text-left">Device</th>
                                        <th className="px-6 py-3 text-left">Problem</th>
                                        <th className="px-6 py-3 text-left">Priority</th>
                                        <th className="px-6 py-3 text-left">Status</th>
                                        <th className="px-6 py-3 text-left">Date</th>
                                        <th className="px-6 py-3 text-left">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {filtered.map((t) => (
                                        <tr key={t.id} className="hover:bg-muted/50">
                                            <td className="px-6 py-4 text-muted-foreground">{t.id}</td>
                                            <td className="px-6 py-4">
                                                <p className="font-medium">{t.device.account?.name}</p>
                                                <p className="text-muted-foreground text-xs">{t.device.account?.phone}</p>
                                            </td>
                                            <td className="px-6 py-4">
                                                <p>{t.device.brand} {t.device.model}</p>
                                                <p className="text-muted-foreground text-xs">{t.device.type}</p>
                                            </td>
                                            <td className="px-6 py-4 max-w-37.5 truncate text-muted-foreground">
                                                {t.device.problem}
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`px-2 py-0.5 text-xs font-medium ${PRIORITY_META[t.priority]?.color ?? ""}`}>
                                                    {PRIORITY_META[t.priority]?.label ?? t.priority}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col gap-1">
                                                    <span className={`px-2 py-0.5 text-xs font-medium w-fit ${t.ticketStatus.color}`}>
                                                        {t.ticketStatus.label}
                                                    </span>
                                                    {t.ticketWorker && (
                                                        <span className={`px-2 py-0.5 text-xs font-medium w-fit ${badgeColor(t.ticketWorker.color).className}`} style={badgeColor(t.ticketWorker.color).style}>
                                                            {t.ticketWorker.label}
                                                        </span>
                                                    )}
                                                    <WarrantyBadge isWarranty={t.isWarranty} warrantyStatus={t.warrantyStatus} />
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-muted-foreground">{formatDate(t.createdAt)}</td>
                                            <td className="px-6 py-4">
                                                <Button asChild variant="outline" size="sm">
                                                    <Link href={`/office/repairing/tickets/${t.id}`}>
                                                        <Eye /> View
                                                    </Link>
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {hasMore && (
                                <div ref={sentinelRef} className="flex items-center justify-center py-4 text-muted-foreground">
                                    {loadingMore && <Loader2 size={16} className="animate-spin" />}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
