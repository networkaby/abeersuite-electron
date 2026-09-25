"use client";

// Leave — what is left of each kind, every application, and a way to withdraw
// one still pending. The board where HR decides is elsewhere; this is yours.

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Palmtree } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { TableEmptyRow } from "@/shared/components/DataTableStates";
import { Section } from "@/shared/components/StatCard";
import { useApiResource } from "@/shared/hooks";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { formatDate } from "@/shared/lib/format/formatDate";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import { LEAVE_KIND_LABELS, type LeaveStatus } from "@/shared/lib/schemas/hrAttendanceSchema";
import type { LeaveRequestDto } from "../../lib/attendanceTypes";
import type { MyHrPayload } from "../../lib/myHrTypes";

export const LEAVE_STATUS_BADGE: Record<LeaveStatus, string> = {
    PENDING:   "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300",
    APPROVED:  "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300",
    REJECTED:  "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300",
    CANCELLED: "text-muted-foreground",
};

export default function PortalLeave({ me, onRequestLeave }: {
    me: ReturnType<typeof useApiResource<MyHrPayload>>; onRequestLeave: () => void;
}) {
    const data = me.data;
    const [busy, setBusy] = useState<number | null>(null);

    // Only a PENDING request of your own can be withdrawn — the route holds the
    // same line, so this is a courtesy, not the guard.
    const withdraw = async (r: LeaveRequestDto) => {
        const ok = await confirmAction({
            title: "Withdraw this leave application?",
            body: `${formatDate(r.fromDate)} – ${formatDate(r.toDate)}, ${r.days} day${r.days === 1 ? "" : "s"} of ${LEAVE_KIND_LABELS[r.kind]}. You can apply again later.`,
            confirmLabel: "Withdraw",
        });
        if (!ok) return;
        setBusy(r.id);
        try {
            await axios.patch(`/api/hr/leave/${r.id}`, { status: "CANCELLED" });
            toast.success("Application withdrawn");
            me.reload();
        } catch (e) {
            toast.error(extractApiError(e, "Could not withdraw the application"));
        } finally { setBusy(null); }
    };

    return (
        <div className="space-y-6">
            <QueryStateBlock loading={me.loading} error={me.error} hasData={!!data} onRetry={me.reload} />
            {data && (
                <>
                    <Section title="Leave left" icon={<Palmtree size={15} />}
                        right={<span className="text-xs text-muted-foreground">Leave year {data.leaveBalance.year.label}</span>}>
                        <div className="flex flex-wrap gap-2">
                            {data.leaveBalance.balances.map((b) => (
                                <div key={b.code} className="min-w-36 rounded-lg border border-border px-3 py-2">
                                    <div className="text-xs text-muted-foreground">{b.name}{b.paid ? "" : " (unpaid)"}</div>
                                    <div className="text-sm font-medium tabular-nums">
                                        {b.quota === null ? `${b.taken} taken` : `${b.left} left of ${b.quota}`}
                                    </div>
                                    {b.pending > 0 && <div className="text-[11px] text-amber-700 dark:text-amber-400">{b.pending} awaiting a decision</div>}
                                </div>
                            ))}
                        </div>
                    </Section>

                    <Section title="My applications" icon={<Palmtree size={15} />}
                        right={<Button type="button" size="sm" onClick={onRequestLeave}>Request leave</Button>}>
                        <div className="overflow-x-auto rounded-lg border border-border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>From</TableHead>
                                        <TableHead>To</TableHead>
                                        <TableHead className="text-right">Days</TableHead>
                                        <TableHead>Kind</TableHead>
                                        <TableHead>Reason</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="w-24" />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {data.leaves.length === 0 ? (
                                        <TableEmptyRow colSpan={7} message="You have not applied for any leave yet." />
                                    ) : data.leaves.map((r) => (
                                        <TableRow key={r.id}>
                                            <TableCell className="whitespace-nowrap">{formatDate(r.fromDate)}</TableCell>
                                            <TableCell className="whitespace-nowrap">{formatDate(r.toDate)}</TableCell>
                                            <TableCell className="text-right tabular-nums">{r.days}</TableCell>
                                            <TableCell>{LEAVE_KIND_LABELS[r.kind]}</TableCell>
                                            <TableCell className="max-w-64 truncate text-muted-foreground" title={r.reason ?? undefined}>{r.reason ?? ""}</TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className={LEAVE_STATUS_BADGE[r.status]}>
                                                    {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                                                </Badge>
                                                {r.decisionNote && <div className="mt-0.5 text-[11px] text-muted-foreground">{r.decisionNote}</div>}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {r.status === "PENDING" && (
                                                    <Button type="button" size="sm" variant="ghost" disabled={busy === r.id} onClick={() => void withdraw(r)}>Withdraw</Button>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </Section>

                    {data.holidays.length > 0 && (
                        <Section title="Shop holidays this month" icon={<Palmtree size={15} />}>
                            <div className="flex flex-wrap gap-2 text-sm">
                                {data.holidays.map((h) => (
                                    <span key={h.id} className="rounded-lg border border-border px-3 py-1.5">{formatDate(h.date)} — {h.name}</span>
                                ))}
                            </div>
                        </Section>
                    )}
                </>
            )}
        </div>
    );
}
