"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Eye, Search, X } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatDate } from "@/lib/format-date";
import WarrantyBadge from "@/modules/repairing/components/WarrantyBadge";
import { PRIORITY_META } from "@/utils/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    pipelineId: string | null;
    escalated: boolean;
    isWarranty: boolean;
    warrantyStatus: string;
    createdAt: string;
    ticketStatus: { label: string; color: string };
    ticketSubStatus?: { label: string; color: string } | null;
    pipeline?: { id: string; label: string; color: string } | null;
    device: {
        type: string;
        brand: string;
        model: string;
        problem: string;
        account: { name: string; phone?: string | null } | null;
    };
    primaryOwner?: { name: string };
    serviceCenter?: { name: string };
}
type Technician = { id: number; name: string };
type ServiceCenter = { id: number; name: string };
type StatusOption = { id: string; label: string };
type PriorityOption = { id: string; label: string };
type PipelineOption = { id: string; label: string; color: string };

export default function TicketsPage() {
    const searchParams = useSearchParams();
    const requestedPipeline = searchParams.get("pipeline") ?? "";
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [filtered, setFiltered] = useState<Ticket[]>([]);
    const [loading, setLoading] = useState(true);
    const [technicians, setTechnicians] = useState<Technician[]>([]);
    const [serviceCenters, setServiceCenters] = useState<ServiceCenter[]>([]);
    const [statusOptions, setStatusOptions] = useState<StatusOption[]>([]);
    const [priorityOptions, setPriorityOptions] = useState<PriorityOption[]>([]);
    const [pipelineOptions, setPipelineOptions] = useState<PipelineOption[]>([]);

    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("");
    const [priorityFilter, setPriorityFilter] = useState("");
    const [technicianFilter, setTechnicianFilter] = useState("");
    const [serviceCenterFilter, setServiceCenterFilter] = useState("");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [warrantyFilter, setWarrantyFilter] = useState("");
    const [pipelineFilter, setPipelineFilter] = useState("");

    useEffect(() => {
        setLoading(true);
        const fetchTickets = async () => {
            try {
                const res = await axios.get("/api/tickets", {
                    params: requestedPipeline ? { pipelineId: requestedPipeline } : undefined,
                });
                setTickets(res.data);
            } catch {
                toast.error("Failed to load tickets");
            } finally {
                setLoading(false);
            }
        };
        fetchTickets();
        axios.get("/api/users").then((r) => setTechnicians(r.data));
        axios.get("/api/service-centers").then((r) => setServiceCenters(r.data));
        axios.get("/api/ticket-statuses").then((r) =>
            setStatusOptions(r.data.map((s: { id: string; label: string }) => ({ id: s.id, label: s.label })))
        );
        axios.get("/api/priorities").then((r) => setPriorityOptions(r.data));
        axios.get("/api/pipelines").then((r) => setPipelineOptions(r.data));
    }, [requestedPipeline]);

    useEffect(() => {
        setPipelineFilter(requestedPipeline);
    }, [requestedPipeline]);

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
        if (technicianFilter) result = result.filter((t) => t.primaryOwner?.name === technicianFilter);
        if (serviceCenterFilter) result = result.filter((t) => t.serviceCenter?.name === serviceCenterFilter);
        if (dateFrom) result = result.filter((t) => new Date(t.createdAt) >= new Date(dateFrom));
        if (dateTo) result = result.filter((t) => new Date(t.createdAt) <= new Date(dateTo + "T23:59:59"));
        if (warrantyFilter === "warranty") result = result.filter((t) => t.isWarranty);
        if (warrantyFilter === "non_warranty") result = result.filter((t) => !t.isWarranty);
        if (pipelineFilter) result = result.filter((t) => t.pipelineId === pipelineFilter);
        setFiltered(result);
    }, [tickets, search, statusFilter, priorityFilter, technicianFilter, serviceCenterFilter, dateFrom, dateTo, warrantyFilter, pipelineFilter]);

    const clearFilters = () => {
        setSearch(""); setStatusFilter(""); setPriorityFilter("");
        setTechnicianFilter(""); setServiceCenterFilter("");
        setDateFrom(""); setDateTo(""); setWarrantyFilter("");
        setPipelineFilter(requestedPipeline);
    };

    const hasFilters = Boolean(
        search || statusFilter || priorityFilter || technicianFilter ||
        serviceCenterFilter || dateFrom || dateTo || warrantyFilter ||
        pipelineFilter !== requestedPipeline
    );

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

                {/* Pipeline tabs */}
                {pipelineOptions.length > 1 && (
                    <div className="flex gap-2 flex-wrap pb-1">
                        <Button
                            onClick={() => setPipelineFilter("")}
                            variant="outline"
                            size="xs"
                            className={`h-auto px-3 py-1.5 text-xs font-medium transition-colors ${
                                !pipelineFilter
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-card text-muted-foreground hover:bg-muted"
                            }`}
                        >
                            All Pipelines
                        </Button>
                        {pipelineOptions.map((p) => (
                            <Button
                                key={p.id}
                                onClick={() => setPipelineFilter(p.id)}
                                variant="outline"
                                size="xs"
                                className={`h-auto px-3 py-1.5 text-xs font-medium transition-colors ${
                                    pipelineFilter === p.id
                                        ? "bg-primary text-primary-foreground"
                                        : "bg-card text-muted-foreground hover:bg-muted"
                                }`}
                            >
                                {p.label}
                            </Button>
                        ))}
                    </div>
                )}

                {/* Filter Row */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-2">
                    <Select value={statusFilter || "all"} onValueChange={(value) => setStatusFilter(value === "all" ? "" : value)}>
                        <SelectTrigger><SelectValue placeholder="All Status" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Status</SelectItem>
                            {statusOptions.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <Select value={priorityFilter || "all"} onValueChange={(value) => setPriorityFilter(value === "all" ? "" : value)}>
                        <SelectTrigger><SelectValue placeholder="All Priority" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Priority</SelectItem>
                            {priorityOptions.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <Select value={technicianFilter || "all"} onValueChange={(value) => setTechnicianFilter(value === "all" ? "" : value)}>
                        <SelectTrigger><SelectValue placeholder="All Technicians" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Technicians</SelectItem>
                            {technicians.map((t) => <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <Select value={serviceCenterFilter || "all"} onValueChange={(value) => setServiceCenterFilter(value === "all" ? "" : value)}>
                        <SelectTrigger><SelectValue placeholder="All Service Centers" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Service Centers</SelectItem>
                            {serviceCenters.map((s) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <Select value={warrantyFilter || "all"} onValueChange={(value) => setWarrantyFilter(value === "all" ? "" : value)}>
                        <SelectTrigger><SelectValue placeholder="All Warranty" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Warranty</SelectItem>
                            <SelectItem value="warranty">Warranty only</SelectItem>
                            <SelectItem value="non_warranty">Non-warranty only</SelectItem>
                        </SelectContent>
                    </Select>
                    <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                    <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
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
                                {pipelineOptions.length > 1 && <th className="px-6 py-3 text-left">Pipeline</th>}
                                <th className="px-6 py-3 text-left">Technician</th>
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
                                            {t.ticketSubStatus && (
                                                <span className={`px-2 py-0.5 text-xs font-medium w-fit ${t.ticketSubStatus.color}`}>
                                                    {t.ticketSubStatus.label}
                                                </span>
                                            )}
                                            <WarrantyBadge isWarranty={t.isWarranty} warrantyStatus={t.warrantyStatus} />
                                        </div>
                                    </td>
                                    {pipelineOptions.length > 1 && (
                                        <td className="px-6 py-4">
                                            {t.pipeline ? (
                                                <span className={`px-2 py-0.5 text-xs font-medium ${t.pipeline.color}`}>
                                                    {t.pipeline.label}
                                                </span>
                                            ) : (
                                                <span className="text-muted-foreground text-xs">—</span>
                                            )}
                                        </td>
                                    )}
                                    <td className="px-6 py-4 text-muted-foreground">{t.primaryOwner?.name || "—"}</td>
                                    <td className="px-6 py-4 text-muted-foreground">{formatDate(t.createdAt)}</td>
                                    <td className="px-6 py-4">
                                        <Link href={`/office/repairing/tickets/${t.id}`} className="inline-flex p-1.5 text-primary hover:bg-primary/10">
                                            <Eye size={15} />
                                        </Link>
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
