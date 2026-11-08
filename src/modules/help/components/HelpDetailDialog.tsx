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
    Dialog, DialogContent, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PRIORITY_META } from "@/shared/lib/constants/badges";
import {
    Pencil, Trash2, ArrowRightLeft, Wrench, Network, Loader2, RotateCcw,
    ArrowLeft, X, Phone, Mail, Clock, MessageSquare, CheckCircle2, FileText,

} from "lucide-react";
import UserAvatar from "@/shared/components/UserAvatar";
import {
    CLOSE_OUTCOMES, INQUIRY_LABEL, OUTCOME_LABEL, helpCustomerName, helpTitle,
    type HelpDetailDto, type HelpStage,
} from "../lib/types";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import { useValueChange } from "@/shared/hooks/useValueChange";
import { MessageMedia } from "@/modules/crm/components/MessageMedia";
import { groupTicketChat } from "@/modules/message/lib/ticketChatRuns";
import { TicketChatRunCard } from "@/modules/message/components/TicketChatRun";

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

    const readTicket = useCallback((id: number) => axios.get<HelpDetailDto>(`/api/help/${id}`)
        .then((res) => setTicket(res.data))
        .catch(() => { toast.error("Failed to load help ticket"); })
        .finally(() => setLoading(false)), []);
    const load = useCallback(async () => {
        if (ticketId == null) return;
        setLoading(true);
        await readTicket(ticketId);
    }, [ticketId, readTicket]);

    // Opening a ticket clears the composer and shows the spinner — while rendering.
    const openTicketId = open && ticketId != null ? ticketId : null;
    if (useValueChange(openTicketId, null) && openTicketId != null) {
        setNote("");
        setDeviceOpen(false);
        setDevice({ deviceType: "", brand: "", model: "", problem: "" });
        setLoading(true);
    }
    useEffect(() => {
        if (openTicketId != null) void readTicket(openTicketId);
    }, [openTicketId, readTicket]);

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
        if (ticketId == null || !(await confirmAction({ title: "Delete this help ticket?", confirmLabel: "Delete" }))) return;
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
            <DialogContent
                showCloseButton={false}
                onInteractOutside={(e) => e.preventDefault()}
                className="flex h-[94vh] max-h-[94vh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[96vw]"
            >
                <DialogTitle className="sr-only">
                    {ticket ? helpTitle(ticket) : "Help ticket"}
                </DialogTitle>
                <DialogDescription className="sr-only">
                    Help ticket details, customer enquiry, advice timeline, and workflow actions.
                </DialogDescription>

                {/* Top Bar — Receipt Voucher style */}
                <header className="flex shrink-0 items-center justify-between gap-4 border-b bg-card px-4 py-2.5">
                    <div className="flex items-center gap-3 min-w-0">
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => onOpenChange(false)}
                            title="Back / Close (Esc)"
                        >
                            <ArrowLeft className="size-4" />
                        </Button>
                        <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
                            <span className="text-base font-semibold text-foreground truncate max-w-[280px] sm:max-w-[380px]">
                                {ticket ? helpTitle(ticket) : (loading ? "Loading…" : "Help ticket")}
                            </span>
                            {priority && (
                                <Badge className={`shrink-0 ${priority.color ?? ""}`}>
                                    {priority.label}
                                </Badge>
                            )}
                            {ticket && (
                                <span className={`rounded-md px-2 py-0.5 text-xs font-semibold shrink-0 ${ticket.ticketStatus.color}`}>
                                    {ticket.ticketStatus.label}
                                </span>
                            )}
                            {ticket?.inquiryType && (
                                <Badge variant="secondary" className="shrink-0 text-xs">
                                    {INQUIRY_LABEL[ticket.inquiryType]}
                                </Badge>
                            )}
                            {ticket?.outcome && (
                                <Badge variant="outline" className="shrink-0 text-xs">
                                    {OUTCOME_LABEL[ticket.outcome]}
                                </Badge>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-3 text-xs shrink-0">
                        {ticket && (
                            <div className="flex items-center gap-2">
                                <span className="text-muted-foreground uppercase tracking-wide">Ticket No.</span>
                                <span className="font-mono tabular-nums px-2.5 py-1 rounded bg-muted/40 border border-border min-w-[70px] text-center font-medium">
                                    #{ticket.id}
                                </span>
                            </div>
                        )}
                        {ticket && (
                            <div className="hidden sm:flex items-center gap-2">
                                <span className="text-muted-foreground uppercase tracking-wide">Created</span>
                                <span className="px-2.5 py-1 rounded bg-muted/40 border border-border text-center text-muted-foreground">
                                    {formatDateTime(ticket.createdAt)}
                                </span>
                            </div>
                        )}
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => onOpenChange(false)}
                            title="Close (Esc)"
                            aria-label="Close"
                        >
                            <X className="size-4" />
                        </Button>
                    </div>
                </header>

                {/* Body Content */}
                {loading && !ticket ? (
                    <div className="flex flex-1 items-center justify-center py-20 text-muted-foreground">
                        <Loader2 className="size-6 animate-spin mr-2" /> Loading ticket details…
                    </div>
                ) : ticket ? (
                    <div className="flex-1 overflow-y-auto bg-muted/20 p-6">
                        <div className="mx-auto max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                            {/* Left Column: Customer info, Notes & Timeline (7 cols) */}
                            <div className="lg:col-span-7 xl:col-span-8 space-y-6">
                                {/* Customer & Enquiry Summary Card */}
                                <div className="rounded-xl border bg-card p-5 shadow-sm space-y-4">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex items-center gap-3">
                                            <div className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-base shrink-0">
                                                {customer ? customer[0].toUpperCase() : "C"}
                                            </div>
                                            <div>
                                                <div className="font-semibold text-foreground text-base">
                                                    {customer}
                                                    {ticket.person && <span className="ml-2 text-xs font-normal text-muted-foreground">(Person)</span>}
                                                    {ticket.company && <span className="ml-2 text-xs font-normal text-muted-foreground">(Company)</span>}
                                                </div>
                                                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mt-0.5">
                                                    {ticket.phone && (
                                                        <div className="flex items-center gap-1">
                                                            <Phone className="size-3 text-muted-foreground/70" />
                                                            <span>{ticket.phone}</span>
                                                            <a
                                                                href={`https://wa.me/${ticket.phone.replace(/\D/g, "")}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="ml-1 text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-0.5"
                                                                title="Open WhatsApp chat"
                                                            >
                                                                <MessageSquare className="size-3" /> WhatsApp
                                                            </a>
                                                        </div>
                                                    )}
                                                    {ticket.email && (
                                                        <div className="flex items-center gap-1">
                                                            <Mail className="size-3 text-muted-foreground/70" />
                                                            <a href={`mailto:${ticket.email}`} className="hover:underline">{ticket.email}</a>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        {ticket.createdBy && (
                                            <div className="text-right text-xs text-muted-foreground shrink-0">
                                                <span className="block text-[11px] text-muted-foreground/70 uppercase">Logged by</span>
                                                <span className="font-medium text-foreground/80">{ticket.createdBy.userName}</span>
                                            </div>
                                        )}
                                    </div>

                                    {ticket.notes && (
                                        <div className="rounded-lg bg-muted/40 p-4 border border-border/60">
                                            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                                                <FileText className="size-3.5" /> Enquiry / Description
                                            </div>
                                            <p className="whitespace-pre-wrap text-sm text-foreground/90 leading-relaxed font-normal">
                                                {ticket.notes}
                                            </p>
                                        </div>
                                    )}
                                </div>

                                {/* Timeline & Activity History Card */}
                                <div className="rounded-xl border bg-card p-5 shadow-sm space-y-4">
                                    <div className="flex items-center justify-between border-b pb-3">
                                        <div className="flex items-center gap-2">
                                            <Clock className="size-4 text-muted-foreground" />
                                            <h3 className="font-semibold text-sm text-foreground">Timeline & Activity History</h3>
                                            <Badge variant="secondary" className="text-xs px-2 py-0">
                                                {ticket.logs.length}
                                            </Badge>
                                        </div>
                                    </div>

                                    {/* Advice Note Composer */}
                                    {canEdit && !isClosed && (
                                        <div className="space-y-2 rounded-lg border bg-muted/20 p-3.5">
                                            <Label className="text-xs font-medium text-muted-foreground">Log advice or internal note</Label>
                                            <div className="flex gap-2.5">
                                                <Textarea
                                                    value={note}
                                                    onChange={(e) => setNote(e.target.value)}
                                                    rows={2}
                                                    placeholder="Log advice given to customer or internal note…"
                                                    className="min-h-[60px] text-sm bg-background resize-none"
                                                />
                                                <Button
                                                    size="sm"
                                                    className="self-end"
                                                    disabled={busy || !note.trim()}
                                                    onClick={() => patch({ logNote: note.trim() }, "Note added").then(() => setNote(""))}
                                                >
                                                    {busy ? <Loader2 className="size-3.5 animate-spin mr-1" /> : null} Add Note
                                                </Button>
                                            </div>
                                        </div>
                                    )}

                                    {/* Timeline Logs List */}
                                    {ticket.logs.length === 0 ? (
                                        <div className="py-8 text-center text-sm text-muted-foreground">
                                            No activity logged yet.
                                        </div>
                                    ) : (
                                        <div className="space-y-3 pt-1">
                                            {groupTicketChat(ticket.logs).map((item) => item.kind === "chat" ? (
                                                <TicketChatRunCard key={item.key} run={item} />
                                            ) : ((l) => (
                                                <div key={l.id} className="relative flex gap-3 rounded-lg border bg-background/60 p-3.5 text-sm transition-colors">
                                                    <UserAvatar
                                                        avatarUrl={l.author?.avatarUrl}
                                                        name={l.author?.userName ?? "System"}
                                                        sizePx={32}
                                                        className="mt-0.5"
                                                    />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center justify-between gap-2 text-xs">
                                                            <div className="flex items-center gap-1.5 font-medium text-foreground">
                                                                <span>{l.author?.userName ?? "System"}</span>
                                                                {l.author?.positionTitle && (
                                                                    <span className="text-[11px] text-muted-foreground font-normal">
                                                                        ({l.author.positionTitle})
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <span className="text-muted-foreground tabular-nums">
                                                                {formatDateTime(l.createdAt)}
                                                            </span>
                                                        </div>
                                                        {l.note && (
                                                            <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground/90 leading-relaxed">
                                                                {l.note}
                                                            </p>
                                                        )}
                                                        {l.media && (
                                                            <div className="mt-2 w-fit max-w-full [&_img]:max-h-56 [&_video]:max-h-56">
                                                                <MessageMedia m={l.media} />
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            ))(item.log))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Right Column: Actions, Convert & Details (5 cols) */}
                            <div className="lg:col-span-5 xl:col-span-4 space-y-6">
                                {/* Stage & Resolution Card */}
                                <div className="rounded-xl border bg-card p-5 shadow-sm space-y-4">
                                    <h3 className="font-semibold text-sm text-foreground">Stage & Resolution</h3>

                                    {canEdit && !isClosed && (
                                        <div className="space-y-4">
                                            {/* Stage */}
                                            <div className="space-y-1.5">
                                                <Label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Stage</Label>
                                                <Select value={ticket.status} onValueChange={(v) => patch({ status: v }, "Stage updated")} disabled={busy}>
                                                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        {stages.filter((s) => !s.isTerminal).map((s) => (
                                                            <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                            {/* Close with outcome */}
                                            <div className="space-y-2 pt-2 border-t">
                                                <Label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Close Ticket</Label>
                                                <p className="text-xs text-muted-foreground">Select an outcome to resolve and close this ticket:</p>
                                                <div className="flex flex-col gap-1.5">
                                                    {CLOSE_OUTCOMES.map((o) => (
                                                        <Button
                                                            key={o.value}
                                                            size="sm"
                                                            variant="outline"
                                                            className="justify-start text-xs h-8 border hover:bg-muted/60"
                                                            disabled={busy}
                                                            title={o.hint}
                                                            onClick={() => patch({ outcome: o.value }, "Ticket closed")}
                                                        >
                                                            <CheckCircle2 className="size-3.5 mr-2 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                                            <span>{o.label}</span>
                                                        </Button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Closed ticket state */}
                                    {canEdit && isClosed && (
                                        <div className="rounded-lg border border-dashed p-4 bg-muted/20 space-y-3">
                                            <div>
                                                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground block">Status</span>
                                                <span className="text-sm font-medium text-foreground">
                                                    Closed{ticket.outcome ? ` — ${OUTCOME_LABEL[ticket.outcome]}` : ""}
                                                </span>
                                                {ticket.closedAt && (
                                                    <span className="text-xs text-muted-foreground block mt-0.5">
                                                        at {formatDateTime(ticket.closedAt)}
                                                    </span>
                                                )}
                                            </div>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="w-full"
                                                disabled={busy}
                                                onClick={() => {
                                                    const openStage = stages.find((s) => !s.isTerminal);
                                                    if (openStage) patch({ status: openStage.id }, "Reopened");
                                                }}
                                            >
                                                <RotateCcw className="size-3.5 mr-1.5" /> Reopen Ticket
                                            </Button>
                                        </div>
                                    )}
                                </div>

                                {/* Convert Card (open tickets only) */}
                                {canEdit && !isClosed && (
                                    <div className="rounded-xl border bg-card p-5 shadow-sm space-y-4">
                                        <div>
                                            <h3 className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                                                <ArrowRightLeft className="size-4 text-primary" /> Convert Ticket
                                            </h3>
                                            <p className="text-xs text-muted-foreground mt-0.5">Escalate this enquiry into active workflow</p>
                                        </div>

                                        <div className="space-y-2">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="w-full justify-start h-9"
                                                disabled={busy}
                                                onClick={() => convert({ target: "deal" })}
                                            >
                                                <Network className="size-4 mr-2 text-primary shrink-0" />
                                                <span>To CRM Lead (Deal)</span>
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="w-full justify-start h-9"
                                                disabled={busy}
                                                onClick={() => setDeviceOpen((o) => !o)}
                                            >
                                                <Wrench className="size-4 mr-2 text-amber-600 dark:text-amber-400 shrink-0" />
                                                <span>To Service Ticket (Repair)</span>
                                            </Button>
                                        </div>

                                        {deviceOpen && (
                                            <div className="space-y-2 rounded-lg border border-dashed p-3 bg-muted/20">
                                                <div className="text-xs font-medium text-foreground">Device Details for Service Ticket</div>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <Input placeholder="Device type *" value={device.deviceType} onChange={(e) => setDevice((d) => ({ ...d, deviceType: e.target.value }))} className="h-8 text-xs bg-background" />
                                                    <Input placeholder="Brand *" value={device.brand} onChange={(e) => setDevice((d) => ({ ...d, brand: e.target.value }))} className="h-8 text-xs bg-background" />
                                                    <Input placeholder="Model *" value={device.model} onChange={(e) => setDevice((d) => ({ ...d, model: e.target.value }))} className="h-8 text-xs bg-background" />
                                                    <Input placeholder="Problem *" value={device.problem} onChange={(e) => setDevice((d) => ({ ...d, problem: e.target.value }))} className="h-8 text-xs bg-background" />
                                                </div>
                                                <Button
                                                    size="sm"
                                                    className="w-full mt-1"
                                                    disabled={busy || !device.deviceType.trim() || !device.brand.trim() || !device.model.trim() || !device.problem.trim()}
                                                    onClick={() => convert({ target: "service", ...device })}
                                                >
                                                    {busy ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Wrench className="size-3.5 mr-1.5" />}
                                                    Create service ticket & close
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Assignment & Meta Card */}
                                <div className="rounded-xl border bg-card p-5 shadow-sm space-y-3">
                                    <h3 className="font-semibold text-sm text-foreground">Assignment & Details</h3>

                                    <div className="space-y-2 pt-1 text-xs divide-y">
                                        <div className="flex items-center justify-between pb-2">
                                            <span className="text-muted-foreground">Assigned Seat</span>
                                            <span className="font-medium text-foreground">
                                                {ticket.assignedPosition?.title ?? "Unassigned"}
                                            </span>
                                        </div>
                                        {ticket.assignedPosition?.holders && ticket.assignedPosition.holders.length > 0 && (
                                            <div className="flex items-center justify-between py-2">
                                                <span className="text-muted-foreground">Assigned To</span>
                                                <div className="flex items-center gap-1.5">
                                                    {ticket.assignedPosition.holders.map((h) => (
                                                        <span key={h.user.id} className="font-medium text-foreground">
                                                            {h.user.name}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {ticket.assignedPosition?.branch && (
                                            <div className="flex items-center justify-between py-2">
                                                <span className="text-muted-foreground">Branch</span>
                                                <span className="font-medium text-foreground">{ticket.assignedPosition.branch.name}</span>
                                            </div>
                                        )}
                                        <div className="flex items-center justify-between py-2">
                                            <span className="text-muted-foreground">Priority</span>
                                            {priority && (
                                                <Badge className={`text-[11px] ${priority.color ?? ""}`}>
                                                    {priority.label}
                                                </Badge>
                                            )}
                                        </div>
                                        <div className="flex items-center justify-between pt-2">
                                            <span className="text-muted-foreground">Inquiry Type</span>
                                            <span className="font-medium text-foreground">
                                                {ticket.inquiryType ? INQUIRY_LABEL[ticket.inquiryType] : "—"}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : null}

                {/* Footer Actions — Receipt Voucher style */}
                <footer className="flex shrink-0 items-center justify-between gap-4 border-t bg-card px-6 py-3">
                    <div>
                        {canDelete && ticket && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                disabled={busy}
                                onClick={remove}
                            >
                                <Trash2 className="size-4 mr-1.5" /> Delete Ticket
                            </Button>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {canEdit && ticket && (
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() => onEdit(ticket)}
                            >
                                <Pencil className="size-4 mr-1.5" /> Edit
                            </Button>
                        )}
                        <Button size="sm" onClick={() => onOpenChange(false)}>
                            Close
                        </Button>
                    </div>
                </footer>
            </DialogContent>
        </Dialog>
    );
}
