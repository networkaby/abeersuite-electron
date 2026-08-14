import { prisma } from "@/shared/lib/prisma/prismaClient";
import { auth } from "@/auth";
import { selectPrimaryPhone } from "@/shared/lib/prisma/fragments";
import { timeAgo, timeUntil, formatDuration } from "@/shared/lib/format/timeAgo";
import WorkInboxBoard, { type WorkInboxItem } from "@/modules/repairing/components/assignments/WorkInboxBoard";
import { parseArgs, isUserArg, isEntryArg, argKey, resolveTicketSource, META_PREV_OUTCOME, META_LAST_NOTE, type TicketLike } from "@/modules/repairing/lib/ticketSources";
import { resolvedUserFromSession } from "@/shared/lib/auth/permissions";
import { passesWorkGate } from "@/modules/repairing/lib/workGate";
import { slaEnteredAt, slaOverdueMs, workLessSlaCandidates } from "@/modules/repairing/lib/resolveTimeSla";

// The Work Inbox: every active ticket sitting in a work-bearing worker, as one
// mixed list (longest-waiting first). New tickets enter their status' entry
// worker on creation, so they appear here immediately. Status is derived from
// the current plumbing — an interim source that swaps to a WorkItem record later.
export default async function AssignmentsPage() {
    const session = await auth();
    const userId = Number((session?.user as { id?: string } | undefined)?.id ?? "0");
    const resolvedUser = resolvedUserFromSession(session ?? {});

    const customerPhones = {
        person: { select: { name: true, phones: selectPrimaryPhone } },
        company: { select: { name: true, phones: selectPrimaryPhone } },
    };

    // Only the "ticket" flavour (Service & Repair) has a detail page today — help,
    // task and deal are list-only surfaces. Linking those to the repair page 500s
    // (it assumes a device row), so they get a plain #id, as the ticket page's own
    // children list already does.
    const detailHref = (entityType: string | null | undefined, id: number) =>
        entityType === "ticket" ? `/office/repairing/tickets/${id}` : null;

    // Per-request "now" for snooze (wakeAt) and SLA comparisons. This is an async
    // Server Component — it renders once per request, so reading the clock here is
    // stable; the purity rule targets re-rendering client components, not this case.
    // eslint-disable-next-line react-hooks/purity
    const nowDate = new Date();
    const now = nowDate.getTime();

    const [tickets, doneLogs, works, slaCandidates] = await Promise.all([
        prisma.ticket.findMany({
            where: {
                ticketStatus: { isTerminal: false },
                ticketWorker: { workId: { not: null } },
            },
            orderBy: { updatedAt: "asc" },
            include: {
                // The current status carries the resolve-time SLA (hours). Overdue =
                // time-in-status (from statusEnteredAt) exceeds it → "needs attention".
                ticketStatus: { select: { resolveTimeHours: true } },
                pipeline: { select: { entityType: true } },
                repair: { include: { device: { include: { account: { include: customerPhones } } } } },
                ticketWorker: {
                    select: {
                        id: true, label: true, actionLabel: true, workId: true, retrySchedule: true,
                        successWorker: { select: { id: true, label: true } },
                        failWorker: { select: { id: true, label: true } },
                        successStatus: { select: { id: true, label: true } },
                        failStatus: { select: { id: true, label: true } },
                    },
                },
                logs: {
                    where: { note: { not: null } },
                    orderBy: { createdAt: "desc" },
                    take: 12,
                    select: { note: true, author: true },
                },
            },
        }),
        // Completion stamps — "Work done · Success/Unsuccess" — feed the Finished list.
        prisma.ticketLog.findMany({
            // Work-completion stamps are always ticket-backed (customer-attached CRM logs never match).
            where: { note: { startsWith: "Work done · " }, ticketId: { not: null } },
            orderBy: { createdAt: "desc" },
            take: 60,
            select: {
                id: true, note: true, createdAt: true,
                author: true,
                ticketWorker: { select: { label: true, work: { select: { id: true, label: true, color: true, groups: { select: { workGroup: { select: { id: true, label: true, color: true } } } } } } } },
                ticket: { select: { id: true, pipeline: { select: { entityType: true } }, repair: { select: { device: { select: { brand: true, model: true, account: { select: customerPhones } } } } } } },
            },
        }),
        prisma.work.findMany({ orderBy: { order: "asc" }, select: { id: true, label: true, color: true, permissionId: true, successLabel: true, failLabel: true, prompt: true, startLabel: true, successPopup: true, failPopup: true, args: true, groups: { select: { workGroup: { select: { id: true, label: true, color: true } } } } } }),
        // Work-less SLA rows: the status carries a resolve time but no Work, so the
        // query above can never see them. Overdue ones still need chasing, so they
        // surface here as notices under the status' resolveGroup ("OverDue").
        prisma.ticket.findMany({
            where: workLessSlaCandidates(nowDate),
            orderBy: { updatedAt: "asc" },
            include: {
                ticketStatus: {
                    select: {
                        label: true, color: true, resolveTimeHours: true,
                        resolveGroup: { select: { id: true, label: true, color: true } },
                    },
                },
                pipeline: { select: { entityType: true } },
                repair: { include: { device: { include: { account: { include: customerPhones } } } } },
                logs: {
                    where: { note: { not: null } },
                    orderBy: { createdAt: "desc" },
                    take: 12,
                    select: { note: true, author: true },
                },
            },
        }),
    ]);

    const worksById = Object.fromEntries(works.map((w) => [w.id, w]));

    // Visibility is keyed on the WORK, not the group. A *gated* work (permissionId
    // set) is visible only to roles holding that work's permission (admin:bypass
    // passes via hasPermission); an ungated work is open to any staff. Work Groups
    // are pure sorting buckets now — no access role. Tickets carrying a work the
    // caller can't act on are dropped entirely (private to its holders), not just
    // hidden from a filter chip.
    const visibleWorkIds = new Set(
        works.filter((w) => passesWorkGate(resolvedUser, w)).map((w) => w.id)
    );

    // System-generated log notes (entry/auto-advance/claim/transfer/completion stamps)
    // are noise as "why" context — only surface free-text notes a human actually wrote.
    const SYSTEM_NOTE = /^(Entered:|Auto-advanced|Claimed by|Reverted|Transferred|Reassigned|Unassigned|Escalat|Work done)/;

    const openItems: WorkInboxItem[] = tickets.map((t) => {
        // SLA breach = time since the ticket entered its current status exceeds that
        // status' resolveTimeHours (shared rule — see resolveTimeSla.ts).
        const enteredAt = slaEnteredAt(t);
        const overdueByMs = slaOverdueMs(t, t.ticketStatus?.resolveTimeHours, now);
        const needsAttention = overdueByMs > 0;
        const work = t.ticketWorker?.workId ? worksById[t.ticketWorker.workId] : undefined;
        const device = t.repair?.device ?? null;
        const acct = device?.account ?? null;
        const noteLog = t.logs.find((l) => l.note && !SYSTEM_NOTE.test(l.note));
        // Snoozed = this waiting work is deferred until wakeAt; it drops out of the
        // active queues into the "Waiting" tab and re-surfaces as due when wakeAt passes.
        const snoozed = !!t.wakeAt && t.wakeAt.getTime() > now;
        // A scheduled worker owns its retry loop: Unsuccess re-arms it per the
        // schedule (the route keeps it here), so always offer that action — fall back
        // to a self-target when no explicit ✗→ route is set.
        const scheduled = Array.isArray(t.ticketWorker?.retrySchedule) && (t.ticketWorker.retrySchedule as unknown[]).length > 0;
        const selfTarget = t.ticketWorker ? { id: t.ticketWorker.id, label: t.ticketWorker.label } : null;
        // Worker context = the work's SUPPLY args resolved against the ticket — incl.
        // outcome variables earlier workers produced (context.<key>) and the two "Previous
        // step" meta sources resolved from the logs (prev outcome + last note). Shown prominently.
        const ctxBag = (t.context as Record<string, unknown> | null) ?? {};
        const ticketLike: TicketLike = { id: t.id, context: t.context as Record<string, unknown> | null, device };
        const doneLog = t.logs.find((l) => l.note?.startsWith("Work done · "));
        const prevOutcome = doneLog ? doneLog.note!.replace(/^Work done · /, "") : null;
        const lastNoteVal = noteLog?.note ?? null;
        // Worker-context chips = SUPPLY args (resolved live) + ENTRY args (typed by the
        // technician on hand-off, read back from Ticket.context). Outcome args excluded.
        const context = work
            ? parseArgs(work.args).filter((a) => !isUserArg(a) || isEntryArg(a))
                .map((a) => {
                    const ctxVal = ctxBag[argKey(a)];
                    return {
                        label: a.label,
                        value: isEntryArg(a) ? (ctxVal == null || ctxVal === "" ? null : String(ctxVal))
                            : a.source === META_PREV_OUTCOME ? prevOutcome
                            : a.source === META_LAST_NOTE ? lastNoteVal
                            : resolveTicketSource(a.source, ticketLike),
                    };
                })
                .filter((c): c is { label: string; value: string } => !!c.value)
            : [];
        return {
            id: String(t.id),
            ticketId: t.id,
            href: detailHref(t.pipeline?.entityType, t.id),
            successTarget: t.ticketWorker?.successWorker ?? null,
            failTarget: t.ticketWorker?.failWorker ?? (scheduled ? selfTarget : null),
            successStatusTarget: t.ticketWorker?.successStatus ?? null,
            failStatusTarget: t.ticketWorker?.failStatus ?? null,
            retryScheduled: scheduled,
            workId: work?.id ?? "",
            workLabel: work?.label ?? "Work",
            workColor: work?.color ?? "bg-muted text-muted-foreground",
            groups: work?.groups ? work.groups.map((g) => g.workGroup) : [],
            successLabel: work?.successLabel ?? null,
            failLabel: work?.failLabel ?? null,
            startLabel: work?.startLabel ?? null,
            prompt: work?.prompt ?? null,
            successPopup: work?.successPopup ?? false,
            failPopup: work?.failPopup ?? false,
            // The work's args — WorkActions collects the user-given (outcome) ones in the popup.
            args: work ? parseArgs(work.args) : [],
            status: t.assignedPositionId ? "progress" : "todo",
            coverLabel: t.ticketWorker?.label ?? "",
            ask: t.ticketWorker?.actionLabel ?? null,
            context,
            problem: device?.problem?.trim() || null,
            lastNote: noteLog?.note ?? null,
            lastNoteBy: (noteLog?.author as { userName?: string })?.userName ?? null,
            customer: acct?.person?.name ?? acct?.company?.name ?? "—",
            phone: acct?.person?.phones?.[0]?.phone ?? acct?.company?.phones?.[0]?.phone ?? null,
            device: `${device?.brand ?? ""} ${device?.model ?? ""}`.trim(),
            assignee: null,
            answer: null,
            answeredBy: null,
            snoozed,
            wakeLabel: snoozed && t.wakeAt ? timeUntil(t.wakeAt) : null,
            ageLabel: timeAgo(enteredAt),
            needsAttention: needsAttention && !snoozed,
            overdueLabel: needsAttention && !snoozed ? formatDuration(overdueByMs) : null,
        };
    });

    // Finished works, read from the completion stamps (most recent first).
    const finishedItems: WorkInboxItem[] = doneLogs
        .filter((l): l is typeof l & { ticket: NonNullable<typeof l.ticket> } => l.ticket !== null)
        .map((l) => {
        const work = l.ticketWorker?.work;
        const acct = l.ticket.repair?.device?.account ?? null;
        const unsuccess = !!l.note?.includes("· Unsuccess");
        const userNote = l.note?.split(" — ").slice(1).join(" — ").trim() || null;
        return {
            id: `done-${l.id}`,
            ticketId: l.ticket.id,
            href: detailHref(l.ticket.pipeline?.entityType, l.ticket.id),
            successTarget: null,
            failTarget: null,
            successStatusTarget: null,
            failStatusTarget: null,
            retryScheduled: false,
            workId: work?.id ?? "",
            workLabel: work?.label ?? l.ticketWorker?.label ?? "Work",
            workColor: work?.color ?? "bg-muted text-muted-foreground",
            groups: work?.groups ? work.groups.map((g) => g.workGroup) : [],
            status: "answered",
            coverLabel: l.ticketWorker?.label ?? "",
            ask: null,
            context: [],
            problem: null,
            lastNote: null,
            lastNoteBy: null,
            customer: acct?.person?.name ?? acct?.company?.name ?? "—",
            phone: acct?.person?.phones?.[0]?.phone ?? acct?.company?.phones?.[0]?.phone ?? null,
            device: `${l.ticket.repair?.device?.brand ?? ""} ${l.ticket.repair?.device?.model ?? ""}`.trim(),
            assignee: null,
            outcome: unsuccess ? "unsuccess" : "success",
            answer: userNote,
            answeredBy: (l.author as { userName?: string })?.userName ?? null,
            snoozed: false,
            wakeLabel: null,
            ageLabel: timeAgo(l.createdAt),
            needsAttention: false,
            overdueLabel: null,
        };
    });

    // Work-less overdue notices. No worker means no outcome to record, so these rows
    // carry no work fields and no actions — the board shows them as "Needs attention"
    // with an Open link, and they sort with the rest by longest-waiting. Not-yet-overdue
    // work-less tickets stay out: the inbox lists things to do, not everything alive.
    const slaItems: WorkInboxItem[] = slaCandidates
        .map((t) => ({ t, overdueByMs: slaOverdueMs(t, t.ticketStatus?.resolveTimeHours, now) }))
        .filter(({ overdueByMs }) => overdueByMs > 0)
        .map(({ t, overdueByMs }) => {
            const device = t.repair?.device ?? null;
            const acct = device?.account ?? null;
            const noteLog = t.logs.find((l) => l.note && !SYSTEM_NOTE.test(l.note));
            const group = t.ticketStatus?.resolveGroup ?? null;
            return {
                id: `sla-${t.id}`,
                ticketId: t.id,
                href: detailHref(t.pipeline?.entityType, t.id),
                successTarget: null,
                failTarget: null,
                successStatusTarget: null,
                failStatusTarget: null,
                retryScheduled: false,
                // No work — the badge names the STATUS the ticket is stuck in, which is
                // the honest label here. An empty workId also marks the row action-less.
                workId: "",
                workLabel: t.ticketStatus?.label ?? "—",
                workColor: t.ticketStatus?.color ?? "bg-muted text-muted-foreground",
                // The status' resolveGroup is the chip ("OverDue"); unset → "Ungrouped".
                groups: group ? [group] : [],
                args: [],
                status: "todo" as const,
                coverLabel: "",
                ask: null,
                context: [],
                problem: device?.problem?.trim() || null,
                lastNote: noteLog?.note ?? null,
                lastNoteBy: (noteLog?.author as { userName?: string })?.userName ?? null,
                customer: acct?.person?.name ?? acct?.company?.name ?? "—",
                phone: acct?.person?.phones?.[0]?.phone ?? acct?.company?.phones?.[0]?.phone ?? null,
                device: `${device?.brand ?? ""} ${device?.model ?? ""}`.trim(),
                assignee: null,
                answer: null,
                answeredBy: null,
                snoozed: false,
                wakeLabel: null,
                ageLabel: timeAgo(slaEnteredAt(t)),
                needsAttention: true,
                overdueLabel: formatDuration(overdueByMs),
            };
        });

    // Needs-attention (SLA-breached) items float to the top; the query already
    // orders by longest-waiting, and Array.sort is stable, so within each group the
    // longest-waiting-first order is preserved.
    const sortedOpen = [...openItems, ...slaItems].sort((a, b) => Number(b.needsAttention) - Number(a.needsAttention));

    // Drop items whose work the caller can't act on (gated work, permission not
    // held) — private to its holders, not just absent from a filter chip. Items
    // with no work fall through as open.
    const visibleItems = [...sortedOpen, ...finishedItems].filter(
        (it) => !it.workId || visibleWorkIds.has(it.workId)
    );

    return (
        <div className="h-full overflow-y-auto px-6 py-5">
            <WorkInboxBoard items={visibleItems} currentUserId={userId} />
        </div>
    );
}
