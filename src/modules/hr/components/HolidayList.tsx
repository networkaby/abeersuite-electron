"use client";

// The shop's holiday list, one year at a time. A holiday with no branch reads as
// H on the register for everyone; one listed for a branch reads as H only for
// the people who hold a seat there (see holidayApplies). The branch picker shows
// only when the shop has more than one branch.

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CalendarOff, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataPageHeader } from "@/shared/components/DataPageHeader";
import { Field } from "@/shared/components/Field";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { TableEmptyRow } from "@/shared/components/DataTableStates";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { useApiResource, useRealtimeTopics } from "@/shared/hooks";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { formatDate, todayIso } from "@/shared/lib/format/formatDate";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import GlobalHoursCard from "./GlobalHoursCard";
import LeaveTypesCard from "./LeaveTypesCard";
import type { HolidayDto } from "../lib/attendanceTypes";

type BranchOption = { id: string; name: string; isActive?: boolean };

export default function HolidayList({ canEdit }: { canEdit: boolean; selfId: number }) {
    const [year, setYear] = useState(Number(todayIso().slice(0, 4)));
    const { data, loading, error, reload } = useApiResource<HolidayDto[]>(`/api/hr/holidays?year=${year}`);
    const { data: branches } = useApiResource<BranchOption[]>("/api/branches");
    useRealtimeTopics(["settings"], reload);
    const [date, setDate] = useState("");
    const [name, setName] = useState("");
    // "" = every branch. Offered only when there is a choice to make.
    const [branchId, setBranchId] = useState("");
    const [saving, setSaving] = useState(false);
    const branchChoices = (branches ?? []).filter((b) => b.isActive !== false);
    const multiBranch = branchChoices.length > 1;
    const branchName = (id: string | null) =>
        id === null ? "Every branch" : (branches?.find((b) => b.id === id)?.name ?? id);

    const add = async () => {
        setSaving(true);
        try {
            await axios.post("/api/hr/holidays", { date, name: name.trim(), branchId: branchId || null });
            toast.success("Holiday added");
            setName(""); setDate("");
            if (date.slice(0, 4) !== String(year)) setYear(Number(date.slice(0, 4))); else reload();
        } catch (e) {
            toast.error(extractApiError(e, "Could not add the holiday"));
        } finally { setSaving(false); }
    };

    const remove = async (h: HolidayDto) => {
        if (!(await confirmAction({ title: `Remove ${h.name}?`, body: `${formatDate(h.date)} reads as a working day again on the register${h.branchId ? ` for ${branchName(h.branchId)}` : ""}.`, confirmLabel: "Remove" }))) return;
        try {
            await axios.delete(`/api/hr/holidays/${h.id}`);
            toast.success("Holiday removed");
            reload();
        } catch (e) {
            toast.error(extractApiError(e, "Could not remove the holiday"));
        }
    };

    return (
        <ScrollArea className="h-full" type="always">
            <div className="max-w-3xl px-6 pt-3 pb-6">
                <DataPageHeader
                    title="Calendar & Hours"
                    subtitle={data ? `${data.length} holiday${data.length === 1 ? "" : "s"} in ${year}` : "Reading the list…"}
                    icon={<CalendarOff size={20} />}
                    actions={
                        <div className="flex items-center gap-1">
                            <Button type="button" variant="outline" size="sm" onClick={() => setYear((y) => y - 1)}>{year - 1}</Button>
                            <span className="px-2 text-sm font-medium">{year}</span>
                            <Button type="button" variant="outline" size="sm" onClick={() => setYear((y) => y + 1)}>{year + 1}</Button>
                        </div>
                    }
                />

                {/* The shop's hours sit above the holidays because they are the
                    standing rule and a holiday is the exception to it. Both are
                    global, both are read by the sign-in screen's "opens next" line. */}
                <GlobalHoursCard canEdit={canEdit} />

                {/* How many days of each kind a year allows. Same grant, same page:
                    hours, holidays and leave entitlement are the three standing
                    calendar rules, and they belong where they can be read together. */}
                <div className="mb-4">
                    <LeaveTypesCard canEdit={canEdit} />
                </div>

                {canEdit && (
                    <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
                        <Field label="Date" className="w-40">
                            {(id) => <TallyDateInput id={id} value={date} onValueChange={setDate} className="h-9 text-sm" />}
                        </Field>
                        <Field label="Holiday" className="min-w-56 flex-1">
                            {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Diwali, Independence Day…" className="h-9 text-sm" onKeyDown={(e) => { if (e.key === "Enter" && date && name.trim()) void add(); }} />}
                        </Field>
                        {multiBranch && (
                            <Field label="For" className="w-44">
                                {(id) => (
                                    <select
                                        id={id}
                                        value={branchId}
                                        onChange={(e) => setBranchId(e.target.value)}
                                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                                    >
                                        <option value="">Every branch</option>
                                        {branchChoices.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                                    </select>
                                )}
                            </Field>
                        )}
                        <Button type="button" disabled={saving || !date || !name.trim()} onClick={() => void add()}>
                            <Plus size={16} /> Add
                        </Button>
                    </div>
                )}

                <QueryStateBlock loading={loading} error={error} hasData={!!data} onRetry={reload} />

                {data && (
                    <div className="rounded-lg border border-border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Holiday</TableHead>
                                    <TableHead>For</TableHead>
                                    {canEdit && <TableHead className="w-12" />}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {data.length === 0 ? (
                                    <TableEmptyRow colSpan={canEdit ? 4 : 3} message={`No holidays listed for ${year}.`} />
                                ) : data.map((h) => (
                                    <TableRow key={h.id}>
                                        <TableCell className="whitespace-nowrap">{formatDate(h.date)}</TableCell>
                                        <TableCell>{h.name}</TableCell>
                                        <TableCell className="text-muted-foreground">{branchName(h.branchId)}</TableCell>
                                        {canEdit && (
                                            <TableCell>
                                                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${h.name}`} onClick={() => void remove(h)}><Trash2 size={14} /></Button>
                                            </TableCell>
                                        )}
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </div>
        </ScrollArea>
    );
}
