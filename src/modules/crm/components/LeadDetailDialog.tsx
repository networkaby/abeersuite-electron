"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import {
    Pencil, Trash2, Send, StickyNote, Phone, CalendarCheck, CheckSquare, Activity as ActivityIcon, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import UserAvatar from "@/shared/components/UserAvatar";
import { TallyDateTimeInput } from "@/shared/components/TallyDateTimeInput";
import { useNow } from "@/shared/hooks";
import { PRIORITY_META } from "@/utils/constants";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { formatDate, formatDateTime } from "@/shared/lib/format";
import type { LeadDetailDto, LeadStage, LeadActivityKind } from "../lib/types";

const ACTIVITY_KINDS: { kind: Exclude<LeadActivityKind, "SYSTEM">; label: string; icon: typeof StickyNote }[] = [
    { kind: "NOTE", label: "Note", icon: StickyNote },
    { kind: "CALL", label: "Call", icon: Phone },
    { kind: "MEETING", label: "Meeting", icon: CalendarCheck },
    { kind: "TASK", label: "Task", icon: CheckSquare },
];
const KIND_ICON: Record<LeadActivityKind, typeof StickyNote> = {
    NOTE: StickyNote, CALL: Phone, MEETING: CalendarCheck, TASK: CheckSquare, SYSTEM: ActivityIcon,
};

export default function LeadDetailDialog({
    leadId,
    open,
    onOpenChange,
    stages,
    canManage,
    onEdit,
    onChanged,
}: {
    leadId: number | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    stages: LeadStage[];
    canManage: boolean;
    onEdit: (lead: LeadDetailDto) => void;
    onChanged: () => void;
}) {
    const [lead, setLead] = useState<LeadDetailDto | null>(null);
    const [loading, setLoading] = useState(false);
    const [composerKind, setComposerKind] = useState<Exclude<LeadActivityKind, "SYSTEM">>("NOTE");
    const [body, setBody] = useState("");
    const [dueAt, setDueAt] = useState("");
    const [posting, setPosting] = useState(false);
    // "now" read in an effect (useNow) — calling Date.now() during render trips react-hooks/purity.
    const now = useNow();

    const load = useCallback(async () => {
        if (!leadId) return;
        setLoading(true);
        try {
            const res = await axios.get(`/api/crm/leads/${leadId}`);
            setLead(res.data);
        } catch {
            toast.error("Failed to load lead");
        } finally {
            setLoading(false);
        }
    }, [leadId]);

    useEffect(() => {
        if (open && leadId) load();
        if (!open) { setLead(null); setBody(""); setDueAt(""); setComposerKind("NOTE"); }
    }, [open, leadId, load]);

    const moveStage = async (status: string) => {
        if (!lead || status === lead.status) return;
        try {
            await axios.patch(`/api/crm/leads/${lead.id}`, { status });
            await load();
            onChanged();
        } catch {
            toast.error("Failed to move lead");
        }
    };

    const addActivity = async () => {
        if (!lead || !body.trim()) return;
        setPosting(true);
        try {
            await axios.post(`/api/crm/leads/${lead.id}/activities`, {
                kind: composerKind,
                body: body.trim(),
                dueAt: composerKind === "TASK" && dueAt ? dueAt : null,
            });
            setBody(""); setDueAt("");
            await load();
            onChanged();
        } catch {
            toast.error("Failed to add activity");
        } finally {
            setPosting(false);
        }
    };

    const toggleTask = async (activityId: number, done: boolean) => {
        if (!lead) return;
        try {
            await axios.patch(`/api/crm/leads/${lead.id}/activities/${activityId}`, { done });
            await load();
        } catch {
            toast.error("Failed to update task");
        }
    };

    const handleDelete = async () => {
        if (!lead) return;
        if (!window.confirm("Delete this lead? This cannot be undone.")) return;
        try {
            await axios.delete(`/api/crm/leads/${lead.id}`);
            toast.success("Lead deleted");
            onOpenChange(false);
            onChanged();
        } catch {
            toast.error("Failed to delete lead");
        }
    };

    const priority = lead ? PRIORITY_META[lead.priority] ?? PRIORITY_META.MEDIUM : null;
    const holders = lead?.assignedPosition?.holders.map((h) => h.user) ?? [];

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl max-h-[88vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="pr-8">{lead?.title ?? (loading ? "Loading…" : "Lead")}</DialogTitle>
                </DialogHeader>

                {lead && (
                    <div className="space-y-5">
                        <div className="flex flex-wrap items-center gap-2">
                            {priority && <Badge className={priority.color}>{priority.label}</Badge>}
                            <Badge className={lead.ticketStatus.color}>{lead.ticketStatus.label}</Badge>
                            {lead.valuePaise != null && (
                                <span className="text-sm font-semibold tabular-nums">{formatRupeesFromPaise(lead.valuePaise)}</span>
                            )}
                            {lead.source && <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{lead.source}</span>}
                        </div>

                        {/* Contact / association */}
                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <div>
                                <div className="text-xs text-muted-foreground">Contact</div>
                                <div className="mt-1">{[lead.contactName, lead.phone].filter(Boolean).join(" · ") || "—"}</div>
                                {lead.email && <div className="text-xs text-muted-foreground">{lead.email}</div>}
                            </div>
                            <div>
                                <div className="text-xs text-muted-foreground">Customer</div>
                                <div className="mt-1">
                                    {lead.person ? (
                                        <Link href={`/office/customers/person/${lead.person.id}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                                            {lead.person.name} <ExternalLink className="size-3" />
                                        </Link>
                                    ) : lead.company ? (
                                        <Link href={`/office/customers/companies/${lead.company.id}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                                            {lead.company.name} <ExternalLink className="size-3" />
                                        </Link>
                                    ) : (
                                        <span className="text-muted-foreground">{lead.companyName || "Not linked"}</span>
                                    )}
                                </div>
                            </div>
                            <div className="col-span-2">
                                <div className="text-xs text-muted-foreground">Owner (position)</div>
                                {lead.assignedPosition ? (
                                    <div className="mt-1">
                                        <span className="font-medium">{lead.assignedPosition.title}</span>
                                        <span className="ml-1.5 inline-flex flex-wrap gap-1.5 align-middle">
                                            {holders.length === 0 ? (
                                                <span className="text-xs italic text-muted-foreground">Vacant seat</span>
                                            ) : holders.map((h) => (
                                                <span key={h.id} className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-xs">
                                                    <UserAvatar name={h.name} avatarUrl={h.avatarUrl} role={h.role} sizePx={16} /> {h.name}
                                                </span>
                                            ))}
                                        </span>
                                    </div>
                                ) : <span className="italic text-muted-foreground">Unassigned</span>}
                            </div>
                            <div>
                                <div className="text-xs text-muted-foreground">Next follow-up</div>
                                <div className="mt-1">{lead.nextFollowUpAt ? formatDate(lead.nextFollowUpAt) : "—"}</div>
                            </div>
                            <div>
                                <div className="text-xs text-muted-foreground">Stage</div>
                                {canManage ? (
                                    <Select value={lead.status} onValueChange={moveStage}>
                                        <SelectTrigger className="mt-1 h-8"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                ) : <div className="mt-1">{lead.ticketStatus.label}</div>}
                            </div>
                            <div className="col-span-2">
                                <div className="text-xs text-muted-foreground">Created by</div>
                                <div className="mt-1">
                                    {lead.createdBy.userName}{lead.createdBy.positionTitle ? ` · ${lead.createdBy.positionTitle}` : ""}
                                </div>
                            </div>
                        </div>

                        {lead.notes && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{lead.notes}</p>}

                        {canManage && (
                            <div className="flex gap-2">
                                <Button size="sm" variant="outline" onClick={() => onEdit(lead)}><Pencil className="size-4" /> Edit</Button>
                                <Button size="sm" variant="outline" className="text-red-600" onClick={handleDelete}><Trash2 className="size-4" /> Delete</Button>
                            </div>
                        )}

                        {/* Activity timeline */}
                        <div className="space-y-3 border-t pt-4">
                            <div className="text-sm font-medium">Activity</div>

                            {/* Composer */}
                            <div className="space-y-2 rounded-lg border p-2">
                                <div className="flex gap-1">
                                    {ACTIVITY_KINDS.map(({ kind, label, icon: Icon }) => (
                                        <button
                                            key={kind}
                                            type="button"
                                            onClick={() => setComposerKind(kind)}
                                            className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${composerKind === kind ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                                        >
                                            <Icon className="size-3.5" /> {label}
                                        </button>
                                    ))}
                                </div>
                                <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder={`Log a ${composerKind.toLowerCase()}…`} />
                                <div className="flex items-center gap-2">
                                    {composerKind === "TASK" && (
                                        <TallyDateTimeInput value={dueAt} onValueChange={setDueAt} className="max-w-[280px]" />
                                    )}
                                    <Button size="sm" className="ml-auto" onClick={addActivity} disabled={posting || !body.trim()}>
                                        <Send className="size-4" /> Log
                                    </Button>
                                </div>
                            </div>

                            {/* Timeline */}
                            <div className="space-y-3">
                                {lead.activities.length === 0 && <p className="text-xs text-muted-foreground">No activity yet.</p>}
                                {lead.activities.map((a) => {
                                    if (a.kind === "SYSTEM") {
                                        return (
                                            <div key={a.id} className="text-xs italic text-muted-foreground">
                                                {a.author.userName} · {a.body} · {formatDateTime(a.createdAt)}
                                            </div>
                                        );
                                    }
                                    const Icon = KIND_ICON[a.kind];
                                    const overdue = a.kind === "TASK" && a.dueAt && !a.doneAt && new Date(a.dueAt).getTime() < now;
                                    return (
                                        <div key={a.id} className="flex gap-2">
                                            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                                                <Icon className="size-3.5" />
                                            </span>
                                            <div className="flex-1">
                                                <div className="flex items-baseline gap-2">
                                                    <span className="text-sm font-medium">{a.author.userName}</span>
                                                    <span className="text-[11px] text-muted-foreground">{a.kind.toLowerCase()} · {formatDateTime(a.createdAt)}</span>
                                                </div>
                                                <p className="whitespace-pre-wrap text-sm">{a.body}</p>
                                                {a.kind === "TASK" && (
                                                    <label className="mt-1 flex items-center gap-2 text-xs">
                                                        <Checkbox checked={!!a.doneAt} onCheckedChange={(v) => toggleTask(a.id, v === true)} />
                                                        <span className={a.doneAt ? "text-muted-foreground line-through" : overdue ? "text-red-600" : ""}>
                                                            {a.doneAt ? "Done" : a.dueAt ? `Due ${formatDate(a.dueAt)}` : "Open task"}
                                                        </span>
                                                    </label>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
