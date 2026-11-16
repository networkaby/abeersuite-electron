"use client";

import { isOpenOrRecentlyClosed } from "@/shared/lib/tickets/closedWindow";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { Plus, RefreshCw, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { useMarkSurfaceSeen } from "@/shared/hooks/useNavCounts";
import { usePositionPicker, useTicketsDelta } from "@/shared/hooks";
import { NAV_SURFACE } from "@/shared/lib/nav/navSurfaces";
import DealBoard from "./DealBoard";
import DealTable from "./DealTable";
import DealFormDialog from "./DealFormDialog";
import DealDetailDialog from "./DealDetailDialog";
import type { DealDto, DealDetailDto, DealStage } from "../lib/types";

const keepDealRow = (d: DealDto) => isOpenOrRecentlyClosed(d.closedAt);

export default function DealsWorkspace({
    stages,
    canCreate,
    canEdit,
    canDelete,
}: {
    stages: DealStage[];
    canCreate: boolean;
    /** Covers the Edit button, the stage select and drag-between-columns. */
    canEdit: boolean;
    canDelete: boolean;
}) {
    // Seats, and which are mine, from the browser's cached copy — see usePositionPicker.
    const { positions, myPositionIds } = usePositionPicker();

    // Opening the board IS "looking at it" — clears this module's `new` sidebar badge.
    useMarkSurfaceSeen(NAV_SURFACE.deals);

    const router = useRouter();
    const searchParams = useSearchParams();
    const [myDealsOnly, setMyDealsOnly] = useState(false);

    const [formOpen, setFormOpen] = useState(false);
    const [editingDeal, setEditingDeal] = useState<DealDetailDto | null>(null);
    const [detailId, setDetailId] = useState<number | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);

    // Dexie-cached + delta-synced against the same Ticket replica the other
    // ticket-flavoured boards use, and realtime-refreshed live — see useTicketsDelta.
    const { rows: deals, setRows: setDeals, loading, error, reload: load, afterOwnWrite } = useTicketsDelta<DealDto>({}, {
        apiPath: "/api/deals",
        keep: keepDealRow,
        sort: (a, b) => a.order - b.order || b.createdAt.localeCompare(a.createdAt) || b.id - a.id,
    });

    useEffect(() => { if (error) toast.error("Failed to load deals"); }, [error]);

    // Button-bar deep link: /office/crm/deals?new=1 opens the create dialog.
    // Adjusted during render against a stored "last handled" key, rather than
    // in an effect — the React-docs-recommended shape for "derive state from a
    // prop that just changed" (see "You Might Not Need An Effect").
    const [handledNewParam, setHandledNewParam] = useState<string | null>(null);
    const newParamKey = searchParams.get("new") !== null && canCreate ? searchParams.toString() : null;
    if (newParamKey !== null && handledNewParam !== newParamKey) {
        setHandledNewParam(newParamKey);
        setEditingDeal(null);
        setFormOpen(true);
    }
    useEffect(() => {
        if (newParamKey !== null && handledNewParam === newParamKey) {
            router.replace("/office/crm/deals");
        }
    }, [newParamKey, handledNewParam, router]);

    const mySet = new Set(myPositionIds);
    const visible = myDealsOnly
        ? deals.filter((l) => l.assignedPositionId !== null && mySet.has(l.assignedPositionId))
        : deals;
    const totalValue = visible.reduce((s, l) => s + (l.valuePaise ?? 0), 0);

    const onMove = async (dealId: number, stageId: string) => {
        const target = stages.find((s) => s.id === stageId);
        if (!target) return;
        const prev = deals;
        setDeals((ls) => ls.map((l) => (l.id === dealId ? { ...l, status: stageId, ticketStatus: target } : l)));
        try {
            const { data } = await axios.patch<DealDto>(`/api/deals/${dealId}`, { status: stageId });
            afterOwnWrite(data);
        } catch {
            setDeals(prev);
            toast.error("Failed to move deal");
        }
    };

    const openCreate = () => { setEditingDeal(null); setFormOpen(true); };
    // Deep link: /office/crm/deals?deal=<id> opens that deal (CRM → Messages links here).
    const dealParam = Number(searchParams.get("deal")) || null;
    const [handledDealParam, setHandledDealParam] = useState<number | null>(null);
    if (dealParam !== null && handledDealParam !== dealParam) {
        setHandledDealParam(dealParam);
        setDetailId(dealParam);
        setDetailOpen(true);
    }

    const openDetail = (id: number) => { setDetailId(id); setDetailOpen(true); };
    const openEdit = (deal: DealDetailDto) => { setDetailOpen(false); setEditingDeal(deal); setFormOpen(true); };

    return (
        <div className="flex h-full flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Network className="size-5" />
                    </span>
                    <div>
                        <h1 className="text-xl font-semibold leading-none tracking-tight">Deals Pipeline</h1>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {visible.length} {visible.length === 1 ? "deal" : "deals"} · {formatRupeesFromPaise(totalValue)} in pipeline
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5">
                        <Switch id="my-deals" checked={myDealsOnly} onCheckedChange={setMyDealsOnly} />
                        <Label htmlFor="my-deals" className="cursor-pointer text-sm">My deals</Label>
                    </div>
                    <Button variant="outline" size="icon" onClick={load} title="Refresh"><RefreshCw className="size-4" /></Button>
                    {canCreate && <Button onClick={openCreate}><Plus className="size-4" /> New Deal</Button>}
                </div>
            </div>

            <Tabs defaultValue="board" className="flex min-h-0 flex-1 flex-col">
                <TabsList className="w-fit">
                    <TabsTrigger value="board">Board</TabsTrigger>
                    <TabsTrigger value="list">List</TabsTrigger>
                </TabsList>
                <TabsContent value="board" className="mt-3 flex min-h-0 flex-1 flex-col">
                    <DealBoard
                        stages={stages}
                        deals={visible}
                        canEdit={canEdit}
                        loading={loading}
                        onMove={onMove}
                        onOpen={openDetail}
                    />
                </TabsContent>
                <TabsContent value="list" className="mt-3 min-h-0 flex-1 overflow-y-auto">
                    <DealTable deals={visible} onOpen={openDetail} />
                </TabsContent>
            </Tabs>

            <DealFormDialog
                open={formOpen}
                onOpenChange={setFormOpen}
                positions={positions}
                deal={editingDeal}
                onSaved={afterOwnWrite}
            />
            <DealDetailDialog
                dealId={detailId}
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
