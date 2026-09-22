"use client";

// Targets & Commission — two tabs.
//
//   Set commission — the catalogue of commission / target HEADS, like the
//                    coupons page: named ways of earning with the user kinds
//                    (roles) they are for. CommissionHeadsTab.
//   Per person      — each person: the heads that reach them with their own
//                    override, and the month's own sales judged by them.
//                    CommissionMonthTab (owner, 2026-09-23: renamed from
//                    "This month" — "in this we will set user override").
//
// UI ONLY for now (owner, 2026-09-22/23: "just do the tab only wiring later").
// The heads and the overrides live here in component state so both tabs see
// the same list; nothing is saved. The sales figures are real, from the board
// read. The person sees the same heads on My Info once wired.

import { useMemo, useState } from "react";
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
import CommissionHeadsTab, { SAMPLE_HEADS, type CommissionHead } from "./CommissionHeadsTab";
import CommissionMonthTab, { type Overrides } from "./CommissionMonthTab";
import { monthLabel, shiftMonth } from "./MyTargetCard";

export default function CommissionBoard({ canEdit }: { canEdit: boolean }) {
    const [month, setMonth] = useState(() => todayIso().slice(0, 7));
    const { data, loading, refreshing, error, reload } = useApiResource<CommissionBoardPayload>(`/api/hr/commission?month=${month}`);
    useRealtimeTopics(["settings", "ledger"], reload);
    const [tab, setTab] = useState<"set" | "month">("set");
    const [heads, setHeads] = useState<CommissionHead[]>(SAMPLE_HEADS);
    const [overrides, setOverrides] = useState<Overrides>({});

    const isCurrent = data ? month === data.today.slice(0, 7) : true;
    // The "user kinds" a head can be limited to: every role the current staff carry.
    const roles = useMemo(() => [...new Set((data?.rows ?? []).map((r) => r.role).filter((r): r is string => !!r))].sort(), [data]);
    const onHeads = heads.filter((h) => h.active).length;

    return (
        <ScrollArea className="h-full" type="always">
            <div className="px-6 pt-3 pb-6">
                <DataPageHeader
                    title="Targets & Commission"
                    subtitle={data
                        ? `${onHeads} of ${heads.length} heads on · ${data.rows.length} staff · team sold ${formatRupeesFromPaise(data.teamSalesPaise)} in ${monthLabel(month)}${refreshing ? " · refreshing…" : ""}`
                        : "Reading the board…"}
                    icon={<Target size={20} />}
                    actions={tab === "month" && (
                        <div className="flex items-center gap-1">
                            <Button type="button" variant="outline" size="icon" aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}><ChevronLeft size={16} /></Button>
                            <span className="min-w-[9rem] text-center text-sm font-medium">{monthLabel(month)}</span>
                            <Button type="button" variant="outline" size="icon" aria-label="Next month" disabled={isCurrent} onClick={() => setMonth((m) => shiftMonth(m, 1))}><ChevronRight size={16} /></Button>
                        </div>
                    )}
                />

                <QueryStateBlock loading={loading} error={error} hasData={!!data} onRetry={reload} />

                {data && (
                    <Tabs value={tab} onValueChange={(v) => setTab(v as "set" | "month")} className="space-y-4">
                        <TabsList className="w-fit">
                            <TabsTrigger value="set"><Settings2 size={14} /> Set commission</TabsTrigger>
                            <TabsTrigger value="month"><Users size={14} /> Per person</TabsTrigger>
                        </TabsList>
                        <TabsContent value="set">
                            <CommissionHeadsTab heads={heads} setHeads={setHeads} roles={roles} canEdit={canEdit} />
                        </TabsContent>
                        <TabsContent value="month">
                            <CommissionMonthTab
                                rows={data.rows}
                                heads={heads}
                                overrides={overrides}
                                setOverrides={setOverrides}
                                canEdit={canEdit}
                                isCurrent={isCurrent}
                                monthLabel={monthLabel(month)}
                            />
                        </TabsContent>
                    </Tabs>
                )}
            </div>
        </ScrollArea>
    );
}
