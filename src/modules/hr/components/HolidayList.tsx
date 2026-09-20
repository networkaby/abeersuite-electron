"use client";

// The shop's holiday list, one year at a time. A holiday reads as H on the
// register for everyone (branch-specific holidays are stored but the register
// does not yet filter by branch).

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
import type { HolidayDto } from "../lib/attendanceTypes";

export default function HolidayList({ canEdit }: { canEdit: boolean; selfId: number }) {
    const [year, setYear] = useState(Number(todayIso().slice(0, 4)));
    const { data, loading, error, reload } = useApiResource<HolidayDto[]>(`/api/hr/holidays?year=${year}`);
    useRealtimeTopics(["settings"], reload);
    const [date, setDate] = useState("");
    const [name, setName] = useState("");
    const [saving, setSaving] = useState(false);

    const add = async () => {
        setSaving(true);
        try {
            await axios.post("/api/hr/holidays", { date, name: name.trim() });
            toast.success("Holiday added");
            setName(""); setDate("");
            if (date.slice(0, 4) !== String(year)) setYear(Number(date.slice(0, 4))); else reload();
        } catch (e) {
            toast.error(extractApiError(e, "Could not add the holiday"));
        } finally { setSaving(false); }
    };

    const remove = async (h: HolidayDto) => {
        if (!(await confirmAction({ title: `Remove ${h.name}?`, body: `${formatDate(h.date)} reads as a working day again on the register.`, confirmLabel: "Remove" }))) return;
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
                    title="Holidays"
                    subtitle={data ? `${data.length} in ${year}` : "Reading the list…"}
                    icon={<CalendarOff size={20} />}
                    actions={
                        <div className="flex items-center gap-1">
                            <Button type="button" variant="outline" size="sm" onClick={() => setYear((y) => y - 1)}>{year - 1}</Button>
                            <span className="px-2 text-sm font-medium">{year}</span>
                            <Button type="button" variant="outline" size="sm" onClick={() => setYear((y) => y + 1)}>{year + 1}</Button>
                        </div>
                    }
                />

                {canEdit && (
                    <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
                        <Field label="Date" className="w-40">
                            {(id) => <TallyDateInput id={id} value={date} onValueChange={setDate} className="h-9 text-sm" />}
                        </Field>
                        <Field label="Holiday" className="min-w-56 flex-1">
                            {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Diwali, Independence Day…" className="h-9 text-sm" onKeyDown={(e) => { if (e.key === "Enter" && date && name.trim()) void add(); }} />}
                        </Field>
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
                                    {canEdit && <TableHead className="w-12" />}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {data.length === 0 ? (
                                    <TableEmptyRow colSpan={canEdit ? 3 : 2} message={`No holidays listed for ${year}.`} />
                                ) : data.map((h) => (
                                    <TableRow key={h.id}>
                                        <TableCell className="whitespace-nowrap">{formatDate(h.date)}</TableCell>
                                        <TableCell>{h.name}</TableCell>
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
