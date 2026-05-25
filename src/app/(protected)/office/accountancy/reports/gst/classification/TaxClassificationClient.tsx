"use client";

// Top-level client for the Tax Classification page. Owns:
//   • One-shot fetch of /api/accountancy/reports/gst-classification
//   • Active tab + cross-tab drill-down filters (rate / HSN)
//   • InvProductDialog mount for the pencil action on Item-wise rows
//
// Inline edits (RateCell / HsnCell / TaxabilityCell) call PATCH directly and
// trigger a full reload via `reload()`; we accept the round-trip cost because
// it keeps the cascade preview correct (a group change shifts every inherited
// product down the chain).

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InvProductDialog } from "@/modules/inventory/components/InvProductDialog";
import { RateWiseTab } from "./_components/RateWiseTab";
import { HsnWiseTab } from "./_components/HsnWiseTab";
import { GroupHierarchyTab } from "./_components/GroupHierarchyTab";
import { ItemWiseTab } from "./_components/ItemWiseTab";
import type { GstClassificationPayload } from "./_components/types";

interface Props {
    canEdit: boolean;
}

export function TaxClassificationClient({ canEdit }: Props) {
    const [data, setData] = useState<GstClassificationPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<"rate" | "hsn" | "group" | "item">("rate");

    // Cross-tab drill filters — `undefined` = not set; `null` = "unresolved/no HSN".
    const [rateFilter, setRateFilter] = useState<number | null | undefined>(undefined);
    const [hsnFilter, setHsnFilter] = useState<string | null | undefined>(undefined);

    // Inline product dialog (pencil from Item-wise tab) — always opens Tax tab.
    const [dialogProductId, setDialogProductId] = useState<number | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);

    const reload = useCallback(() => {
        setLoading(true);
        return axios
            .get<GstClassificationPayload>("/api/accountancy/reports/gst-classification")
            .then((r) => setData(r.data))
            .catch(() => toast.error("Failed to load tax classification"))
            .finally(() => setLoading(false));
    }, []);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { reload(); }, [reload]);

    const drillToRate = (rateId: number | null) => {
        setRateFilter(rateId);
        setHsnFilter(undefined);
        setTab("item");
    };
    const drillToHsn = (hsn: string | null) => {
        setHsnFilter(hsn);
        setRateFilter(undefined);
        setTab("item");
    };
    const clearFilters = () => {
        setRateFilter(undefined);
        setHsnFilter(undefined);
    };
    const openDialog = (productId: number) => {
        setDialogProductId(productId);
        setDialogOpen(true);
    };

    if (loading && !data) {
        return (
            <div className="flex justify-center py-20">
                <Loader2 className="size-7 animate-spin text-muted-foreground" />
            </div>
        );
    }
    if (!data) {
        return (
            <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center">
                <p className="text-sm text-muted-foreground">Couldn&apos;t load classification data.</p>
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={reload}>Retry</Button>
            </div>
        );
    }

    return (
        <>
            <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                    <TabsList className="flex w-full max-w-2xl justify-start overflow-x-auto">
                        <TabsTrigger value="rate">Rate-wise</TabsTrigger>
                        <TabsTrigger value="hsn">HSN-wise</TabsTrigger>
                        <TabsTrigger value="group">Group hierarchy</TabsTrigger>
                        <TabsTrigger value="item">Item-wise</TabsTrigger>
                    </TabsList>
                    <Button type="button" variant="outline" size="sm" onClick={reload} disabled={loading}>
                        <RefreshCw className={`mr-1.5 size-3.5 ${loading ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                </div>

                <TabsContent value="rate">
                    <RateWiseTab data={data} onDrillToRate={drillToRate} />
                </TabsContent>
                <TabsContent value="hsn">
                    <HsnWiseTab data={data} onDrillToHsn={drillToHsn} />
                </TabsContent>
                <TabsContent value="group">
                    <GroupHierarchyTab data={data} canEdit={canEdit} onSaved={reload} />
                </TabsContent>
                <TabsContent value="item">
                    <ItemWiseTab
                        data={data}
                        canEdit={canEdit}
                        onSaved={reload}
                        onOpenDialog={openDialog}
                        rateFilter={rateFilter}
                        hsnFilter={hsnFilter}
                        onClearFilters={clearFilters}
                    />
                </TabsContent>
            </Tabs>

            <InvProductDialog
                open={dialogOpen}
                onOpenChange={(o) => { setDialogOpen(o); if (!o) setDialogProductId(null); }}
                editId={dialogProductId}
                defaultTab="tax"
                onSaved={reload}
            />
        </>
    );
}
