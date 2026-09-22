"use client";

// Targets & Commission — the board. One row per current staff member: the
// target and scheme in force, this month's own sales against it, what that has
// earned so far. HR sets or revises a scheme from the row; the person sees the
// same month on My Info, through the same arithmetic.

import { useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, History, Pencil, Target, Trash2, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { describeScheme } from "@/shared/lib/hr/commissionScheme";
import type { CommissionBoardPayload, CommissionBoardRow, CommissionSchemeDto } from "../lib/commissionTypes";
import CommissionSchemeDialog from "./CommissionSchemeDialog";
import { TargetProgress, monthLabel, shiftMonth } from "./MyTargetCard";

export default function CommissionBoard({ canEdit }: { canEdit: boolean }) {
    const [month, setMonth] = useState(() => todayIso().slice(0, 7));
    const { data, loading, refreshing, error, reload } = useApiResource<CommissionBoardPayload>(`/api/hr/commission?month=${month}`);
    useRealtimeTopics(["settings", "ledger"], reload);
    const [editing, setEditing] = useState<CommissionBoardRow | null>(null);
    const [historyFor, setHistoryFor] = useState<number | null>(null);

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

    const withScheme = ranked.filter((r) => r.current).length;
    const met = ranked.filter((r) => r.thisMonth.outcome?.targetMet).length;

    const remove = async (s: CommissionSchemeDto, name: string) => {
        const ok = await confirmAction({
            title: `Delete ${name}'s scheme from ${formatDate(s.effectiveFrom)}?`,
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

    return (
        <ScrollArea className="h-full" type="always">
            <div className="px-6 pt-3 pb-6">
                <DataPageHeader
                    title="Targets & Commission"
                    subtitle={data
                        ? `${withScheme} of ${data.rows.length} on a scheme · ${met} reached the target · team sold ${formatRupeesFromPaise(data.teamSalesPaise)}${refreshing ? " · refreshing…" : ""}`
                        : "Reading the board…"}
                    icon={<Target size={20} />}
                    actions={
                        <div className="flex items-center gap-1">
                            <Button type="button" variant="outline" size="icon" aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}><ChevronLeft size={16} /></Button>
                            <span className="min-w-[9rem] text-center text-sm font-medium">{monthLabel(month)}</span>
                            <Button type="button" variant="outline" size="icon" aria-label="Next month" disabled={isCurrent} onClick={() => setMonth((m) => shiftMonth(m, 1))}><ChevronRight size={16} /></Button>
                        </div>
                    }
                />

                <QueryStateBlock loading={loading} error={error} hasData={!!data} onRetry={reload} />

                {data && (
                    <div className="rounded-lg border border-border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-10">#</TableHead>
                                    <TableHead>Person</TableHead>
                                    <TableHead>Scheme in force</TableHead>
                                    <TableHead className="min-w-[14rem]">{isCurrent ? "This month" : monthLabel(month)}</TableHead>
                                    <TableHead className="text-right">Earned</TableHead>
                                    <TableHead className="w-28" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {ranked.length === 0 && <TableEmptyRow colSpan={6} message="No current staff." />}
                                {ranked.map((r, i) => {
                                    const m = r.thisMonth;
                                    const open = historyFor === r.userId;
                                    return (
                                        <RowGroup key={r.userId} open={open} row={r} canEdit={canEdit} onDelete={(s) => remove(s, r.name)}>
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
                                                <TableCell className="text-sm">
                                                    {r.current ? (
                                                        <>
                                                            <div>{r.current.targetPaise > 0 ? `Target ${formatRupeesFromPaise(r.current.targetPaise)} a month` : "No target"}</div>
                                                            <div className="text-xs text-muted-foreground">{describeScheme(r.current, formatRupeesFromPaise)}</div>
                                                        </>
                                                    ) : <span className="text-muted-foreground">Not on a scheme</span>}
                                                </TableCell>
                                                <TableCell>
                                                    <TargetProgress month={m} compact />
                                                </TableCell>
                                                <TableCell className="text-right font-medium tabular-nums">
                                                    {m.outcome && m.outcome.totalPaise > 0 ? formatRupeesFromPaise(m.outcome.totalPaise) : <span className="text-muted-foreground">—</span>}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-1">
                                                        {r.history.length > 0 && (
                                                            <Button type="button" variant="ghost" size="icon" aria-label="History"
                                                                onClick={() => setHistoryFor(open ? null : r.userId)}>
                                                                <History size={15} />
                                                            </Button>
                                                        )}
                                                        {canEdit && (
                                                            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(r)}>
                                                                <Pencil size={14} /> {r.current ? "Revise" : "Set"}
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
                )}

                {editing && (
                    <CommissionSchemeDialog
                        userId={editing.userId}
                        name={editing.name}
                        startFrom={editing.current}
                        onClose={() => setEditing(null)}
                        onSaved={() => { setEditing(null); reload(); }}
                    />
                )}
            </div>
        </ScrollArea>
    );
}

/** The row, and under it (when opened) every revision the person has had. */
function RowGroup({ row, open, canEdit, onDelete, children }: {
    row: CommissionBoardRow;
    open: boolean;
    canEdit: boolean;
    onDelete: (s: CommissionSchemeDto) => void;
    children: React.ReactNode;
}) {
    return (
        <>
            {children}
            {open && row.history.map((s) => (
                <TableRow key={s.id} className="bg-muted/30 text-xs">
                    <TableCell />
                    <TableCell className="text-muted-foreground">from {formatDate(s.effectiveFrom)}</TableCell>
                    <TableCell colSpan={3}>
                        {s.targetPaise > 0 ? `Target ${formatRupeesFromPaise(s.targetPaise)} · ` : ""}{describeScheme(s, formatRupeesFromPaise)}
                        {s.note && <span className="text-muted-foreground"> — {s.note}</span>}
                    </TableCell>
                    <TableCell className="text-right">
                        {canEdit && (
                            <Button type="button" variant="ghost" size="icon" aria-label="Delete scheme" onClick={() => onDelete(s)}>
                                <Trash2 size={14} />
                            </Button>
                        )}
                    </TableCell>
                </TableRow>
            ))}
        </>
    );
}
