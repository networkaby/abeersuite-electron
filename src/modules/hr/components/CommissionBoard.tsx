"use client";

// Targets & Commission — two tabs.
//
//   Set commission — the catalogue of commission / target HEADS, like the
//                    coupons page: named ways of earning with the user kinds
//                    (roles) they are for. CommissionHeadsTab.
//   Per person      — each person: the heads that reach them with their own
//                    override, and the month's own sales judged by them.
//                    CommissionMonthTab.
//
// One read (/api/hr/commission) feeds both; every write re-reads it. The person
// sees the same heads on My Info, through the same server-side resolution.

import { useState } from "react";
import { ChevronLeft, ChevronRight, Settings2, Target, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataPageHeader } from "@/shared/components/DataPageHeader";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { useApiResource, useRealtimeTopics } from "@/shared/hooks";
import { todayIso } from "@/shared/lib/format/formatDate";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import type { CommissionBoardPayload } from "../lib/commissionTypes";
import CommissionHeadsTab from "./CommissionHeadsTab";
import CommissionMonthTab from "./CommissionMonthTab";
import { monthLabel, shiftMonth } from "./MyTargetCard";

export default function CommissionBoard({ canEdit }: { canEdit: boolean }) {
    const [month, setMonth] = useState(() => todayIso().slice(0, 7));
    const { data, loading, refreshing, error, reload } = useApiResource<CommissionBoardPayload>(`/api/hr/commission?month=${month}`);
    useRealtimeTopics(["settings", "ledger"], reload);
    const [tab, setTab] = useState<"set" | "person">("set");

    const isCurrent = data ? month === data.today.slice(0, 7) : true;
    const onHeads = data?.heads.filter((h) => h.active).length ?? 0;

    return (
        <ScrollArea className="h-full" type="always">
            <div className="px-6 pt-3 pb-6">
                <DataPageHeader
                    title="Targets & Commission"
                    subtitle={data
                        ? `${onHeads} of ${data.heads.length} heads on · ${data.rows.length} staff · team sold ${formatRupeesFromPaise(data.teamSalesPaise)} in ${monthLabel(month)}${refreshing ? " · refreshing…" : ""}`
                        : "Reading the board…"}
                    icon={<Target size={20} />}
                    actions={tab === "person" && (
                        <div className="flex items-center gap-1">
                            <Button type="button" variant="outline" size="icon" aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}><ChevronLeft size={16} /></Button>
                            <span className="min-w-[9rem] text-center text-sm font-medium">{monthLabel(month)}</span>
                            <Button type="button" variant="outline" size="icon" aria-label="Next month" disabled={isCurrent} onClick={() => setMonth((m) => shiftMonth(m, 1))}><ChevronRight size={16} /></Button>
                        </div>
                    )}
                />

                <QueryStateBlock loading={loading} error={error} hasData={!!data} onRetry={reload} />

                {data && (
                    <Tabs value={tab} onValueChange={(v) => setTab(v as "set" | "person")} className="space-y-4">
                        <TabsList className="w-fit">
                            <TabsTrigger value="set"><Settings2 size={14} /> Set commission</TabsTrigger>
                            <TabsTrigger value="person"><Users size={14} /> Per person</TabsTrigger>
                        </TabsList>
                        <TabsContent value="set">
                            <CommissionHeadsTab heads={data.heads} roles={data.roles} canEdit={canEdit} onChanged={reload} />
                        </TabsContent>
                        <TabsContent value="person">
                            <CommissionMonthTab rows={data.rows} heads={data.heads} canEdit={canEdit} isCurrent={isCurrent} monthLabel={monthLabel(month)} onChanged={reload} />
                        </TabsContent>
                    </Tabs>
                )}
            </div>
        </ScrollArea>
    );
}
