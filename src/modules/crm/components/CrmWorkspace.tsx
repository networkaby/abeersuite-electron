"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { Plus, RefreshCw, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import LeadBoard from "./LeadBoard";
import LeadTable from "./LeadTable";
import LeadFormDialog from "./LeadFormDialog";
import LeadDetailDialog from "./LeadDetailDialog";
import type { LeadDto, LeadDetailDto, LeadStage, LeadPositionOption } from "../lib/types";

export default function CrmWorkspace({
    stages,
    positions,
    myPositionIds,
    canManage,
}: {
    stages: LeadStage[];
    positions: LeadPositionOption[];
    myPositionIds: string[];
    canManage: boolean;
}) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [leads, setLeads] = useState<LeadDto[]>([]);
    const [loading, setLoading] = useState(true);
    const [myLeadsOnly, setMyLeadsOnly] = useState(false);

    const [formOpen, setFormOpen] = useState(false);
    const [editingLead, setEditingLead] = useState<LeadDetailDto | null>(null);
    const [detailId, setDetailId] = useState<number | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await axios.get<LeadDto[]>("/api/crm/leads");
            setLeads(res.data);
        } catch {
            toast.error("Failed to load leads");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // Button-bar deep link: /office/crm?new=1 opens the create dialog.
    useEffect(() => {
        if (searchParams.get("new") !== null && canManage) {
            setEditingLead(null);
            setFormOpen(true);
            router.replace("/office/crm");
        }
    }, [searchParams, canManage, router]);

    const mySet = new Set(myPositionIds);
    const visible = myLeadsOnly
        ? leads.filter((l) => l.assignedPositionId !== null && mySet.has(l.assignedPositionId))
        : leads;
    const totalValue = visible.reduce((s, l) => s + (l.valuePaise ?? 0), 0);

    const onMove = async (leadId: number, stageId: string) => {
        const target = stages.find((s) => s.id === stageId);
        if (!target) return;
        const prev = leads;
        setLeads((ls) => ls.map((l) => (l.id === leadId ? { ...l, status: stageId, ticketStatus: target } : l)));
        try {
            await axios.patch(`/api/crm/leads/${leadId}`, { status: stageId });
            load();
        } catch {
            setLeads(prev);
            toast.error("Failed to move lead");
        }
    };

    const openCreate = () => { setEditingLead(null); setFormOpen(true); };
    const openDetail = (id: number) => { setDetailId(id); setDetailOpen(true); };
    const openEdit = (lead: LeadDetailDto) => { setDetailOpen(false); setEditingLead(lead); setFormOpen(true); };

    return (
        <div className="flex h-full flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Network className="size-5" />
                    </span>
                    <div>
                        <h1 className="text-xl font-semibold leading-none tracking-tight">CRM Pipeline</h1>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {visible.length} {visible.length === 1 ? "deal" : "deals"} · {formatRupeesFromPaise(totalValue)} in pipeline
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5">
                        <Switch id="my-leads" checked={myLeadsOnly} onCheckedChange={setMyLeadsOnly} />
                        <Label htmlFor="my-leads" className="cursor-pointer text-sm">My leads</Label>
                    </div>
                    <Button variant="outline" size="icon" onClick={load} title="Refresh"><RefreshCw className="size-4" /></Button>
                    {canManage && <Button onClick={openCreate}><Plus className="size-4" /> New Lead</Button>}
                </div>
            </div>

            <Tabs defaultValue="board" className="flex min-h-0 flex-1 flex-col">
                <TabsList className="w-fit">
                    <TabsTrigger value="board">Board</TabsTrigger>
                    <TabsTrigger value="list">List</TabsTrigger>
                </TabsList>
                <TabsContent value="board" className="mt-3 flex min-h-0 flex-1 flex-col">
                    <LeadBoard
                        stages={stages}
                        leads={visible}
                        canManage={canManage}
                        loading={loading}
                        onMove={onMove}
                        onOpen={openDetail}
                    />
                </TabsContent>
                <TabsContent value="list" className="mt-3 min-h-0 flex-1 overflow-y-auto">
                    <LeadTable leads={visible} onOpen={openDetail} />
                </TabsContent>
            </Tabs>

            <LeadFormDialog
                open={formOpen}
                onOpenChange={setFormOpen}
                positions={positions}
                lead={editingLead}
                onSaved={load}
            />
            <LeadDetailDialog
                leadId={detailId}
                open={detailOpen}
                onOpenChange={setDetailOpen}
                stages={stages}
                canManage={canManage}
                onEdit={openEdit}
                onChanged={load}
            />
        </div>
    );
}
