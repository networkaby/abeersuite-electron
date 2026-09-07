"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { Plus, RefreshCw, LifeBuoy, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useMarkSurfaceSeen } from "@/shared/hooks/useNavCounts";
import { NAV_SURFACE } from "@/shared/lib/nav/navSurfaces";
import HelpBoard from "./HelpBoard";
import HelpFormDialog from "./HelpFormDialog";
import HelpQuickForm from "./HelpQuickForm";
import HelpDetailDialog from "./HelpDetailDialog";
import { INQUIRY_LABEL, OUTCOME_LABEL, helpCustomerName, helpTitle, type HelpDto, type HelpDetailDto, type HelpStage } from "../lib/types";
import { usePositionPicker, useTicketsDelta } from "@/shared/hooks";

export default function HelpWorkspace({
    stages,
    canCreate,
    canEdit,
    canDelete,
}: {
    stages: HelpStage[];
    canCreate: boolean;
    /** Covers the Edit button, stage/advise/close actions and drag-between-columns. */
    canEdit: boolean;
    canDelete: boolean;
}) {
    // Seats, and which are mine, from the browser's cached copy — see usePositionPicker.
    const { positions, myPositionIds } = usePositionPicker();

    // Opening the board IS "looking at it" — clears this module's `new` sidebar badge.
    useMarkSurfaceSeen(NAV_SURFACE.help);

    const router = useRouter();
    const searchParams = useSearchParams();
    const [mineOnly, setMineOnly] = useState(false);
    const [query, setQuery] = useState("");

    const [quickOpen, setQuickOpen] = useState(false);      // create (fast contact-first form)
    const [formOpen, setFormOpen] = useState(false);        // edit (full form)
    const [editing, setEditing] = useState<HelpDetailDto | null>(null);
    const [detailId, setDetailId] = useState<number | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);

    // Dexie-cached + delta-synced against the same Ticket replica the other
    // ticket-flavoured boards use, and realtime-refreshed live — see useTicketsDelta.
    const { rows: tickets, setRows: setTickets, loading, error, reload: load, afterOwnWrite } = useTicketsDelta<HelpDto>({}, {
        apiPath: "/api/help",
        sort: (a, b) => a.order - b.order || b.createdAt.localeCompare(a.createdAt) || b.id - a.id,
    });

    useEffect(() => { if (error) toast.error("Failed to load help tickets"); }, [error]);

    // Deep link: /office/help?new=1 opens the quick create dialog. Adjusted
    // during render against a stored "last handled" key, rather than in an
    // effect — see the matching comment in DealsWorkspace.
    const [handledNewParam, setHandledNewParam] = useState<string | null>(null);
    const newParamKey = searchParams.get("new") !== null && canCreate ? searchParams.toString() : null;
    if (newParamKey !== null && handledNewParam !== newParamKey) {
        setHandledNewParam(newParamKey);
        setQuickOpen(true);
    }
    useEffect(() => {
        if (newParamKey !== null && handledNewParam === newParamKey) {
            router.replace("/office/help");
        }
    }, [newParamKey, handledNewParam, router]);

    const mySet = new Set(myPositionIds);
    const q = query.trim().toLowerCase();
    const visible = tickets
        .filter((t) => (mineOnly ? t.assignedPositionId !== null && mySet.has(t.assignedPositionId) : true))
        .filter((t) => {
            if (!q) return true;
            const name = t.person?.name ?? t.company?.name ?? t.contactName ?? "";
            return [t.subject, name, t.phone].filter(Boolean).some((v) => v!.toLowerCase().includes(q));
        });
    const openCount = visible.filter((t) => !t.ticketStatus.isTerminal).length;

    const onMove = async (ticketId: number, stageId: string) => {
        const target = stages.find((s) => s.id === stageId);
        if (!target) return;
        const prev = tickets;
        setTickets((ts) => ts.map((t) => (t.id === ticketId ? { ...t, status: stageId, ticketStatus: target } : t)));
        try {
            await axios.patch(`/api/help/${ticketId}`, { status: stageId });
            afterOwnWrite();
        } catch {
            setTickets(prev);
            toast.error("Failed to move ticket");
        }
    };

    const openCreate = () => setQuickOpen(true);
    const openDetail = (id: number) => { setDetailId(id); setDetailOpen(true); };
    const openEdit = (t: HelpDetailDto) => { setDetailOpen(false); setEditing(t); setFormOpen(true); };

    return (
        <div className="flex h-full flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <LifeBuoy className="size-5" />
                    </span>
                    <div>
                        <h1 className="text-xl font-semibold leading-none tracking-tight">Help Desk</h1>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {openCount} open · {visible.length} total
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" className="h-9 w-48 pl-8" />
                    </div>
                    <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5">
                        <Switch id="mine" checked={mineOnly} onCheckedChange={setMineOnly} />
                        <Label htmlFor="mine" className="cursor-pointer text-sm">My team</Label>
                    </div>
                    <Button variant="outline" size="icon" onClick={load} title="Refresh"><RefreshCw className="size-4" /></Button>
                    {canCreate && <Button onClick={openCreate}><Plus className="size-4" /> New Help</Button>}
                </div>
            </div>

            <Tabs defaultValue="board" className="flex min-h-0 flex-1 flex-col">
                <TabsList className="w-fit">
                    <TabsTrigger value="board">Board</TabsTrigger>
                    <TabsTrigger value="list">List</TabsTrigger>
                </TabsList>
                <TabsContent value="board" className="mt-3 flex min-h-0 flex-1 flex-col">
                    <HelpBoard
                        stages={stages}
                        tickets={visible}
                        canEdit={canEdit}
                        loading={loading}
                        onMove={onMove}
                        onOpen={openDetail}
                    />
                </TabsContent>
                <TabsContent value="list" className="mt-3 min-h-0 flex-1 overflow-y-auto">
                    <div className="overflow-x-auto rounded-lg border">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 font-medium">Subject</th>
                                    <th className="px-3 py-2 font-medium">Customer</th>
                                    <th className="px-3 py-2 font-medium">Type</th>
                                    <th className="px-3 py-2 font-medium">Stage</th>
                                    <th className="px-3 py-2 font-medium">Outcome</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visible.map((t) => (
                                    <tr key={t.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => openDetail(t.id)}>
                                        <td className="px-3 py-2 font-medium">{helpTitle(t)}</td>
                                        <td className="px-3 py-2 text-muted-foreground">{helpCustomerName(t)}</td>
                                        <td className="px-3 py-2">{t.inquiryType ? INQUIRY_LABEL[t.inquiryType] : "—"}</td>
                                        <td className="px-3 py-2"><span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${t.ticketStatus.color}`}>{t.ticketStatus.label}</span></td>
                                        <td className="px-3 py-2">{t.outcome ? <Badge variant="outline" className="text-[10px]">{OUTCOME_LABEL[t.outcome]}</Badge> : "—"}</td>
                                    </tr>
                                ))}
                                {visible.length === 0 && (
                                    <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No help tickets</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </TabsContent>
            </Tabs>

            <HelpQuickForm
                open={quickOpen}
                onOpenChange={setQuickOpen}
                positions={positions}
                onSaved={afterOwnWrite}
            />
            <HelpFormDialog
                open={formOpen}
                onOpenChange={setFormOpen}
                positions={positions}
                ticket={editing}
                onSaved={afterOwnWrite}
            />
            <HelpDetailDialog
                ticketId={detailId}
                open={detailOpen}
                onOpenChange={setDetailOpen}
                stages={stages}
                canEdit={canEdit}
                canDelete={canDelete}
                onEdit={openEdit}
                onChanged={afterOwnWrite}
            />
        </div>
    );
}
