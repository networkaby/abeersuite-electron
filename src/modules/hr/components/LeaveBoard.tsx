"use client";

// Leave — every request in one list, newest first, pending on top. Anyone may
// file their own; HR (hr:leave:approve) decides, and may file for someone else.
// An approval writes LEAVE onto the register for those days.

import { useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Check, Palmtree, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataPageHeader } from "@/shared/components/DataPageHeader";
import { Field } from "@/shared/components/Field";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { SearchableSelect } from "@/shared/components/SearchableSelect";
import { TableEmptyRow } from "@/shared/components/DataTableStates";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { useApiResource, useRealtimeTopics } from "@/shared/hooks";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { formatDate, todayIso } from "@/shared/lib/format/formatDate";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import { LEAVE_KINDS, LEAVE_KIND_LABELS, earliestLeaveDate, leaveNoticeError, type LeaveKind, type LeaveStatus } from "@/shared/lib/schemas/hrAttendanceSchema";
import { isoDaysBetween } from "../lib/attendanceCalendar";
import type { LeaveRequestDto } from "../lib/attendanceTypes";
import type { LeaveBalancePayload } from "../lib/leaveTypes";
import type { StaffRow } from "../lib/staffTypes";

const STATUS_BADGE: Record<LeaveStatus, string> = {
    PENDING:   "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300",
    APPROVED:  "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300",
    REJECTED:  "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300",
    CANCELLED: "text-muted-foreground",
};

export default function LeaveBoard({ canEdit, selfId }: { canEdit: boolean; selfId: number }) {
    const { data, loading, refreshing, error, reload } = useApiResource<LeaveRequestDto[]>("/api/hr/leave");
    useRealtimeTopics(["settings"], reload);
    const [open, setOpen] = useState(false);

    const rows = useMemo(() => {
        const list = data ?? [];
        const rank: Record<LeaveStatus, number> = { PENDING: 0, APPROVED: 1, REJECTED: 2, CANCELLED: 3 };
        return [...list].sort((a, b) => rank[a.status] - rank[b.status] || b.fromDate.localeCompare(a.fromDate));
    }, [data]);
    const pending = rows.filter((r) => r.status === "PENDING").length;

    const decide = async (r: LeaveRequestDto, status: "APPROVED" | "REJECTED" | "CANCELLED") => {
        const verb = status === "APPROVED" ? "Approve" : status === "REJECTED" ? "Reject" : "Cancel";
        /* Approving is the decision that spends a quota, so the balance is fetched
           for that moment rather than held for every row on the board: HR cannot
           judge a request without knowing what the person has already used. */
        let quotaLine = "";
        if (status === "APPROVED") {
            try {
                const { data } = await axios.get<LeaveBalancePayload>(`/api/hr/leave/balance?userId=${r.userId}`);
                const b = data.balances.find((x) => x.code === r.kind);
                if (b && b.quota !== null) {
                    const after = b.taken + r.days;
                    quotaLine = after > b.quota
                        ? ` ${b.name}: ${b.taken} of ${b.quota} used — this takes it to ${after}, so ${after - b.quota} day${after - b.quota === 1 ? "" : "s"} will be unpaid.`
                        : ` ${b.name}: ${b.taken} of ${b.quota} used — this leaves ${b.quota - after}.`;
                }
            } catch {
                /* The balance is a help, not a gate. If it cannot be read, HR still
                   decides; the payroll run works the same figure out on its own. */
            }
        }
        const ok = await confirmAction({
            title: `${verb} ${r.userName}'s leave?`,
            body: `${formatDate(r.fromDate)} to ${formatDate(r.toDate)} — ${r.days} day${r.days === 1 ? "" : "s"}, ${LEAVE_KIND_LABELS[r.kind].toLowerCase()}. ${status === "APPROVED" ? "Those days read as leave on the register." : r.status === "APPROVED" ? "Those days come back off the register." : ""}${quotaLine}`,
            confirmLabel: verb,
            destructive: status !== "APPROVED",
        });
        if (!ok) return;
        try {
            await axios.patch(`/api/hr/leave/${r.id}`, { status });
            toast.success(`Leave ${status.toLowerCase()}`);
            reload();
        } catch (e) {
            toast.error(extractApiError(e, "Could not update the request"));
        }
    };

    return (
        <ScrollArea className="h-full" type="always">
            <div className="px-6 pt-3 pb-6">
                <DataPageHeader
                    title="Leave"
                    subtitle={data ? `${pending} pending${refreshing ? " · refreshing…" : ""}` : "Reading requests…"}
                    icon={<Palmtree size={20} />}
                    actions={<Button type="button" onClick={() => setOpen(true)}><Plus size={16} /> {canEdit ? "File leave" : "Request leave"}</Button>}
                />

                <QueryStateBlock loading={loading} error={error} hasData={!!data} onRetry={reload} />

                {data && (
                    <div className="overflow-x-auto rounded-lg border border-border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Who</TableHead>
                                    <TableHead>From</TableHead>
                                    <TableHead>To</TableHead>
                                    <TableHead className="text-right">Days</TableHead>
                                    <TableHead>Kind</TableHead>
                                    <TableHead>Reason</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="w-28" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rows.length === 0 ? (
                                    <TableEmptyRow colSpan={8} message="No leave requests yet." />
                                ) : rows.map((r) => (
                                    <TableRow key={r.id}>
                                        <TableCell className="font-medium">{r.userName}</TableCell>
                                        <TableCell className="whitespace-nowrap">{formatDate(r.fromDate)}</TableCell>
                                        <TableCell className="whitespace-nowrap">{formatDate(r.toDate)}</TableCell>
                                        <TableCell className="text-right tabular-nums">{r.days}</TableCell>
                                        <TableCell>{LEAVE_KIND_LABELS[r.kind]}</TableCell>
                                        <TableCell className="max-w-64 truncate text-muted-foreground" title={r.reason ?? undefined}>{r.reason ?? ""}</TableCell>
                                        <TableCell><Badge variant="outline" className={STATUS_BADGE[r.status]}>{r.status.charAt(0) + r.status.slice(1).toLowerCase()}</Badge></TableCell>
                                        <TableCell>
                                            <div className="flex justify-end gap-1">
                                                {canEdit && r.status === "PENDING" && (
                                                    <>
                                                        <Button type="button" size="icon-sm" variant="outline" aria-label="Approve" title="Approve" onClick={() => void decide(r, "APPROVED")}><Check size={14} /></Button>
                                                        <Button type="button" size="icon-sm" variant="outline" aria-label="Reject" title="Reject" onClick={() => void decide(r, "REJECTED")}><X size={14} /></Button>
                                                    </>
                                                )}
                                                {(r.status === "PENDING" && r.userId === selfId && !canEdit) || (canEdit && r.status === "APPROVED") ? (
                                                    <Button type="button" size="sm" variant="ghost" onClick={() => void decide(r, "CANCELLED")}>Cancel</Button>
                                                ) : null}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}

                {open && <LeaveDialog canPickPerson={canEdit} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload(); }} />}
            </div>
        </ScrollArea>
    );
}

export function LeaveDialog({ canPickPerson, heldToNotice = !canPickPerson, onClose, onSaved }: { canPickPerson: boolean; heldToNotice?: boolean; onClose: () => void; onSaved: () => void }) {
    const { data: staff } = useApiResource<StaffRow[]>(canPickPerson ? "/api/hr/staff" : null);
    const [userId, setUserId] = useState<number | null>(null);
    const [kind, setKind] = useState<LeaveKind>("CASUAL");
    /* The notice rule only binds a person asking for his own leave. HR filing by
       hand is outside it, so the dialog stops nagging the moment it can pick a
       person. The server holds the same line — this is only to save the trip. */
    const held = heldToNotice;
    const earliest = earliestLeaveDate(kind, todayIso());
    const [fromDate, setFromDate] = useState(held ? earliest : todayIso());
    const [toDate, setToDate] = useState(held ? earliest : todayIso());
    const [reason, setReason] = useState("");
    const [saving, setSaving] = useState(false);
    const options = useMemo(() => (staff ?? []).map((s) => ({ value: s.id, label: s.name })), [staff]);
    const notice = held ? leaveNoticeError(kind, fromDate, todayIso()) : null;

    /* What this person has left of this kind. Read for whoever the leave is FOR —
       HR filing on somebody's behalf needs that person's balance, not their own —
       and re-read when the person changes, which the URL does on its own. */
    const { data: balance } = useApiResource<LeaveBalancePayload>(
        `/api/hr/leave/balance${userId ? `?userId=${userId}` : ""}`,
    );
    const mine = balance?.balances.find((b) => b.code === kind);
    const asked = fromDate && toDate && toDate >= fromDate ? isoDaysBetween(fromDate, toDate).length : 0;
    /* Going over never blocks — the owner's call. It warns, HR still decides, and
       the days past the quota are the ones payroll leaves unpaid. */
    const overBy = mine && mine.quota !== null ? Math.max(0, mine.taken + asked - mine.quota) : 0;

    /* Switching Casual → Sick and back moves the earliest day, so a From that is
       now too early is pushed forward rather than left sitting there invalid. */
    const pickKind = (next: LeaveKind) => {
        setKind(next);
        if (!held) return;
        const first = earliestLeaveDate(next, todayIso());
        if (fromDate < first) {
            setFromDate(first);
            if (toDate < first) setToDate(first);
        }
    };

    const submit = async () => {
        setSaving(true);
        try {
            await axios.post("/api/hr/leave", { userId: userId ?? undefined, fromDate, toDate, kind, reason: reason.trim() || null });
            toast.success("Leave filed");
            onSaved();
        } catch (e) {
            toast.error(extractApiError(e, "Could not file the leave"));
        } finally { setSaving(false); }
    };

    return (
        <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{canPickPerson ? "File leave" : "Request leave"}</DialogTitle>
                    <DialogDescription>{canPickPerson ? "Leave a person blank to file for yourself." : "HR will approve or reject it."}</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    {canPickPerson && (
                        <Field label="Who">
                            {(id) => <div id={id}><SearchableSelect value={userId} options={options} onChange={setUserId} placeholder="Myself" ariaLabel="Who" triggerClassName="h-9 w-full text-sm" /></div>}
                        </Field>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="From">{(id) => <TallyDateInput id={id} value={fromDate} onValueChange={setFromDate} className="h-9 text-sm" />}</Field>
                        <Field label="To">{(id) => <TallyDateInput id={id} value={toDate} onValueChange={setToDate} monthMode="end" className="h-9 text-sm" />}</Field>
                    </div>
                    <Field label="Kind">
                        {(id) => (
                            <Select value={kind} onValueChange={(v) => pickKind(v as LeaveKind)}>
                                <SelectTrigger id={id} className="h-9 w-full text-sm"><SelectValue /></SelectTrigger>
                                <SelectContent>{LEAVE_KINDS.map((k) => <SelectItem key={k} value={k}>{LEAVE_KIND_LABELS[k]}</SelectItem>)}</SelectContent>
                            </Select>
                        )}
                    </Field>
                    {notice && <p className="text-xs text-destructive">{notice}</p>}
                    {mine && (
                        <p className="text-xs text-muted-foreground">
                            {mine.quota === null
                                ? `${mine.name} leave has no limit. ${mine.taken} taken this year.`
                                : `${mine.name}: ${mine.left} of ${mine.quota} left this year (${mine.taken} taken${mine.pending ? `, ${mine.pending} awaiting a decision` : ""}).`}
                        </p>
                    )}
                    {overBy > 0 && (
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                            This is {overBy} day{overBy === 1 ? "" : "s"} more than the {mine!.name.toLowerCase()} leave
                            allowed in a year. It can still be sent — HR decides — but {overBy === 1 ? "that day" : "those days"} will
                            be unpaid if approved.
                        </p>
                    )}
                    <Field label="Reason (optional)">
                        {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} className="h-9 text-sm" />}
                    </Field>
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                    <Button type="button" disabled={saving || !fromDate || !toDate || toDate < fromDate || !!notice} onClick={() => void submit()}>{saving ? "Saving…" : "Save"}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
