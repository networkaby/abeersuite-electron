"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Eye, Search, X } from "lucide-react";
import { badgeColor } from "@/shared/lib/format/entityColor";
import { toast } from "sonner";
import Link from "next/link";
import { formatDate } from "@/shared/lib/format/formatDate";
import { REPAIR_PIPELINE_NAME } from "@/modules/repairing/lib/repairPipeline";
import { useMarkSurfaceSeen } from "@/shared/hooks/useNavCounts";
import { NAV_SURFACE } from "@/shared/lib/nav/navSurfaces";
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
interface Ticket {
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

/** The centre a device was sent to — new shipping-slip party first, else the legacy ServiceCenter. */
const serviceCenterName = (t: Ticket) => t.context?.shippingSlip?.partyName ?? t.serviceCenter?.name ?? null;

export default function TicketsPage() {
    // Opening the board IS "looking at it" — clears this module's `new` sidebar badge.
    useMarkSurfaceSeen(NAV_SURFACE.repair);

    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [filtered, setFiltered] = useState<Ticket[]>([]);
    const [loading, setLoading] = useState(true);
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

    useEffect(() => {
        if (!repairPipelineId) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLoading(true);
        axios
            .get("/api/tickets", { params: { pipelineId: repairPipelineId } })
            .then((res) => setTickets(res.data))
            .catch(() => toast.error("Failed to load tickets"))
            .finally(() => setLoading(false));
    }, [repairPipelineId]);

    useEffect(() => {
        let result = [...tickets];
        if (search) {
            const s = search.toLowerCase();
            result = result.filter(
                (t) =>
                    (t.device.account?.name ?? "").toLowerCase().includes(s) ||
                    (t.device.account?.phone ?? "").includes(s) ||
                    t.device.brand.toLowerCase().includes(s) ||
                    t.device.model.toLowerCase().includes(s) ||
                    String(t.id).includes(s)
            );
        }
        if (statusFilter) result = result.filter((t) => t.status === statusFilter);
        if (priorityFilter) result = result.filter((t) => t.priority === priorityFilter);
        if (serviceCenterFilter) result = result.filter((t) => serviceCenterName(t) === serviceCenterFilter);
        if (dateFrom) result = result.filter((t) => new Date(t.createdAt) >= new Date(dateFrom));
        if (dateTo) result = result.filter((t) => new Date(t.createdAt) <= new Date(dateTo + "T23:59:59"));
        if (warrantyFilter === "warranty") result = result.filter((t) => t.isWarranty);
        if (warrantyFilter === "non_warranty") result = result.filter((t) => !t.isWarranty);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setFiltered(result);
    }, [tickets, search, statusFilter, priorityFilter, serviceCenterFilter, dateFrom, dateTo, warrantyFilter]);

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

    // Service-centre options come from the tickets themselves (either flow), not a master list.
    const serviceCenterOptions = Array.from(new Set(tickets.map(serviceCenterName).filter(Boolean))) as string[];

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-3xl font-bold">Tickets</h1>
                <span className="text-sm text-muted-foreground">{tickets.length} total</span>
            </div>

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
                <div className="flex flex-wrap gap-2 [&>*]:flex-1 [&>*]:min-w-[160px] [&>*]:max-w-[260px]">
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
                        Showing <span className="font-medium text-foreground">{filtered.length}</span> of{" "}
                        <span className="font-medium text-foreground">{tickets.length}</span> tickets
                    </span>
                    {hasFilters && (
                        <Button onClick={clearFilters} variant="ghost" size="xs" className="h-auto p-0 text-destructive hover:opacity-80">
                            <X size={14} /> Clear filters
                        </Button>
                    )}
                </div>
            </div>

            {/* Table */}
            {loading ? (
                <p className="text-muted-foreground">Loading...</p>
            ) : filtered.length === 0 ? (
                <div className="rounded-lg border border-border p-12 text-center text-muted-foreground shadow">
                    {hasFilters ? "No tickets match your filters." : "No tickets yet. Create your first one!"}
                </div>
            ) : (
                <div className="overflow-hidden rounded-lg border border-border shadow">
                    <table className="w-full text-sm">
                        <thead className="border-b border-border bg-muted text-xs text-muted-foreground uppercase">
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
                                    <td className="px-6 py-4 max-w-[150px] truncate text-muted-foreground">
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
                </div>
            )}
        </div>
    );
}
