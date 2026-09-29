"use client";

import { useCallback, useEffect, useState } from "react";
import { GatedLink } from "@/shared/components/GatedLink";
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
import { PRIORITY_META } from "@/shared/lib/constants/badges";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { formatDate, formatDateTime } from "@/shared/lib/format";
import type { DealDetailDto, DealStage, DealActivityKind } from "../lib/types";
import { confirmAction } from "@/shared/lib/ui/confirmStore";

const ACTIVITY_KINDS: { kind: Exclude<DealActivityKind, "SYSTEM">; label: string; icon: typeof StickyNote }[] = [
    { kind: "NOTE", label: "Note", icon: StickyNote },
    { kind: "CALL", label: "Call", icon: Phone },
    { kind: "MEETING", label: "Meeting", icon: CalendarCheck },
    { kind: "TASK", label: "Task", icon: CheckSquare },
];
const KIND_ICON: Record<DealActivityKind, typeof StickyNote> = {
    NOTE: StickyNote, CALL: Phone, MEETING: CalendarCheck, TASK: CheckSquare, SYSTEM: ActivityIcon,
};

export default function DealDetailDialog({
    dealId,
    open,
    onOpenChange,
    stages,
    canEdit,
    canDelete,
    onEdit,
    onChanged,
}: {
    dealId: number | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    stages: DealStage[];
    canEdit: boolean;
    canDelete: boolean;
    onEdit: (deal: DealDetailDto) => void;
    onChanged: () => void;
}) {
    const [deal, setDeal] = useState<DealDetailDto | null>(null);
    const [loading, setLoading] = useState(false);
    const [composerKind, setComposerKind] = useState<Exclude<DealActivityKind, "SYSTEM">>("NOTE");
    const [body, setBody] = useState("");
    const [dueAt, setDueAt] = useState("");
    const [posting, setPosting] = useState(false);
    // "now" read in an effect (useNow) — calling Date.now() during render trips react-hooks/purity.
    const now = useNow();

    const load = useCallback(async () => {
        if (!dealId) return;
        setLoading(true);
        try {
            const res = await axios.get(`/api/deals/${dealId}`);
            setDeal(res.data);
        } catch {
            toast.error("Failed to load deal");
        } finally {
            setLoading(false);
        }
    }, [dealId]);

    useEffect(() => {
        if (open && dealId) load();
        if (!open) { setDeal(null); setBody(""); setDueAt(""); setComposerKind("NOTE"); }
    }, [open, dealId, load]);

    const moveStage = async (status: string) => {
        if (!deal || status === deal.status) return;
        try {
            await axios.patch(`/api/deals/${deal.id}`, { status });
            await load();
            onChanged();
        } catch {
            toast.error("Failed to move deal");
        }
    };

    const addActivity = async () => {
        if (!deal || !body.trim()) return;
        setPosting(true);
        try {
            await axios.post(`/api/deals/${deal.id}/activities`, {
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
        if (!deal) return;
        try {
            await axios.patch(`/api/deals/${deal.id}/activities/${activityId}`, { done });
            await load();
        } catch {
            toast.error("Failed to update task");
        }
    };

    const handleDelete = async () => {
        if (!deal) return;
        if (!(await confirmAction({ title: "Delete this deal?", body: "This cannot be undone.", confirmLabel: "Delete" }))) return;
        try {
            await axios.delete(`/api/deals/${deal.id}`);
            toast.success("Deal deleted");
            onOpenChange(false);
            onChanged();
        } catch {
            toast.error("Failed to delete deal");
        }
    };

    const priority = deal ? PRIORITY_META[deal.priority] ?? PRIORITY_META.MEDIUM : null;
    const holders = deal?.assignedPosition?.holders.map((h) => h.user) ?? [];

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl max-h-[88vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="pr-8">{deal?.title ?? (loading ? "Loading…" : "Deal")}</DialogTitle>
                </DialogHeader>

                {deal && (
                    <div className="space-y-5">
                        <div className="flex flex-wrap items-center gap-2">
                            {priority && <Badge className={priority.color}>{priority.label}</Badge>}
                            <Badge className={deal.ticketStatus.color}>{deal.ticketStatus.label}</Badge>
                            {deal.valuePaise != null && (
                                <span className="text-sm font-semibold tabular-nums">{formatRupeesFromPaise(deal.valuePaise)}</span>
                            )}
                            {deal.source && <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{deal.source}</span>}
                        </div>

                        {/* Contact / association */}
                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <div>
                                <div className="text-xs text-muted-foreground">Contact</div>
                                <div className="mt-1">{[deal.contactName, deal.phone].filter(Boolean).join(" · ") || "—"}</div>
                                {deal.email && <div className="text-xs text-muted-foreground">{deal.email}</div>}
                            </div>
                            <div>
                                <div className="text-xs text-muted-foreground">Customer</div>
                                <div className="mt-1">
                                    {deal.person ? (
                                        <GatedLink whenLocked="text" href={`/office/customers/person/${deal.person.id}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                                            {deal.person.name} <ExternalLink className="size-3" />
                                        </GatedLink>
                                    ) : deal.company ? (
                                        <GatedLink whenLocked="text" href={`/office/customers/companies/${deal.company.id}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                                            {deal.company.name} <ExternalLink className="size-3" />
                                        </GatedLink>
                                    ) : (
                                        <span className="text-muted-foreground">{deal.companyName || "Not linked"}</span>
                                    )}
                                </div>
                            </div>
                            <div className="col-span-2">
                                <div className="text-xs text-muted-foreground">Owner (position)</div>
                                {deal.assignedPosition ? (
                                    <div className="mt-1">
                                        <span className="font-medium">{deal.assignedPosition.title}</span>
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
                                <div className="mt-1">{deal.nextFollowUpAt ? formatDate(deal.nextFollowUpAt) : "—"}</div>
                            </div>
                            <div>
                                <div className="text-xs text-muted-foreground">Stage</div>
                                {canEdit ? (
                                    <Select value={deal.status} onValueChange={moveStage}>
                                        <SelectTrigger className="mt-1 h-8"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                ) : <div className="mt-1">{deal.ticketStatus.label}</div>}
                            </div>
                            <div className="col-span-2">
                                <div className="text-xs text-muted-foreground">Created by</div>
                                <div className="mt-1">
                                    {deal.createdBy.userName}{deal.createdBy.positionTitle ? ` · ${deal.createdBy.positionTitle}` : ""}
                                </div>
                            </div>
                        </div>

                        {deal.notes && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{deal.notes}</p>}

                        {(canEdit || canDelete) && (
                            <div className="flex gap-2">
                                {canEdit && <Button size="sm" variant="outline" onClick={() => onEdit(deal)}><Pencil className="size-4" /> Edit</Button>}
                                {canDelete && <Button size="sm" variant="outline" className="text-red-600" onClick={handleDelete}><Trash2 className="size-4" /> Delete</Button>}
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
                                {deal.activities.length === 0 && <p className="text-xs text-muted-foreground">No activity yet.</p>}
                                {deal.activities.map((a) => {
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
