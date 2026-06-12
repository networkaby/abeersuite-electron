import { prisma } from "@/shared/lib/prisma/prismaClient";
import { auth } from "@/auth";
import { selectPrimaryPhone } from "@/shared/lib/prisma/fragments";
import { timeAgo } from "@/shared/lib/format/timeAgo";
import WorkInboxBoard, { type WorkInboxItem } from "@/modules/repairing/components/assignments/WorkInboxBoard";

// The Work Inbox: every active ticket sitting in a work-bearing sub-status, as one
// mixed list (longest-waiting first). New tickets enter their status' entry
// sub-status on creation, so they appear here immediately. Status is derived from
// the current plumbing — an interim source that swaps to a WorkItem record later.
export default async function AssignmentsPage() {
    const session = await auth();
    const userId = Number((session?.user as { id?: string } | undefined)?.id ?? "0");

    const customerPhones = {
        person: { select: { name: true, phones: selectPrimaryPhone } },
        company: { select: { name: true, phones: selectPrimaryPhone } },
    };

    const [tickets, doneLogs, works] = await Promise.all([
        prisma.ticket.findMany({
            where: {
                ticketStatus: { isTerminal: false },
                ticketSubStatus: { workId: { not: null } },
            },
            orderBy: { updatedAt: "asc" },
            include: {
                device: { include: { account: { include: customerPhones } } },
                primaryOwner: { select: { id: true, name: true } },
                ticketSubStatus: {
                    select: {
                        id: true, label: true, actionLabel: true, workId: true,
                        successSubStatus: { select: { id: true, label: true } },
                        failSubStatus: { select: { id: true, label: true } },
                    },
                },
                logs: {
                    where: { note: { not: null } },
                    orderBy: { createdAt: "desc" },
                    take: 12,
                    select: { note: true, changedBy: { select: { name: true } } },
                },
            },
        }),
        // Completion stamps — "Work done · Success/Unsuccess" — feed the Finished list.
        prisma.ticketLog.findMany({
            where: { note: { startsWith: "Work done · " } },
            orderBy: { createdAt: "desc" },
            take: 60,
            select: {
                id: true, note: true, createdAt: true,
                changedBy: { select: { name: true } },
                ticketSubStatus: { select: { label: true, work: { select: { id: true, label: true, color: true } } } },
                ticket: { select: { id: true, device: { select: { brand: true, model: true, account: { select: customerPhones } } } } },
            },
        }),
        prisma.work.findMany({ orderBy: { order: "asc" }, select: { id: true, label: true, color: true } }),
    ]);

    const worksById = Object.fromEntries(works.map((w) => [w.id, w]));

    // System-generated log notes (entry/auto-advance/claim/transfer/completion stamps)
    // are noise as "why" context — only surface free-text notes a human actually wrote.
    const SYSTEM_NOTE = /^(Entered:|Auto-advanced|Claimed by|Reverted|Transferred|Reassigned|Unassigned|Escalat|Work done)/;

    const openItems: WorkInboxItem[] = tickets.map((t) => {
        const work = t.ticketSubStatus?.workId ? worksById[t.ticketSubStatus.workId] : undefined;
        const acct = t.device.account;
        const noteLog = t.logs.find((l) => l.note && !SYSTEM_NOTE.test(l.note));
        return {
            id: String(t.id),
            ticketId: t.id,
            successTarget: t.ticketSubStatus?.successSubStatus ?? null,
            failTarget: t.ticketSubStatus?.failSubStatus ?? null,
            workId: work?.id ?? "",
            workLabel: work?.label ?? "Work",
            workColor: work?.color ?? "bg-muted text-muted-foreground",
            status: t.primaryOwner ? "progress" : "todo",
            coverLabel: t.ticketSubStatus?.label ?? "",
            ask: t.ticketSubStatus?.actionLabel ?? null,
            problem: t.device.problem?.trim() || null,
            lastNote: noteLog?.note ?? null,
            lastNoteBy: noteLog?.changedBy?.name ?? null,
            customer: acct?.person?.name ?? acct?.company?.name ?? "—",
            phone: acct?.person?.phones?.[0]?.phone ?? acct?.company?.phones?.[0]?.phone ?? null,
            device: `${t.device.brand} ${t.device.model}`.trim(),
            assignee: t.primaryOwner ?? null,
            answer: null,
            answeredBy: null,
            ageLabel: timeAgo(t.updatedAt),
        };
    });

    // Finished works, read from the completion stamps (most recent first).
    const finishedItems: WorkInboxItem[] = doneLogs.map((l) => {
        const work = l.ticketSubStatus?.work;
        const acct = l.ticket.device.account;
        const unsuccess = !!l.note?.includes("· Unsuccess");
        const userNote = l.note?.split(" — ").slice(1).join(" — ").trim() || null;
        return {
            id: `done-${l.id}`,
            ticketId: l.ticket.id,
            successTarget: null,
            failTarget: null,
            workId: work?.id ?? "",
            workLabel: work?.label ?? l.ticketSubStatus?.label ?? "Work",
            workColor: work?.color ?? "bg-muted text-muted-foreground",
            status: "answered",
            coverLabel: l.ticketSubStatus?.label ?? "",
            ask: null,
            problem: null,
            lastNote: null,
            lastNoteBy: null,
            customer: acct?.person?.name ?? acct?.company?.name ?? "—",
            phone: acct?.person?.phones?.[0]?.phone ?? acct?.company?.phones?.[0]?.phone ?? null,
            device: `${l.ticket.device.brand} ${l.ticket.device.model}`.trim(),
            assignee: null,
            outcome: unsuccess ? "unsuccess" : "success",
            answer: userNote,
            answeredBy: l.changedBy?.name ?? null,
            ageLabel: timeAgo(l.createdAt),
        };
    });

    return <WorkInboxBoard items={[...openItems, ...finishedItems]} works={works} currentUserId={userId} />;
}
