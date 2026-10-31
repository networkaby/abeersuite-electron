"use client";

import { useCallback, useEffect, useState } from "react";
import { GatedLink } from "@/shared/components/GatedLink";
import axios from "axios";
import { toast } from "sonner";
import {
    Pencil, Trash2, Send, StickyNote, Phone, CalendarCheck, CheckSquare,
    Activity as ActivityIcon, ExternalLink, Copy, Check, CalendarClock,
    User, Briefcase, Mail, ArrowLeft, X, Loader2, IndianRupee,
    MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
    Dialog, DialogContent, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import UserAvatar from "@/shared/components/UserAvatar";
import { TallyDateTimeInput } from "@/shared/components/TallyDateTimeInput";
import { useNow } from "@/shared/hooks";
import { PRIORITY_META } from "@/shared/lib/constants/badges";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { formatDate, formatDateTime, formatCallerNumber, timeAgo } from "@/shared/lib/format";
import type { DealDetailDto, DealStage, DealActivityKind } from "../lib/types";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import { useValueChange } from "@/shared/hooks/useValueChange";
import { partyProfileHref } from "@/shared/lib/parties";
import { cn } from "@/shared/lib/format/utils";

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
    const [copiedPhone, setCopiedPhone] = useState(false);

    // "now" read in an effect (useNow) — calling Date.now() during render trips react-hooks/purity.
    const now = useNow();

    const readDeal = useCallback((id: number) => axios.get(`/api/deals/${id}`)
        .then((res) => setDeal(res.data))
        .catch(() => { toast.error("Failed to load deal"); })
        .finally(() => setLoading(false)), []);

    const load = useCallback(async () => {
        if (!dealId) return;
        setLoading(true);
        await readDeal(dealId);
    }, [dealId, readDeal]);

    // Opening a deal shows the spinner, closing clears it — both while rendering.
    const openDealId = open && dealId ? dealId : null;
    if (useValueChange(openDealId, null) && openDealId) setLoading(true);
    if (useValueChange(open, false) && !open) {
        setDeal(null);
        setBody("");
        setDueAt("");
        setComposerKind("NOTE");
        setCopiedPhone(false);
    }
    useEffect(() => {
        if (openDealId) void readDeal(openDealId);
    }, [openDealId, readDeal]);

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
            setBody("");
            setDueAt("");
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

    const copyPhone = (phone: string) => {
        navigator.clipboard.writeText(phone).then(() => {
            setCopiedPhone(true);
            toast.success("Phone number copied");
            setTimeout(() => setCopiedPhone(false), 2000);
        }).catch(() => toast.error("Failed to copy phone number"));
    };

    const priority = deal ? PRIORITY_META[deal.priority] ?? PRIORITY_META.MEDIUM : null;
    const holders = deal?.assignedPosition?.holders.map((h) => h.user) ?? [];
    const sortedStages = [...stages].sort((a, b) => a.order - b.order);
    const currentStageIndex = deal ? sortedStages.findIndex((s) => s.id === deal.status) : -1;
    const isFollowUpOverdue = Boolean(
        deal?.nextFollowUpAt && !deal?.closedAt && new Date(deal.nextFollowUpAt).getTime() < now,
    );

    const customerDisplayName = deal?.person?.name ?? deal?.company?.name ?? deal?.companyName ?? deal?.contactName ?? "";
    const customerInitial = customerDisplayName ? customerDisplayName[0].toUpperCase() : "C";
    const cleanDigits = deal?.phone ? deal.phone.replace(/\D/g, "") : "";
    const waPhone = cleanDigits.length === 10 ? `91${cleanDigits}` : cleanDigits;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                showCloseButton={false}
                onInteractOutside={(e) => e.preventDefault()}
                onOpenAutoFocus={(e) => e.preventDefault()}
                className="flex h-[94vh] max-h-[94vh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[96vw]"
            >
                <DialogTitle className="sr-only">
                    {deal?.title ?? "Deal"}
                </DialogTitle>
                <DialogDescription className="sr-only">
                    Deal details, customer enquiry, pipeline stage, and activity timeline.
                </DialogDescription>

                {/* Top Bar — Full-width Help Ticket style */}
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
                            <span className="text-base font-semibold text-foreground truncate max-w-[280px] sm:max-w-[400px]">
                                {deal?.title ?? (loading ? "Loading…" : "Deal")}
                            </span>
                            {priority && (
                                <Badge className={`shrink-0 ${priority.color ?? ""}`}>
                                    {priority.label}
                                </Badge>
                            )}
                            {deal && (
                                <span className={`rounded-md px-2 py-0.5 text-xs font-semibold shrink-0 ${deal.ticketStatus.color}`}>
                                    {deal.ticketStatus.label}
                                </span>
                            )}
                            {deal?.source && (
                                <Badge variant="secondary" className="shrink-0 text-xs">
                                    {deal.source}
                                </Badge>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-3 text-xs shrink-0">
                        {deal && (
                            <div className="flex items-center gap-2">
                                <span className="text-muted-foreground uppercase tracking-wide">Deal No.</span>
                                <span className="font-mono tabular-nums px-2.5 py-1 rounded bg-muted/40 border border-border min-w-[70px] text-center font-medium">
                                    #{deal.id}
                                </span>
                            </div>
                        )}
                        {deal && (
                            <div className="hidden sm:flex items-center gap-2">
                                <span className="text-muted-foreground uppercase tracking-wide">Created</span>
                                <span className="px-2.5 py-1 rounded bg-muted/40 border border-border text-center text-muted-foreground">
                                    {formatDateTime(deal.createdAt)}
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
                {loading && !deal ? (
                    <div className="flex flex-1 items-center justify-center py-20 text-muted-foreground">
                        <Loader2 className="size-6 animate-spin mr-2" /> Loading deal details…
                    </div>
                ) : deal ? (
                    <div className="flex-1 overflow-y-auto bg-muted/20 p-4 sm:p-6">
                        <div className="mx-auto max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                            {/* Left Column: Customer info, Notes & Activity Timeline (7-8 cols) */}
                            <div className="lg:col-span-7 xl:col-span-8 space-y-6">
                                {/* Customer & Contact Card */}
                                <div className="rounded-xl border bg-card p-5 shadow-sm space-y-4">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex items-center gap-3">
                                            <div className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-base shrink-0">
                                                {customerInitial}
                                            </div>
                                            <div>
                                                <div className="font-semibold text-foreground text-base flex items-center gap-1.5 flex-wrap">
                                                    {deal.person ? (
                                                        <GatedLink
                                                            whenLocked="text"
                                                            href={partyProfileHref("person", deal.person.id) ?? "#"}
                                                            className="hover:underline text-primary inline-flex items-center gap-1"
                                                        >
                                                            <span>{deal.person.name}</span>
                                                            <ExternalLink className="size-3.5 text-muted-foreground" />
                                                        </GatedLink>
                                                    ) : deal.company ? (
                                                        <GatedLink
                                                            whenLocked="text"
                                                            href={partyProfileHref("company", deal.company.id) ?? "#"}
                                                            className="hover:underline text-primary inline-flex items-center gap-1"
                                                        >
                                                            <span>{deal.company.name}</span>
                                                            <ExternalLink className="size-3.5 text-muted-foreground" />
                                                        </GatedLink>
                                                    ) : (
                                                        <span>{customerDisplayName || "Unlinked Customer"}</span>
                                                    )}
                                                    {deal.person && <span className="text-xs font-normal text-muted-foreground">(Person)</span>}
                                                    {deal.company && <span className="text-xs font-normal text-muted-foreground">(Company)</span>}
                                                </div>

                                                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mt-1">
                                                    {deal.contactName && deal.contactName !== customerDisplayName && (
                                                        <div className="flex items-center gap-1">
                                                            <User className="size-3 text-muted-foreground/70" />
                                                            <span>Contact: <strong className="text-foreground">{deal.contactName}</strong></span>
                                                        </div>
                                                    )}
                                                    {deal.phone && (
                                                        <div className="flex items-center gap-1">
                                                            <Phone className="size-3 text-muted-foreground/70" />
                                                            <span className="font-mono">{formatCallerNumber(deal.phone)}</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => copyPhone(deal.phone!)}
                                                                className="ml-0.5 p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                                                                title="Copy phone number"
                                                            >
                                                                {copiedPhone ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
                                                            </button>
                                                            {cleanDigits && (
                                                                <a
                                                                    href={`https://wa.me/${waPhone}`}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="ml-1 text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-0.5"
                                                                    title="Open WhatsApp chat"
                                                                >
                                                                    <MessageCircle className="size-3" /> WhatsApp
                                                                </a>
                                                            )}
                                                        </div>
                                                    )}
                                                    {deal.email && (
                                                        <a
                                                            href={`mailto:${deal.email}`}
                                                            className="flex items-center gap-1 hover:text-foreground hover:underline transition-colors"
                                                        >
                                                            <Mail className="size-3 text-muted-foreground/70" />
                                                            <span>{deal.email}</span>
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {deal.source && (
                                            <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                                Source: {deal.source}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Deal Notes / Brief Card */}
                                {deal.notes && (
                                    <div className="rounded-xl border bg-card p-5 shadow-sm space-y-2">
                                        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                            <StickyNote className="size-4 text-primary" />
                                            <span>Deal Notes & Brief</span>
                                        </div>
                                        <p className="whitespace-pre-wrap text-sm text-foreground/90 leading-relaxed pl-6">
                                            {deal.notes}
                                        </p>
                                    </div>
                                )}

                                {/* Activity Timeline Card */}
                                <div className="rounded-xl border bg-card p-5 shadow-sm space-y-4">
                                    <div className="flex items-center justify-between border-b pb-3">
                                        <div className="flex items-center gap-2">
                                            <ActivityIcon className="size-4 text-primary" />
                                            <h3 className="font-semibold text-sm text-foreground">Activity Timeline</h3>
                                            <Badge variant="secondary" className="text-xs px-2 py-0">
                                                {deal.activities.length}
                                            </Badge>
                                        </div>
                                    </div>

                                    {/* Composer */}
                                    <div className="rounded-xl border bg-muted/30 p-3.5 space-y-3">
                                        {/* Activity Type Tabs */}
                                        <div className="flex flex-wrap gap-1.5">
                                            {ACTIVITY_KINDS.map(({ kind, label, icon: Icon }) => (
                                                <button
                                                    key={kind}
                                                    type="button"
                                                    onClick={() => setComposerKind(kind)}
                                                    className={cn(
                                                        "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all cursor-pointer",
                                                        composerKind === kind
                                                            ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                                                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                                                    )}
                                                >
                                                    <Icon className="size-3.5" />
                                                    <span>{label}</span>
                                                </button>
                                            ))}
                                        </div>

                                        {/* Composer Textarea */}
                                        <Textarea
                                            value={body}
                                            onChange={(e) => setBody(e.target.value)}
                                            rows={2}
                                            placeholder={
                                                composerKind === "NOTE"
                                                    ? "Add a note or update about this deal…"
                                                    : composerKind === "CALL"
                                                        ? "Log call summary, discussion notes…"
                                                        : composerKind === "MEETING"
                                                            ? "Log meeting outcome, participants, decisions…"
                                                            : "What task needs to be completed?…"
                                            }
                                            className="min-h-[64px] text-sm bg-background resize-none rounded-lg"
                                        />

                                        {/* Task Due Date + Submit Button */}
                                        <div className="flex items-center justify-between gap-2 pt-0.5">
                                            {composerKind === "TASK" ? (
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs text-muted-foreground font-medium">Due:</span>
                                                    <TallyDateTimeInput value={dueAt} onValueChange={setDueAt} className="max-w-[240px] h-8 text-xs bg-background" />
                                                </div>
                                            ) : <div />}

                                            <Button
                                                size="sm"
                                                onClick={addActivity}
                                                disabled={posting || !body.trim()}
                                                className="gap-1.5 h-8 px-3 ml-auto cursor-pointer"
                                            >
                                                {posting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                                                <span>{posting ? "Logging…" : `Log ${composerKind.toLowerCase()}`}</span>
                                            </Button>
                                        </div>
                                    </div>

                                    {/* Timeline Feed */}
                                    {deal.activities.length === 0 ? (
                                        <div className="py-8 text-center text-sm text-muted-foreground">
                                            No activity logged yet.
                                        </div>
                                    ) : (
                                        <div className="relative pl-6 space-y-3.5 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-muted">
                                            {deal.activities.map((a) => {
                                                if (a.kind === "SYSTEM") {
                                                    return (
                                                        <div key={a.id} className="relative flex items-center gap-2 text-xs italic text-muted-foreground py-1">
                                                            <span className="absolute -left-6 size-5 rounded-full bg-muted border flex items-center justify-center text-muted-foreground">
                                                                <ActivityIcon className="size-2.5" />
                                                            </span>
                                                            <span>{a.author.userName} · {a.body} · {timeAgo(a.createdAt)}</span>
                                                        </div>
                                                    );
                                                }

                                                const Icon = KIND_ICON[a.kind];
                                                const isTask = a.kind === "TASK";
                                                const isTaskOverdue = isTask && a.dueAt && !a.doneAt && new Date(a.dueAt).getTime() < now;
                                                const isTaskDone = isTask && Boolean(a.doneAt);

                                                const kindColorClass = {
                                                    NOTE: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
                                                    CALL: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
                                                    MEETING: "bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300",
                                                    TASK: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
                                                    SYSTEM: "bg-muted text-muted-foreground",
                                                }[a.kind];

                                                return (
                                                    <div key={a.id} className="relative rounded-xl border bg-background/60 p-3.5 text-sm transition-colors space-y-1.5">
                                                        <span className={cn(
                                                            "absolute -left-[29px] top-3.5 flex size-6 items-center justify-center rounded-full border shadow-xs ring-2 ring-background",
                                                            kindColorClass,
                                                        )}>
                                                            <Icon className="size-3" />
                                                        </span>

                                                        <div className="flex items-center justify-between gap-2 text-xs">
                                                            <div className="flex items-center gap-1.5 font-medium text-foreground">
                                                                <UserAvatar
                                                                    avatarUrl={a.author.avatarUrl}
                                                                    name={a.author.userName}
                                                                    sizePx={18}
                                                                />
                                                                <span>{a.author.userName}</span>
                                                                {a.author.positionTitle && (
                                                                    <span className="text-[11px] text-muted-foreground font-normal">
                                                                        ({a.author.positionTitle})
                                                                    </span>
                                                                )}
                                                                <span className={cn("rounded px-1.5 py-0.2 text-[10px] font-semibold uppercase tracking-wider ml-1", kindColorClass)}>
                                                                    {a.kind}
                                                                </span>
                                                            </div>
                                                            <span className="text-muted-foreground tabular-nums" title={formatDateTime(a.createdAt)}>
                                                                {timeAgo(a.createdAt)}
                                                            </span>
                                                        </div>

                                                        <p className={cn(
                                                            "mt-1.5 whitespace-pre-wrap text-sm text-foreground/90 leading-relaxed",
                                                            isTaskDone && "line-through text-muted-foreground",
                                                        )}>
                                                            {a.body}
                                                        </p>

                                                        {isTask && (
                                                            <div className="pt-2 flex items-center justify-between border-t mt-2">
                                                                <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                                                                    <Checkbox
                                                                        checked={isTaskDone}
                                                                        onCheckedChange={(v) => toggleTask(a.id, v === true)}
                                                                    />
                                                                    <span className={cn(
                                                                        "font-medium",
                                                                        isTaskDone ? "text-muted-foreground line-through" : isTaskOverdue ? "text-red-600 font-semibold" : "text-foreground",
                                                                    )}>
                                                                        {isTaskDone ? "Completed" : a.dueAt ? `Due ${formatDate(a.dueAt)}` : "Open task"}
                                                                    </span>
                                                                </label>
                                                                {isTaskOverdue && (
                                                                    <span className="text-[10px] font-bold text-red-600 bg-red-50 dark:bg-red-950/40 px-1.5 py-0.5 rounded">
                                                                        Overdue
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Right Column: Actions, Stage & Ownership (4-5 cols) */}
                            <div className="lg:col-span-5 xl:col-span-4 space-y-6">
                                {/* Stage & Value Card */}
                                <div className="rounded-xl border bg-card p-5 shadow-sm space-y-4">
                                    <h3 className="font-semibold text-sm text-foreground">Pipeline Stage & Value</h3>

                                    {/* Deal Value Callout */}
                                    <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 p-3.5 flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <span className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 uppercase tracking-wide">Deal Value</span>
                                            <div className="text-xl font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">
                                                {deal.valuePaise != null && deal.valuePaise > 0
                                                    ? formatRupeesFromPaise(deal.valuePaise)
                                                    : "—"}
                                            </div>
                                        </div>
                                        <IndianRupee className="size-7 text-emerald-600/30 dark:text-emerald-400/30" />
                                    </div>

                                    {/* Stage Selector */}
                                    <div className="space-y-1.5">
                                        <Label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Current Stage</Label>
                                        {canEdit ? (
                                            <Select value={deal.status} onValueChange={moveStage}>
                                                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    {sortedStages.map((s) => (
                                                        <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        ) : (
                                            <div className="mt-1 font-medium text-sm">{deal.ticketStatus.label}</div>
                                        )}
                                    </div>

                                    {/* Pipeline Progress Stepper */}
                                    {sortedStages.length > 0 && (
                                        <div className="space-y-1.5 pt-1">
                                            <div className="flex items-center justify-between text-[11px] text-muted-foreground font-medium">
                                                <span>Pipeline Progress</span>
                                                <span className="text-[10px] text-muted-foreground/80">
                                                    Stage {currentStageIndex + 1} of {sortedStages.length}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                {sortedStages.map((s, idx) => {
                                                    const isCurrent = s.id === deal.status;
                                                    const isPast = currentStageIndex >= 0 && idx < currentStageIndex;
                                                    return (
                                                        <button
                                                            key={s.id}
                                                            type="button"
                                                            disabled={!canEdit || isCurrent}
                                                            onClick={() => moveStage(s.id)}
                                                            title={`${s.label}${isCurrent ? " (Current)" : ""}`}
                                                            className={cn(
                                                                "flex-1 h-2 rounded-full transition-all cursor-pointer",
                                                                isCurrent
                                                                    ? "bg-primary ring-2 ring-primary/30"
                                                                    : isPast
                                                                        ? "bg-primary/50 hover:bg-primary/70"
                                                                        : "bg-muted hover:bg-muted-foreground/30",
                                                                !canEdit && "cursor-default",
                                                            )}
                                                        />
                                                    );
                                                })}
                                            </div>
                                            <div className="flex justify-between text-[10px] text-muted-foreground pt-0.5">
                                                <span>{sortedStages[0]?.label}</span>
                                                <span>{sortedStages[sortedStages.length - 1]?.label}</span>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Ownership & Schedule Card */}
                                <div className="rounded-xl border bg-card p-5 shadow-sm space-y-4">
                                    <h3 className="font-semibold text-sm text-foreground">Assignment & Schedule</h3>

                                    {/* Assigned Seat / Owner */}
                                    <div className="space-y-1">
                                        <Label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Owner / Seat</Label>
                                        {deal.assignedPosition ? (
                                            <div className="space-y-1.5 pt-0.5">
                                                <div className="flex items-center gap-2">
                                                    <Briefcase className="size-4 text-primary shrink-0" />
                                                    <span className="font-medium text-sm text-foreground">{deal.assignedPosition.title}</span>
                                                </div>
                                                <div className="flex items-center gap-1.5 flex-wrap pl-6">
                                                    {holders.length === 0 ? (
                                                        <span className="text-xs italic text-muted-foreground">Vacant seat</span>
                                                    ) : (
                                                        holders.map((h) => (
                                                            <span key={h.id} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                                                                <UserAvatar name={h.name} avatarUrl={h.avatarUrl} role={h.role} sizePx={16} />
                                                                <span>{h.name}</span>
                                                            </span>
                                                        ))
                                                    )}
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="text-xs italic text-muted-foreground pt-0.5">Unassigned seat</div>
                                        )}
                                    </div>

                                    {/* Next Follow-up */}
                                    <div className="space-y-1 border-t pt-3">
                                        <Label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Next Follow-up</Label>
                                        <div className="mt-1 flex items-center gap-2">
                                            {deal.nextFollowUpAt ? (
                                                <>
                                                    <span className={cn(
                                                        "inline-flex items-center gap-1.5 text-sm font-medium",
                                                        isFollowUpOverdue ? "text-red-600 font-semibold" : "text-foreground",
                                                    )}>
                                                        <CalendarClock className="size-4" />
                                                        {formatDate(deal.nextFollowUpAt)}
                                                    </span>
                                                    {isFollowUpOverdue && (
                                                        <span className="rounded bg-red-100 dark:bg-red-950/40 px-1.5 py-0.5 text-[10px] font-bold text-red-700 dark:text-red-300">
                                                            Overdue
                                                        </span>
                                                    )}
                                                </>
                                            ) : (
                                                <span className="text-xs text-muted-foreground italic">No follow-up set</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Created By details */}
                                    <div className="border-t pt-3 text-xs text-muted-foreground space-y-0.5">
                                        <div>Created by <strong className="text-foreground">{deal.createdBy.userName}</strong></div>
                                        {deal.createdBy.positionTitle && <div>{deal.createdBy.positionTitle}</div>}
                                        <div className="text-[11px] text-muted-foreground/80">{formatDateTime(deal.createdAt)}</div>
                                    </div>
                                </div>

                                {/* Manage Deal Actions Card */}
                                {(canEdit || canDelete) && (
                                    <div className="rounded-xl border bg-card p-5 shadow-sm space-y-2.5">
                                        <h3 className="font-semibold text-sm text-foreground">Manage Deal</h3>
                                        <div className="space-y-2">
                                            {canEdit && (
                                                <Button
                                                    variant="outline"
                                                    className="w-full justify-start gap-2 h-9 text-xs"
                                                    onClick={() => onEdit(deal)}
                                                >
                                                    <Pencil className="size-3.5" /> Edit Deal Details
                                                </Button>
                                            )}
                                            {canDelete && (
                                                <Button
                                                    variant="outline"
                                                    className="w-full justify-start gap-2 h-9 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 border-red-200 dark:border-red-900/50"
                                                    onClick={handleDelete}
                                                >
                                                    <Trash2 className="size-3.5" /> Delete Deal
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}
