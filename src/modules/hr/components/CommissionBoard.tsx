"use client";

// Targets & Commission — two tabs.
//
//   Set commission — where HR decides: the shop's scheme (everyone on "Shop
//                    scheme" follows it), and per person the mode and their own
//                    scheme with its history. No sales figures here; this is
//                    the rule book. Owner, 2026-09-22: "first give a tab where
//                    we set commission".
//   This month      — the leaderboard: the scheme that applies, the month's own
//                    sales against it, what that has earned.
//
// The person sees the same month on My Info, through the same arithmetic.

import { useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, History, Pencil, Settings2, Store, Target, Trash2, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataPageHeader } from "@/shared/components/DataPageHeader";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { TableEmptyRow } from "@/shared/components/DataTableStates";
import UserAvatar from "@/shared/components/UserAvatar";
import { useApiResource, useRealtimeTopics } from "@/shared/hooks";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { formatDate, todayIso } from "@/shared/lib/format/formatDate";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import { COMMISSION_MODES, COMMISSION_MODE_LABELS, describeScheme, type CommissionMode } from "@/shared/lib/hr/commissionScheme";
import type { CommissionBoardPayload, CommissionBoardRow, CommissionSchemeDto } from "../lib/commissionTypes";
import CommissionSchemeDialog from "./CommissionSchemeDialog";
import { TargetProgress, monthLabel, shiftMonth } from "./MyTargetCard";

type Editing = { userId: number | null; name: string; startFrom: CommissionSchemeDto | null };

export default function CommissionBoard({ canEdit }: { canEdit: boolean }) {
    const [month, setMonth] = useState(() => todayIso().slice(0, 7));
    const { data, loading, refreshing, error, reload } = useApiResource<CommissionBoardPayload>(`/api/hr/commission?month=${month}`);
    useRealtimeTopics(["settings", "ledger"], reload);
    const [editing, setEditing] = useState<Editing | null>(null);
    const [historyFor, setHistoryFor] = useState<number | null>(null);
    const [globalHistoryOpen, setGlobalHistoryOpen] = useState(false);
    const [tab, setTab] = useState<"set" | "month">("set");

    const isCurrent = data ? month === data.today.slice(0, 7) : true;

    const ranked = useMemo(() => {
        if (!data) return [];
        // Achievers first, by share of target; then by sales — the board reads
        // as a leaderboard, which is the point of putting it on a wall.
        return [...data.rows].sort((a, b) => {
            const ax = a.thisMonth.outcome?.achieved ?? -1, bx = b.thisMonth.outcome?.achieved ?? -1;
            if (bx !== ax) return bx - ax;
            return b.thisMonth.salesPaise - a.thisMonth.salesPaise;
        });
    }, [data]);

    const onScheme = ranked.filter((r) => r.thisMonth.scheme).length;
    const met = ranked.filter((r) => r.thisMonth.outcome?.targetMet).length;

    const remove = async (s: CommissionSchemeDto, owner: string) => {
        const ok = await confirmAction({
            title: `Delete ${owner} scheme from ${formatDate(s.effectiveFrom)}?`,
            body: "Months already paid keep what payroll froze. The earlier scheme, if any, applies from that date again.",
            confirmLabel: "Delete scheme",
        });
        if (!ok) return;
        try {
            await axios.delete(`/api/hr/commission/${s.id}`);
            toast.success("Scheme deleted");
            reload();
        } catch (e) {
            toast.error(extractApiError(e, "Could not delete the scheme"));
        }
    };

    const setMode = async (r: CommissionBoardRow, mode: CommissionMode) => {
        try {
            await axios.patch("/api/hr/commission/mode", { userId: r.userId, mode });
            toast.success(`${r.name}: ${COMMISSION_MODE_LABELS[mode]}`);
            reload();
        } catch (e) {
            toast.error(extractApiError(e, "Could not change the mode"));
        }
    };

    return (
        <ScrollArea className="h-full" type="always">
            <div className="px-6 pt-3 pb-6">
                <DataPageHeader
                    title="Targets & Commission"
                    subtitle={data
                        ? `${onScheme} of ${data.rows.length} on a scheme · ${met} reached the target · team sold ${formatRupeesFromPaise(data.teamSalesPaise)}${refreshing ? " · refreshing…" : ""}`
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
                            <TabsTrigger value="month"><Trophy size={14} /> This month</TabsTrigger>
                        </TabsList>

                        <TabsContent value="set" className="space-y-4">
                        {/* The shop's scheme — what everyone on "Shop scheme" earns by. */}
                        <div className="rounded-lg border border-border bg-card p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Store size={14} /> Shop scheme — everyone on &quot;Shop scheme&quot; follows it</div>
                                    <div className="mt-1 text-sm font-medium">
                                        {data.global ? describeScheme(data.global, formatRupeesFromPaise) : "No shop scheme set — people on “Shop scheme” earn nothing until one is."}
                                    </div>
                                    {data.global && <div className="text-xs text-muted-foreground">since {formatDate(data.global.effectiveFrom)}{data.global.note ? ` — ${data.global.note}` : ""}</div>}
                                </div>
                                <div className="flex gap-1">
                                    {data.globalHistory.length > 0 && (
                                        <Button type="button" variant="ghost" size="icon" aria-label="Shop scheme history" onClick={() => setGlobalHistoryOpen((o) => !o)}><History size={15} /></Button>
                                    )}
                                    {canEdit && (
                                        <Button type="button" variant="outline" size="sm" onClick={() => setEditing({ userId: null, name: "Shop", startFrom: data.global })}>
                                            <Pencil size={14} /> {data.global ? "Revise" : "Set"}
                                        </Button>
                                    )}
                                </div>
                            </div>
                            {globalHistoryOpen && (
                                <ul className="mt-3 space-y-1 border-t border-border pt-2 text-xs">
                                    {data.globalHistory.map((s) => (
                                        <li key={s.id} className="flex items-center justify-between gap-2">
                                            <span><span className="text-muted-foreground">from {formatDate(s.effectiveFrom)} · </span>{describeScheme(s, formatRupeesFromPaise)}{s.note && <span className="text-muted-foreground"> — {s.note}</span>}</span>
                                            {canEdit && <Button type="button" variant="ghost" size="icon" aria-label="Delete" onClick={() => remove(s, "the shop")}><Trash2 size={14} /></Button>}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        {/* Per person: the switch, and their own scheme. */}
                        <div className="overflow-x-auto rounded-lg border border-border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Person</TableHead>
                                        <TableHead className="w-40">Mode</TableHead>
                                        <TableHead>Own scheme</TableHead>
                                        <TableHead className="w-32" />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {data.rows.length === 0 && <TableEmptyRow colSpan={4} message="No current staff." />}
                                    {data.rows.map((r) => {
                                        const open = historyFor === r.userId;
                                        return (
                                            <RowGroup key={r.userId} open={open} row={r} canEdit={canEdit} colSpan={2} onDelete={(s) => remove(s, `${r.name}'s`)}>
                                                <TableRow>
                                                    <TableCell>
                                                        <div className="flex items-center gap-2">
                                                            <UserAvatar avatarUrl={r.avatarUrl} name={r.name} sizePx={32} className="shrink-0" />
                                                            <div className="min-w-0">
                                                                <div className="truncate font-medium">{r.name}</div>
                                                                {r.staffCode && <div className="text-xs text-muted-foreground">{r.staffCode}</div>}
                                                            </div>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell><ModeSelect row={r} canEdit={canEdit} onChange={setMode} /></TableCell>
                                                    <TableCell className="max-w-[24rem] text-sm">
                                                        {r.own ? (
                                                            <div className="whitespace-normal text-xs">
                                                                {describeScheme(r.own, formatRupeesFromPaise)}
                                                                <span className="text-muted-foreground"> · since {formatDate(r.own.effectiveFrom)}</span>
                                                                {r.mode !== "OWN" && <span className="text-muted-foreground"> · not in use</span>}
                                                            </div>
                                                        ) : <span className="text-muted-foreground">{r.mode === "OWN" ? "None yet — set one" : "—"}</span>}
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <div className="flex justify-end gap-1">
                                                            {r.history.length > 0 && (
                                                                <Button type="button" variant="ghost" size="icon" aria-label="History" onClick={() => setHistoryFor(open ? null : r.userId)}><History size={15} /></Button>
                                                            )}
                                                            {canEdit && (
                                                                <Button type="button" variant="outline" size="sm" onClick={() => setEditing({ userId: r.userId, name: r.name, startFrom: r.own ?? data.global })}>
                                                                    <Pencil size={14} /> {r.own ? "Revise" : "Set own"}
                                                                </Button>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            </RowGroup>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                        </TabsContent>

                        <TabsContent value="month">
                        <div className="overflow-x-auto rounded-lg border border-border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-10">#</TableHead>
                                        <TableHead>Person</TableHead>
                                        <TableHead className="w-32">Mode</TableHead>
                                        <TableHead className="max-w-[20rem]">Scheme that applies</TableHead>
                                        <TableHead className="min-w-[12rem]">{isCurrent ? "This month" : monthLabel(month)}</TableHead>
                                        <TableHead className="text-right">Earned</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {ranked.length === 0 && <TableEmptyRow colSpan={6} message="No current staff." />}
                                    {ranked.map((r, i) => {
                                        const m = r.thisMonth;
                                        const open = historyFor === r.userId;
                                        return (
                                            <RowGroup key={r.userId} open={open} row={r} canEdit={false} colSpan={4} onDelete={(s) => remove(s, `${r.name}'s`)}>
                                                <TableRow className={m.outcome?.targetMet ? "bg-emerald-50/60 dark:bg-emerald-950/20" : undefined}>
                                                    <TableCell className="text-muted-foreground">
                                                        {m.outcome?.targetMet ? <Trophy size={16} className="text-amber-500" /> : i + 1}
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex items-center gap-2">
                                                            <UserAvatar avatarUrl={r.avatarUrl} name={r.name} sizePx={32} className="shrink-0" />
                                                            <div className="min-w-0">
                                                                <div className="truncate font-medium">{r.name}</div>
                                                                {r.staffCode && <div className="text-xs text-muted-foreground">{r.staffCode}</div>}
                                                            </div>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-sm">{COMMISSION_MODE_LABELS[r.mode]}</TableCell>
                                                    <TableCell className="max-w-[20rem] text-sm">
                                                        {m.mode === "OFF" ? <span className="text-muted-foreground">Switched off</span>
                                                            : m.scheme ? <div className="line-clamp-2 whitespace-normal text-xs" title={describeScheme(m.scheme, formatRupeesFromPaise)}>{describeScheme(m.scheme, formatRupeesFromPaise)}</div>
                                                            : <span className="text-muted-foreground">{m.mode === "OWN" ? "No own scheme yet" : "No shop scheme yet"}</span>}
                                                    </TableCell>
                                                    <TableCell><TargetProgress month={m} compact /></TableCell>
                                                    <TableCell className="text-right font-medium tabular-nums">
                                                        {m.outcome && m.outcome.totalPaise > 0 ? formatRupeesFromPaise(m.outcome.totalPaise) : <span className="text-muted-foreground">—</span>}
                                                    </TableCell>
                                                </TableRow>
                                            </RowGroup>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                        </TabsContent>
                    </Tabs>
                )}

                {editing && (
                    <CommissionSchemeDialog
                        userId={editing.userId}
                        name={editing.name}
                        startFrom={editing.startFrom}
                        onClose={() => setEditing(null)}
                        onSaved={() => { setEditing(null); reload(); }}
                    />
                )}
            </div>
        </ScrollArea>
    );
}

function ModeSelect({ row: r, canEdit, onChange }: { row: CommissionBoardRow; canEdit: boolean; onChange: (r: CommissionBoardRow, mode: CommissionMode) => void }) {
    if (!canEdit) return <span className="text-sm">{COMMISSION_MODE_LABELS[r.mode]}</span>;
    return (
        <Select value={r.mode} onValueChange={(v) => onChange(r, v as CommissionMode)}>
            <SelectTrigger className="h-8 w-full text-xs" aria-label={`${r.name} commission mode`}><SelectValue /></SelectTrigger>
            <SelectContent>
                {COMMISSION_MODES.map((k) => <SelectItem key={k} value={k}>{COMMISSION_MODE_LABELS[k]}</SelectItem>)}
            </SelectContent>
        </Select>
    );
}

/** The row, and under it (when opened) every own revision the person has had. */
function RowGroup({ row, open, canEdit, colSpan, onDelete, children }: {
    row: CommissionBoardRow;
    open: boolean;
    canEdit: boolean;
    /** Columns the description spans, so the history lines up under either table. */
    colSpan: number;
    onDelete: (s: CommissionSchemeDto) => void;
    children: React.ReactNode;
}) {
    return (
        <>
            {children}
            {open && row.history.map((s) => (
                <TableRow key={s.id} className="bg-muted/30 text-xs">
                    <TableCell className="text-muted-foreground">own, from {formatDate(s.effectiveFrom)}</TableCell>
                    <TableCell colSpan={colSpan}>
                        {describeScheme(s, formatRupeesFromPaise)}
                        {s.note && <span className="text-muted-foreground"> — {s.note}</span>}
                    </TableCell>
                    <TableCell className="text-right">
                        {canEdit && (
                            <Button type="button" variant="ghost" size="icon" aria-label="Delete scheme" onClick={() => onDelete(s)}><Trash2 size={14} /></Button>
                        )}
                    </TableCell>
                </TableRow>
            ))}
        </>
    );
}
