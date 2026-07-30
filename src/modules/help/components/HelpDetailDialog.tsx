"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import { formatDateTime } from "@/shared/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PRIORITY_META } from "@/utils/constants";
import { Pencil, Trash2, ArrowRightLeft, Wrench, Network, Loader2, RotateCcw } from "lucide-react";
import {
    CLOSE_OUTCOMES, INQUIRY_LABEL, OUTCOME_LABEL, helpCustomerName, helpTitle,
    type HelpDetailDto, type HelpStage,
} from "../lib/types";

export default function HelpDetailDialog({
    ticketId,
    open,
    onOpenChange,
    stages,
    canEdit,
    canDelete,
    onEdit,
    onChanged,
}: {
    ticketId: number | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    stages: HelpStage[];
    canEdit: boolean;
    canDelete: boolean;
    onEdit: (ticket: HelpDetailDto) => void;
    onChanged: () => void;
}) {
    const router = useRouter();
    const [ticket, setTicket] = useState<HelpDetailDto | null>(null);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState("");
    // Inline device form for "Convert → Service ticket".
    const [deviceOpen, setDeviceOpen] = useState(false);
    const [device, setDevice] = useState({ deviceType: "", brand: "", model: "", problem: "" });

    const load = useCallback(async () => {
        if (ticketId == null) return;
        setLoading(true);
        try {
            const res = await axios.get<HelpDetailDto>(`/api/help/${ticketId}`);
            setTicket(res.data);
        } catch {
            toast.error("Failed to load help ticket");
        } finally {
            setLoading(false);
        }
    }, [ticketId]);

    useEffect(() => {
        if (open && ticketId != null) {
            setNote("");
            setDeviceOpen(false);
            setDevice({ deviceType: "", brand: "", model: "", problem: "" });
            load();
        }
    }, [open, ticketId, load]);

    const patch = async (body: Record<string, unknown>, ok: string) => {
        if (ticketId == null) return;
        setBusy(true);
        try {
            await axios.patch(`/api/help/${ticketId}`, body);
            toast.success(ok);
            await load();
            onChanged();
        } catch (err) {
            toast.error(extractApiError(err, "Update failed"));
        } finally {
            setBusy(false);
        }
    };

    const convert = async (body: Record<string, unknown>) => {
        if (ticketId == null) return;
        setBusy(true);
        try {
            const res = await axios.post<{ href: string; convertedTicketId: number }>(`/api/help/${ticketId}/convert`, body);
            toast.success("Converted");
            onChanged();
            onOpenChange(false);
            router.push(res.data.href);
        } catch (err) {
            toast.error(extractApiError(err, "Convert failed"));
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        if (ticketId == null || !confirm("Delete this help ticket?")) return;
        setBusy(true);
        try {
            await axios.delete(`/api/help/${ticketId}`);
            toast.success("Deleted");
            onChanged();
            onOpenChange(false);
        } catch (err) {
            toast.error(extractApiError(err, "Delete failed"));
        } finally {
            setBusy(false);
        }
    };

    const isClosed = Boolean(ticket?.ticketStatus.isTerminal);
    const priority = ticket ? (PRIORITY_META[ticket.priority] ?? PRIORITY_META.MEDIUM) : null;
    const customer = ticket ? helpCustomerName(ticket) : "";

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {ticket ? helpTitle(ticket) : "Help ticket"}
                        {ticket && <Badge className={`shrink-0 ${priority?.color ?? ""}`}>{priority?.label}</Badge>}
                    </DialogTitle>
                    <DialogDescription>
                        {ticket ? (
                            <>#{ticket.id} · {customer}{ticket.phone ? ` · ${ticket.phone}` : ""}</>
                        ) : loading ? "Loading…" : ""}
                    </DialogDescription>
                </DialogHeader>

                {ticket && (
                    <div className="space-y-5">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                            {ticket.inquiryType && <Badge variant="secondary">{INQUIRY_LABEL[ticket.inquiryType]}</Badge>}
                            <span className={`rounded-md px-2 py-0.5 font-semibold ${ticket.ticketStatus.color}`}>{ticket.ticketStatus.label}</span>
                            {ticket.outcome && <Badge variant="outline">{OUTCOME_LABEL[ticket.outcome]}</Badge>}
                        </div>

                        {ticket.notes && <p className="whitespace-pre-wrap rounded-md bg-muted/50 px-3 py-2 text-sm">{ticket.notes}</p>}

                        {/* Actions (open tickets only) */}
                        {canEdit && !isClosed && (
                            <div className="space-y-4 rounded-lg border p-3">
                                {/* Stage */}
                                <div className="flex items-center gap-2">
                                    <Label className="w-16 shrink-0 text-xs text-muted-foreground">Stage</Label>
                                    <Select value={ticket.status} onValueChange={(v) => patch({ status: v }, "Stage updated")} disabled={busy}>
                                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {/* Only working stages — closing happens via an outcome or Convert, never a bare stage jump. */}
                                            {stages.filter((s) => !s.isTerminal).map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Advise note */}
                                <div className="space-y-1.5">
                                    <Label className="text-xs text-muted-foreground">Advise / note</Label>
                                    <div className="flex gap-2">
                                        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={1} placeholder="Log advice given to the customer…" className="min-h-9" />
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            disabled={busy || !note.trim()}
                                            onClick={() => patch({ logNote: note.trim() }, "Note added").then(() => setNote(""))}
                                        >
                                            Add
                                        </Button>
                                    </div>
                                </div>

                                {/* Convert */}
                                <div className="space-y-2">
                                    <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                        <ArrowRightLeft className="size-3" /> Convert (helps + pushes the sale)
                                    </Label>
                                    <div className="flex flex-wrap gap-2">
                                        <Button size="sm" variant="outline" disabled={busy} onClick={() => convert({ target: "deal" })}>
                                            <Network className="size-3.5" /> To CRM lead
                                        </Button>
                                        <Button size="sm" variant="outline" disabled={busy} onClick={() => setDeviceOpen((o) => !o)}>
                                            <Wrench className="size-3.5" /> To service ticket
                                        </Button>
                                    </div>
                                    {deviceOpen && (
                                        <div className="grid grid-cols-2 gap-2 rounded-md border border-dashed p-2">
                                            <Input placeholder="Device type *" value={device.deviceType} onChange={(e) => setDevice((d) => ({ ...d, deviceType: e.target.value }))} className="h-8" />
                                            <Input placeholder="Brand *" value={device.brand} onChange={(e) => setDevice((d) => ({ ...d, brand: e.target.value }))} className="h-8" />
                                            <Input placeholder="Model *" value={device.model} onChange={(e) => setDevice((d) => ({ ...d, model: e.target.value }))} className="h-8" />
                                            <Input placeholder="Problem *" value={device.problem} onChange={(e) => setDevice((d) => ({ ...d, problem: e.target.value }))} className="h-8" />
                                            <Button
                                                size="sm"
                                                className="col-span-2"
                                                disabled={busy || !device.deviceType.trim() || !device.brand.trim() || !device.model.trim() || !device.problem.trim()}
                                                onClick={() => convert({ target: "service", ...device })}
                                            >
                                                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Wrench className="size-3.5" />} Create service ticket & close
                                            </Button>
                                        </div>
                                    )}
                                </div>

                                {/* Close with an outcome */}
                                <div className="space-y-2 border-t pt-3">
                                    <Label className="text-xs text-muted-foreground">Close</Label>
                                    <div className="flex flex-wrap gap-2">
                                        {CLOSE_OUTCOMES.map((o) => (
                                            <Button key={o.value} size="sm" variant="ghost" className="border" disabled={busy} title={o.hint}
                                                onClick={() => patch({ outcome: o.value }, "Ticket closed")}>
                                                {o.label}
                                            </Button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Closed ticket — reopen to work it again (or convert). */}
                        {canEdit && isClosed && (
                            <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed p-3">
                                <span className="text-sm text-muted-foreground">
                                    Closed{ticket.outcome ? ` — ${OUTCOME_LABEL[ticket.outcome]}` : ""}.
                                </span>
                                <Button size="sm" variant="outline" disabled={busy}
                                    onClick={() => {
                                        const openStage = stages.find((s) => !s.isTerminal);
                                        if (openStage) patch({ status: openStage.id }, "Reopened");
                                    }}>
                                    <RotateCcw className="size-3.5" /> Reopen
                                </Button>
                            </div>
                        )}

                        {/* Timeline */}
                        <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground">Timeline</Label>
                            {ticket.logs.length === 0 ? (
                                <p className="text-xs text-muted-foreground">No activity yet.</p>
                            ) : (
                                <ul className="space-y-2">
                                    {ticket.logs.map((l) => (
                                        <li key={l.id} className="rounded-md border px-3 py-2 text-sm">
                                            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                                <span className="font-medium text-foreground/80">{l.author?.userName ?? "System"}</span>
                                                <span>{formatDateTime(l.createdAt)}</span>
                                            </div>
                                            {l.note && <p className="mt-0.5 whitespace-pre-wrap">{l.note}</p>}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        {/* Footer actions */}
                        <div className="flex items-center justify-between gap-2 border-t pt-3">
                            <div>
                                {canDelete && (
                                    <Button variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={remove}>
                                        <Trash2 className="size-4" /> Delete
                                    </Button>
                                )}
                            </div>
                            <div className="flex gap-2">
                                {canEdit && (
                                    <Button variant="outline" size="sm" disabled={busy} onClick={() => onEdit(ticket)}>
                                        <Pencil className="size-4" /> Edit
                                    </Button>
                                )}
                                <Button size="sm" onClick={() => onOpenChange(false)}>Close</Button>
                            </div>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
