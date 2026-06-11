import { prisma } from "@/shared/lib/prisma/prismaClient";
import { auth } from "@/auth";
import { selectPrimaryPhone } from "@/shared/lib/prisma/fragments";
import { timeAgo } from "@/shared/lib/format/timeAgo";
import WorkInboxBoard, { type WorkInboxItem } from "@/modules/repairing/components/assignments/WorkInboxBoard";

// The Work Inbox: every active ticket whose current slot carries a Work — either
// its sub-status (an "ask": Call, Pack…) or, for a brand-new ticket with no
// sub-status yet, its status (a "new" ticket riding e.g. a "new repair" Work).
// One mixed list, longest-waiting first. Status is derived from the current
// plumbing — an interim source that swaps to a WorkItem record without UI change.
export default async function AssignmentsPage() {
    const session = await auth();
    const userId = Number((session?.user as { id?: string } | undefined)?.id ?? "0");

    const [tickets, works] = await Promise.all([
        prisma.ticket.findMany({
            where: {
                ticketStatus: { isTerminal: false },
                OR: [
                    { ticketSubStatus: { workId: { not: null } } },  // riding a work sub-status (an ask)
                    { ticketStatus: { workId: { not: null } } },     // brand-new ticket riding its status' Work
                ],
            },
            orderBy: { updatedAt: "asc" },
            include: {
                device: {
                    include: {
                        account: {
                            include: {
                                person: { select: { name: true, phones: selectPrimaryPhone } },
                                company: { select: { name: true, phones: selectPrimaryPhone } },
                            },
                        },
                    },
                },
                primaryOwner: { select: { id: true, name: true } },
                ticketStatus: { select: { label: true, actionLabel: true, workId: true } },
                ticketSubStatus: {
                    select: {
                        id: true, label: true, actionLabel: true, workId: true,
                        successSubStatus: { select: { id: true, label: true } },
                        failSubStatus: { select: { id: true, label: true } },
                    },
                },
                logs: {
                    where: { note: { contains: " finished — " } },
                    orderBy: { createdAt: "desc" },
                    take: 1,
                    select: { note: true, changedBy: { select: { name: true } } },
                },
            },
        }),
        prisma.work.findMany({ orderBy: { order: "asc" }, select: { id: true, label: true, color: true } }),
    ]);

    const worksById = Object.fromEntries(works.map((w) => [w.id, w]));

    const items: WorkInboxItem[] = tickets.map((t) => {
        const subWorkId = t.ticketSubStatus?.workId ?? null;
        const statusWorkId = t.ticketStatus?.workId ?? null;
        const isStatusWork = !subWorkId && !!statusWorkId;   // new ticket: no work sub-status yet, riding its status' Work
        const work = worksById[subWorkId ?? statusWorkId ?? ""];
        const acct = t.device.account;
        const finishNote = isStatusWork ? undefined : t.logs[0];   // new-ticket cards never "answer"
        const status: WorkInboxItem["status"] = finishNote ? "answered" : t.primaryOwner ? "progress" : "todo";
        return {
            id: String(t.id),
            ticketId: t.id,
            successTarget: t.ticketSubStatus?.successSubStatus ?? null,
            failTarget: t.ticketSubStatus?.failSubStatus ?? null,
            kind: isStatusWork ? "new" : "ask",
            workId: work?.id ?? "",
            workLabel: work?.label ?? "Work",
            workColor: work?.color ?? "bg-muted text-muted-foreground",
            status,
            coverLabel: isStatusWork ? t.ticketStatus.label : (t.ticketSubStatus?.label ?? ""),
            ask: isStatusWork ? (t.ticketStatus.actionLabel ?? null) : (t.ticketSubStatus?.actionLabel ?? null),
            customer: acct?.person?.name ?? acct?.company?.name ?? "—",
            phone: acct?.person?.phones?.[0]?.phone ?? acct?.company?.phones?.[0]?.phone ?? null,
            device: `${t.device.brand} ${t.device.model}`.trim(),
            assignee: t.primaryOwner ?? null,
            answer: finishNote?.note ? finishNote.note.split(" finished — ").slice(1).join(" finished — ") : null,
            answeredBy: finishNote?.changedBy?.name ?? null,
            ageLabel: timeAgo(t.updatedAt),
        };
    });

    return <WorkInboxBoard items={items} works={works} currentUserId={userId} />;
}
